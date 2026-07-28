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
