// app/lib/positionManager.js
// Gestion avancée des positions — V2.1
// SL/TP basés sur l'ATR, break-even automatique, trailing stop
// Module autonome — pas encore intégré à tradingEngine.js
// Fonctions pures : aucune écriture Redis ici, juste du calcul sur l'état fourni

// --- Paramètres de risque (V2.1) ---
const SL_ATR_MULTIPLIER = 1.5;        // Stop-loss initial = 1.5x ATR
const TP_ATR_MULTIPLIER = 3;          // Take-profit initial = 3x ATR (ratio risk/reward 1:2)
const BREAKEVEN_TRIGGER_ATR = 0.5;    // Déclenche le break-even à +0.5x ATR de profit (abaissé de 1x
                                       // suite à l'observation répétée de trades passant en profit
                                       // significatif puis retombant en perte complète sans protection)
const TRAILING_DISTANCE_ATR = 1.5;    // Distance du trailing stop une fois activé
const MIN_PROFIT_TARGET_USD = 2;      // Ferme immédiatement dès que le profit latent atteint ce montant,
                                       // prioritaire sur le trailing/TP — objectif de gains réguliers
                                       // plutôt que quelques gros gains ponctuels

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
 * Met à jour le trailing stop si le break-even a déjà été déclenché
 * Le SL suit le prix à une distance fixe de TRAILING_DISTANCE_ATR, ne recule jamais
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
    // Le SL ne recule jamais : on ne le remonte que si le nouveau niveau est plus haut
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
 * Détermine si la position doit être fermée sur ce cycle (SL ou TP touché)
 * Note : le take-profit fixe initial est ignoré une fois le trailing actif (le trailing devient
 * le seul mécanisme de sortie profitable, comme validé dans la conception V2.1)
 * @param {Object} position
 * @param {number} currentPrice
 * @returns {{ shouldClose: boolean, reason: string|null }}
 */
function checkExitConditions(position, currentPrice) {
  if (position.direction === 'BUY') {
    if (currentPrice <= position.stopLoss) {
      return { shouldClose: true, reason: position.trailingActive ? 'trailing_stop' : (position.breakEvenTriggered ? 'breakeven_stop' : 'stop_loss') };
    }
    if (!position.trailingActive && currentPrice >= position.takeProfit) {
      return { shouldClose: true, reason: 'take_profit' };
    }
  } else {
    // SELL
    if (currentPrice >= position.stopLoss) {
      return { shouldClose: true, reason: position.trailingActive ? 'trailing_stop' : (position.breakEvenTriggered ? 'breakeven_stop' : 'stop_loss') };
    }
    if (!position.trailingActive && currentPrice <= position.takeProfit) {
      return { shouldClose: true, reason: 'take_profit' };
    }
  }

  return { shouldClose: false, reason: null };
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
 * Fonction principale — à appeler à chaque cycle pour une position ouverte
 * Enchaîne : vérification break-even -> mise à jour trailing -> vérification du seuil
 * de profit minimum (prioritaire) -> vérification de clôture standard
 * @param {Object} position - { entryPrice, direction, stopLoss, takeProfit, breakEvenTriggered, trailingActive, entryAtr }
 * @param {number} currentPrice
 * @returns {{ updatedPosition: Object, shouldClose: boolean, closeReason: string|null }}
 */
export function evaluatePosition(position, currentPrice) {
  let updatedPosition = checkBreakEven(position, currentPrice);
  updatedPosition = updateTrailingStop(updatedPosition, currentPrice);

  // Priorité absolue : dès que le profit latent atteint le seuil, on ferme —
  // avant même de vérifier SL/TP/trailing, conformément à l'objectif de gains réguliers.
  const unrealizedPnl = computeUnrealizedPnl(updatedPosition, currentPrice);
  if (unrealizedPnl >= MIN_PROFIT_TARGET_USD) {
    return { updatedPosition, shouldClose: true, closeReason: 'profit_target' };
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
  };
}
