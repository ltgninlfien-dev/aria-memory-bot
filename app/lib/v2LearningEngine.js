// app/lib/v2LearningEngine.js
// Équivalent V2 de adjustParamsFromHistory (tradingEngine.js) : ajuste un décalage de
// seuil appliqué par-dessus le seuil dynamique ADX de scoreEngine.js, en fonction du
// winrate récent. Ne remplace pas le seuil dynamique — l'affine avec l'expérience.

const MIN_TRADES_BEFORE_LEARNING = 5; // même seuil d'activation que V1
const LOOKBACK_TRADES = 20;

const MAX_ADJUSTMENT = 20; // le décalage ne peut jamais dépasser ±20 points
const MIN_ADJUSTMENT = -10;

/**
 * Calcule le nouveau décalage de seuil à partir de l'historique de trades clos.
 * @param {Array} trades - tous les trades (état shadow), ouverts ou fermés
 * @param {number} currentAdjustment - décalage actuel (0 par défaut)
 * @returns {{ adjustment: number, active: boolean, closedCount: number, recentWinRate: number|null }}
 */
export function adjustV2ThresholdFromHistory(trades, currentAdjustment = 0) {
  const closed = trades.filter(t => t.status === 'closed');

  if (closed.length < MIN_TRADES_BEFORE_LEARNING) {
    return { adjustment: currentAdjustment, active: false, closedCount: closed.length, recentWinRate: null };
  }

  const recent = closed.slice(-LOOKBACK_TRADES);
  const winRate = recent.filter(t => t.pnl > 0).length / recent.length;

  let newAdjustment = currentAdjustment;

  if (winRate < 0.3) {
    // Winrate faible : on relève le seuil requis (plus sélectif), par pas de +3
    newAdjustment = Math.min(MAX_ADJUSTMENT, currentAdjustment + 3);
  } else if (winRate > 0.5) {
    // Winrate satisfaisant : on assouplit légèrement, par pas de -1
    newAdjustment = Math.max(MIN_ADJUSTMENT, currentAdjustment - 1);
  }
  // Entre 0.3 et 0.5 : on ne change rien, zone jugée acceptable

  return {
    adjustment: newAdjustment,
    active: true,
    closedCount: closed.length,
    recentWinRate: Math.round(winRate * 1000) / 10,
  };
}
