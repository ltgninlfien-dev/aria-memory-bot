// app/lib/statsEngine.js
// Moteur de statistiques V2.2 — analyse l'historique de trades shadow (ou réel)
// au-delà du winrate global : par direction, par régime ADX, profit factor, etc.
// Fonctions pures : prennent un tableau de trades clos, retournent des stats calculées.

// Seuils de régime ADX — cohérents avec scoreEngine.js (ADX_THRESHOLDS)
function getAdxRegime(adx) {
  if (adx === null || adx === undefined) return 'inconnu';
  if (adx > 30) return 'tendance_forte';
  if (adx > 20) return 'tendance_moderee';
  return 'range';
}

/**
 * Calcule winrate, profit factor, gains/pertes moyens pour un ensemble de trades
 * @param {Array} trades - trades clos (avec pnl)
 * @returns {Object}
 */
function computeCoreStats(trades) {
  if (trades.length === 0) {
    return {
      count: 0,
      winRate: null,
      profitFactor: null,
      avgWin: null,
      avgLoss: null,
      totalPnl: 0,
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const totalGains = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  const winRate = wins.length / trades.length;
  // profitFactor = gains totaux / pertes totales. Si aucune perte, on plafonne à null (indéfini, pas infini)
  const profitFactor = totalLosses > 0 ? totalGains / totalLosses : null;

  const avgWin = wins.length > 0 ? totalGains / wins.length : null;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : null;

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  return {
    count: trades.length,
    winRate: Math.round(winRate * 10000) / 100, // en %
    profitFactor: profitFactor !== null ? Math.round(profitFactor * 100) / 100 : null,
    avgWin: avgWin !== null ? Math.round(avgWin * 100) / 100 : null,
    avgLoss: avgLoss !== null ? Math.round(avgLoss * 100) / 100 : null,
    totalPnl: Math.round(totalPnl * 100) / 100,
  };
}

/**
 * Calcule la meilleure et la pire série de trades consécutifs (gagnants/perdants)
 * @param {Array} trades - trades clos, triés du plus ancien au plus récent
 * @returns {{ bestWinStreak: number, worstLossStreak: number }}
 */
function computeStreaks(trades) {
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let bestWinStreak = 0;
  let worstLossStreak = 0;

  for (const trade of trades) {
    if (trade.pnl > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      bestWinStreak = Math.max(bestWinStreak, currentWinStreak);
    } else {
      currentLossStreak++;
      currentWinStreak = 0;
      worstLossStreak = Math.max(worstLossStreak, currentLossStreak);
    }
  }

  return { bestWinStreak, worstLossStreak };
}

/**
 * Répartition des trades par raison de clôture (stop_loss, take_profit, trailing_stop, etc.)
 * @param {Array} trades
 * @returns {Object} compte par raison
 */
function computeCloseReasonBreakdown(trades) {
  const breakdown = {};
  for (const trade of trades) {
    const reason = trade.closeReason || 'inconnu';
    breakdown[reason] = (breakdown[reason] || 0) + 1;
  }
  return breakdown;
}

/**
 * Fonction principale — calcule le rapport statistique complet à partir des trades clos
 * @param {Array} allTrades - tous les trades (état shadow ou réel), ouverts ou fermés
 * @returns {Object} rapport complet
 */
export function calculateStats(allTrades) {
  const closedTrades = allTrades
    .filter(t => t.status === 'closed')
    .sort((a, b) => a.closedAt - b.closedAt);

  if (closedTrades.length === 0) {
    return {
      overall: computeCoreStats([]),
      byDirection: { BUY: computeCoreStats([]), SELL: computeCoreStats([]) },
      byAdxRegime: {},
      closeReasonBreakdown: {},
      streaks: { bestWinStreak: 0, worstLossStreak: 0 },
      sampleWarning: 'Aucun trade clos pour le moment.',
    };
  }

  const buyTrades = closedTrades.filter(t => t.direction === 'BUY');
  const sellTrades = closedTrades.filter(t => t.direction === 'SELL');

  // Regroupement par régime ADX (basé sur l'ADX au moment de l'ouverture, capturé dans entryAdx)
  const regimeGroups = { tendance_forte: [], tendance_moderee: [], range: [], inconnu: [] };
  for (const trade of closedTrades) {
    const regime = getAdxRegime(trade.entryAdx);
    regimeGroups[regime].push(trade);
  }

  const byAdxRegime = {};
  for (const [regime, trades] of Object.entries(regimeGroups)) {
    if (trades.length > 0) {
      byAdxRegime[regime] = computeCoreStats(trades);
    }
  }

  const stats = {
    overall: computeCoreStats(closedTrades),
    byDirection: {
      BUY: computeCoreStats(buyTrades),
      SELL: computeCoreStats(sellTrades),
    },
    byAdxRegime,
    closeReasonBreakdown: computeCloseReasonBreakdown(closedTrades),
    streaks: computeStreaks(closedTrades),
  };

  // Avertissement de significativité statistique — sous 30 trades, les chiffres sont peu fiables
  if (closedTrades.length < 30) {
    stats.sampleWarning = `Échantillon de ${closedTrades.length} trades — sous le seuil de 30 recommandé pour une lecture statistiquement fiable. Interpréter ces chiffres avec prudence.`;
  }

  return stats;
}
