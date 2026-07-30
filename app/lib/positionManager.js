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

// --- Paramètres Profit Sécurisé (V2.2) ---
// Ratio progressif : verrouille entre 65% (au déclenchement) et 85% (plafond) du PIC
// de profit atteint. Le ratio augmente linéairement entre 2$ et 20$ de pic, puis reste
// fixé à 85% au-delà — équilibre entre sécuriser le gain et laisser respirer la tendance.
const PS_TRIGGER_USD = 2.0;      // Profit latent (pic) à partir duquel le PS s'active
const PS_RATIO_MIN = 0.65;       // Ratio verrouillé au déclenchement (2$)
const PS_RATIO_MAX = 0.85;       // Ratio verrouillé au plafond (20$ et au-delà)
const PS_RATIO_MAX_PROFIT = 20;  // Pic de profit à partir duquel le ratio max (85%) s'applique

const NO_TRACTION_WINDOW_MS = 30 * 60 * 1000; // fenêtre de grâce de 30 min après ouverture
const NO_TRACTION_ADVERSE_ATR = 0.5;  // si la position perd déjà 0.5x ATR pendant cette fenêtre,
                                       // sans avoir jamais montré de traction favorable (pas de
                                       // break-even déclenché), on coupe plus tôt que le stop-loss
                                       // complet — le trade n'a montré aucun signe de traction
                                       // rentable dès le départ

export function calculateInitialStops(entryPrice, atr, direction) {
  const slDistance = atr * SL_ATR_MULTIPLIER;
  const tpDistance = atr * TP_ATR_MULTIPLIER;

  if (direction === 'BUY') {
    return {
      stopLoss: entryPrice - slDistance,
      takeProfit: entryPrice + tpDistance,
    };
  }

  return {
    stopLoss: entryPrice + slDistance,
    takeProfit: entryPrice - tpDistance,
  };
}

function profitInAtrUnits(position, currentPrice, entryAtr) {
  const rawProfit =
    position.direction === 'BUY'
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

  return rawProfit / entryAtr;
}

export function checkBreakEven(position, currentPrice) {
  if (position.breakEvenTriggered) {
    return position;
  }

  const profitAtr = profitInAtrUnits(position, currentPrice, position.entryAtr);

  if (profitAtr >= BREAKEVEN_TRIGGER_ATR) {
    return {
      ...position,
      stopLoss: position.entryPrice,
      breakEvenTriggered: true,
    };
  }

  return position;
}

export function updateTrailingStop(position, currentPrice) {
  if (!position.breakEvenTriggered) {
    return position;
  }

  const trailingDistance = position.entryAtr * TRAILING_DISTANCE_ATR;

  if (position.direction === 'BUY') {
    const candidateStop = currentPrice - trailingDistance;
    if (candidateStop > position.stopLoss) {
      return { ...position, stopLoss: candidateStop, trailingActive: true };
    }
  } else {
    const candidateStop = currentPrice + trailingDistance;
    if (candidateStop < position.stopLoss) {
      return { ...position, stopLoss: candidateStop, trailingActive: true };
    }
  }

  return position;
}

function computeUnrealizedPnl(position, currentPrice) {
  const pnlPct =
    position.direction === 'BUY'
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice;
  return position.positionSize * pnlPct;
}

/**
 * Calcule le montant à verrouiller : ratio progressif de 65% à 85% du pic de profit,
 * interpolé linéairement entre PS_TRIGGER_USD et PS_RATIO_MAX_PROFIT, plafonné ensuite.
 */
function computeProgressiveLockedProfit(peakUnrealizedPnl) {
  if (peakUnrealizedPnl < PS_TRIGGER_USD) return null; // PS pas encore actif

  const clampedProfit = Math.min(peakUnrealizedPnl, PS_RATIO_MAX_PROFIT);
  const progress = (clampedProfit - PS_TRIGGER_USD) / (PS_RATIO_MAX_PROFIT - PS_TRIGGER_USD);
  const ratio = PS_RATIO_MIN + progress * (PS_RATIO_MAX - PS_RATIO_MIN);

  return peakUnrealizedPnl * ratio;
}

function updateProfitSecured(position, currentPrice) {
  const unrealizedPnl = computeUnrealizedPnl(position, currentPrice);
  const peakUnrealizedPnl = Math.max(position.peakUnrealizedPnl || 0, unrealizedPnl);

  const targetLockedProfit = computeProgressiveLockedProfit(peakUnrealizedPnl);
  if (targetLockedProfit === null) {
    return { ...position, peakUnrealizedPnl };
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
    if (currentPrice >= position.stopLoss) {
      return { shouldClose: true, reason: reasonForStop };
    }
    if (!activeProtection && currentPrice <= position.takeProfit) {
      return { shouldClose: true, reason: 'take_profit' };
    }
  }

  return { shouldClose: false, reason: null };
}

function checkNoTractionExit(position, currentPrice) {
  if (position.breakEvenTriggered) return false;

  const elapsedMs = Date.now() - position.openedAt;
  if (elapsedMs > NO_TRACTION_WINDOW_MS) return false;

  const profitAtr = profitInAtrUnits(position, currentPrice, position.entryAtr);
  return profitAtr <= -NO_TRACTION_ADVERSE_ATR;
}

export function evaluatePosition(position, currentPrice) {
  let updatedPosition = position;

  if (!updatedPosition.profitSecured) {
    updatedPosition = checkBreakEven(updatedPosition, currentPrice);
    updatedPosition = updateTrailingStop(updatedPosition, currentPrice);
  }

  updatedPosition = updateProfitSecured(updatedPosition, currentPrice);

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
