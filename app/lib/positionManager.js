// app/lib/positionManager.js
// Gestion avancée des positions — V2.2
// SL/TP basés sur l'ATR, break-even automatique, trailing stop,
// puis Profit Sécurisé (PS) progressif basé sur le pic de profit atteint
// Module autonome — fonctions pures, aucune écriture Redis ici

// --- Paramètres de risque (phase précoce, ATR) ---
const SL_ATR_MULTIPLIER = 1.5;        // Stop-loss initial = 1.5x ATR
const TP_ATR_MULTIPLIER = 3;          // Take-profit initial = 3x ATR (ratio risk/reward 1:2)
const BREAKEVEN_TRIGGER_ATR = 0.5;    // Déclenche le break-even à +0.5x ATR de profit
const TRAILING_DISTANCE_ATR = 1.5;    // Distance du trailing stop ATR, avant activation du PS

// --- Paramètres Profit Sécurisé progressif (V2.2) ---
// Points de contrôle : { profit atteint (pic) -> montant verrouillé }
// Le ratio verrouillé augmente avec le profit (50% à 2$, jusqu'à 75% à 20$),
// interpolé linéairement entre les points, extrapolé au-delà de 20$ avec la
// même pente que le dernier segment (10$->20$).
const PS_CONTROL_POINTS = [
  { profit: 2, locked: 1 },
  { profit: 5, locked: 3 },
  { profit: 10, locked: 7 },
  { profit: 20, locked: 15 },
];

const NO_TRACTION_WINDOW_MS = 30 * 60 * 1000; // fenêtre de grâce de 30 min après ouverture
const NO_TRACTION_ADVERSE_ATR = 0.5;  // si la position perd déjà 0.5x ATR pendant cette fenêtre,
                                       // sans avoir jamais montré de traction favorable (pas de
                                       // break-even déclenché), on coupe plus tôt que le stop-loss
                                       // complet — le trade n'a montré aucun signe de traction
                                       // rentable dès le départ

/**
 * Calcule le SL et le TP initiaux à l'ouverture d'une position
 * @param {number} entryPrice
 * @param {number} atr - ATR au moment de l'ouverture
 * @param {'BUY'|'SELL'} direction
 * @returns {{ stopLoss: number, takeProfit: number }}
 */
export function calculateInitialStops(entryPrice, atr, direction) {
  const slDistance = atr * SL_ATR_MULTIPLIER;
  const tpDistance = atr * TP_ATR_MULTIPLIER;

  if (direction === 'BUY') {
    return {
      stopLoss: entryPrice - slDistance,
      takeProfit: entryPrice + tpDistance,
    };
  }

  // SELL
  return {
    stopLoss: entryPrice + slDistance,
    takeProfit: entryPrice - tpDistance,
  };
}

/**
 * Calcule le profit actuel en unités d'ATR (utile pour déclencher break-even / trailing)
 * @param {Object} position - { entryPrice, direction }
 * @param {number} currentPrice
 * @param {number} entryAtr - ATR au moment de l'ouverture (référence fixe pour la position)
 * @returns {number} profit exprimé en multiples d'ATR (positif = en profit)
 */
function profitInAtrUnits(position, currentPrice, entryAtr) {
  const rawProfit =
    position.direction === 'BUY'
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

  return rawProfit / entryAtr;
}

/**
 * Vérifie si le break-even doit être déclenché, et retourne le SL mis à jour si oui
 * N'est plus appelée une fois le Profit Sécurisé actif (voir evaluatePosition).
 * @param {Object} position - { entryPrice, direction, stopLoss, breakEvenTriggered, entryAtr }
 * @param {number} currentPrice
 * @returns {Object} position mise à jour (nouvel objet, ne mute pas l'original)
 */
export function checkBreakEven(position, currentPrice) {
  if (position.breakEvenTriggered) {
    return position; // déjà déclenché, rien à faire ici (le trailing prendra le relais)
  }

  const profitAtr = profitInAtrUnits(position, currentPrice, position.entryAtr);

  if (profitAtr >= BREAKEVEN_TRIGGER_ATR) {
    return {
      ...position,
      stopLoss: position.entryPrice, // SL remonté au prix d'entrée
      breakEvenTriggered: true,
    };
  }

  return position;
}

/**
 * Met à jour le trailing stop ATR si le break-even a déjà été déclenché
 * Le SL suit le prix à une distance fixe de TRAILING_DISTANCE_ATR, ne recule jamais
 * N'est plus appelée une fois le Profit Sécurisé actif (voir evaluatePosition).
 * @param {Object} position - { entryPrice, direction, stopLoss, breakEvenTriggered, entryAtr }
 * @param {number} currentPrice
 * @returns {Object} position mise à jour
 */
export function updateTrailingStop(position, currentPrice) {
  if (!position.breakEvenTriggered) {
    return position; // le trailing ne s'active qu'après le break-even
  }

  const trailingDistance = position.entryAtr * TRAILING_DISTANCE_ATR;

  if (position.direction === 'BUY') {
    const candidateStop = currentPrice - trailingDistance;
    if (candidateStop > position.stopLoss) {
      return { ...position, stopLoss: candidateStop, trailingActive: true };
    }
  } else {
    // SELL
    const candidateStop = currentPrice + trailingDistance;
    if (candidateStop < position.stopLoss) {
      return { ...position, stopLoss: candidateStop, trailingActive: true };
    }
  }

  return position;
}

/**
 * Calcule le P&L latent en dollars d'une position, à un prix donné
 * @param {Object} position - { entryPrice, direction, positionSize }
 * @param {number} currentPrice
 * @returns {number} profit/perte en dollars
 */
function computeUnrealizedPnl(position, currentPrice) {
  const pnlPct =
    position.direction === 'BUY'
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;
  return position.positionSize * pnlPct;
}

/**
 * Calcule le montant à verrouiller selon le pic de profit atteint,
 * par interpolation entre les points de contrôle du PS progressif.
 * @param {number} peakUnrealizedPnl
 * @returns {number|null} montant à verrouiller, ou null si le PS n'est pas encore actif
 */
function computeProgressiveLockedProfit(peakUnrealizedPnl) {
  const points = PS_CONTROL_POINTS;
  if (peakUnrealizedPnl < points[0].profit) return null; // PS pas encore actif (< 2$)

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (peakUnrealizedPnl <= b.profit) {
      const ratio = (peakUnrealizedPnl - a.profit) / (b.profit - a.profit);
      return a.locked + ratio * (b.locked - a.locked);
    }
  }

  // Au-delà du dernier point (20$) : on prolonge la pente du dernier segment
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const slope = (last.locked - prev.locked) / (last.profit - prev.profit);
  return last.locked + slope * (peakUnrealizedPnl - last.profit);
}

/**
 * Profit Sécurisé (PS) — V2.2, progressif sur le PIC de profit
 * Suit le meilleur profit latent jamais atteint (ne peut que monter), et verrouille
 * un montant croissant selon PS_CONTROL_POINTS. Le SL ne recule jamais.
 * Remplace complètement le break-even/trailing ATR une fois actif.
 * @param {Object} position - { entryPrice, direction, stopLoss, positionSize,
 *                              profitSecured, peakUnrealizedPnl }
 * @param {number} currentPrice
 * @returns {Object} position mise à jour
 */
function updateProfitSecured(position, currentPrice) {
  const unrealizedPnl = computeUnrealizedPnl(position, currentPrice);
  const peakUnrealizedPnl = Math.max(position.peakUnrealizedPnl || 0, unrealizedPnl);

  const targetLockedProfit = computeProgressiveLockedProfit(peakUnrealizedPnl);
  if (targetLockedProfit === null) {
    return { ...position, peakUnrealizedPnl }; // seuil de 2$ pas encore atteint
  }

  const priceOffset = (targetLockedProfit / position.positionSize) * position.entryPrice;
  let stopLoss = position.stopLoss;

  if (position.direction === 'BUY') {
    const candidateStop = position.entryPrice + priceOffset;
    if (candidateStop > stopLoss) stopLoss = candidateStop;
  } else {
    const candidateStop = position.entryPrice - priceOffset;
    if (candidateStop < stopLoss) stopLoss = candidateStop;
  }

  return {
    ...position,
    stopLoss,
    peakUnrealizedPnl,
    profitSecured: true,
    profitSecuredPrice: stopLoss,
  };
}

/**
 * Détermine si la position doit être fermée sur ce cycle (SL ou TP touché)
 * Le take-profit fixe et le trailing ATR initial sont ignorés une fois le PS actif —
 * le PS devient alors le seul mécanisme de sortie profitable.
 * @param {Object} position
 * @param {number} currentPrice
 * @returns {{ shouldClose: boolean, reason: string|null }}
 */
function checkExitConditions(position, currentPrice) {
  const activeProtection = position.trailingActive || position.profitSecured;

  const reasonForStop = position.profitSecured
    ? 'profit_secured_stop'
    : position.trailingActive
    ? 'trailing_stop'
    : position.breakEvenTriggered
    ? 'breakeven_stop'
    : 'stop_loss';

  if (position.direction === 'BUY') {
    if (currentPrice <= position.stopLoss) {
      return { shouldClose: true, reason: reasonForStop };
    }
    if (!activeProtection && currentPrice >= position.takeProfit) {
      return { shouldClose: true, reason: 'take_profit' };
    }
  } else {
    // SELL
    if (currentPrice >= position.stopLoss) {
      return { shouldClose: true, reason: reasonForStop };
    }
    if (!activeProtection && currentPrice <= position.takeProfit) {
      return { shouldClose: true, reason: 'take_profit' };
    }
  }

  return { shouldClose: false, reason: null };
}

/**
 * Détecte si une position, encore dans sa fenêtre de grâce après ouverture, n'a montré
 * aucun signe de traction favorable (jamais atteint le break-even) et perd déjà de
 * façon significative — signe que le trade était mal engagé dès le départ.
 * @param {Object} position - { openedAt, breakEvenTriggered, entryAtr }
 * @param {number} currentPrice
 * @returns {boolean}
 */
function checkNoTractionExit(position, currentPrice) {
  if (position.breakEvenTriggered) return false; // a déjà montré une traction favorable à un moment

  const elapsedMs = Date.now() - position.openedAt;
  if (elapsedMs > NO_TRACTION_WINDOW_MS) return false; // fenêtre de grâce terminée

  const profitAtr = profitInAtrUnits(position, currentPrice, position.entryAtr);
  return profitAtr <= -NO_TRACTION_ADVERSE_ATR;
}

/**
 * Fonction principale — à appeler à chaque cycle pour une position ouverte
 * Enchaîne : break-even/trailing ATR (phase précoce, avant PS) -> Profit Sécurisé
 * progressif (suit le pic, prend le relais dès +2$ de pic) -> sortie rapide sans
 * traction -> clôture standard
 * @param {Object} position - { entryPrice, direction, stopLoss, takeProfit, positionSize,
 *                              breakEvenTriggered, trailingActive, profitSecured,
 *                              peakUnrealizedPnl, entryAtr }
 * @param {number} currentPrice
 * @returns {{ updatedPosition: Object, shouldClose: boolean, closeReason: string|null }}
 */
export function evaluatePosition(position, currentPrice) {
  let updatedPosition = position;

  // Phase précoce : ATR break-even + trailing, seulement tant que le PS n'est pas actif
  if (!updatedPosition.profitSecured) {
    updatedPosition = checkBreakEven(updatedPosition, currentPrice);
    updatedPosition = updateTrailingStop(updatedPosition, currentPrice);
  }

  // Profit Sécurisé progressif : suit le pic, s'active dès que le pic atteint 2$
  updatedPosition = updateProfitSecured(updatedPosition, currentPrice);

  // Sortie rapide si aucune traction rentable dès le départ (fenêtre de grâce de 30 min)
  if (checkNoTractionExit(updatedPosition, currentPrice)) {
    return { updatedPosition, shouldClose: true, closeReason: 'no_traction_exit' };
  }

  const { shouldClose, reason } = checkExitConditions(updatedPosition, currentPrice);

  return {
    updatedPosition,
    shouldClose,
    closeReason: reason,
  };
}

/**
 * Construit l'objet position initial à l'ouverture (à stocker dans Redis)
 * @param {number} entryPrice
 * @param {'BUY'|'SELL'} direction
 * @param {number} atr - ATR au moment de l'ouverture
 * @returns {Object} position complète prête à être persistée
 */
export function createPosition(entryPrice, direction, atr) {
  const { stopLoss, takeProfit } = calculateInitialStops(entryPrice, atr, direction);

  return {
    entryPrice,
    direction,
    stopLoss,
    takeProfit,
    entryAtr: atr,
    breakEvenTriggered: false,
    trailingActive: false,
    profitSecured: false,
    profitSecuredPrice: null,
    peakUnrealizedPnl: 0,
  };
}
