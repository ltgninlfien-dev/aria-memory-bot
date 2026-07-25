// app/lib/weekendReview.js
// Détecte la fermeture du marché forex le week-end (vendredi 22h UTC -> dimanche 22h UTC)
// et génère un bilan/analyse d'erreurs de la semaine écoulée pendant cette fenêtre morte,
// au lieu de continuer à interroger Twelve Data pour rien (marché fermé = prix figés).

import { calculateStats } from './statsEngine';

/**
 * Vérifie si le marché forex est actuellement fermé pour le week-end.
 * @param {Date} date - date à vérifier (par défaut : maintenant)
 * @returns {boolean}
 */
export function isWeekendClosure(date = new Date()) {
  const day = date.getUTCDay(); // 0=dimanche, 5=vendredi, 6=samedi
  const hour = date.getUTCHours();

  if (day === 6) return true; // samedi : toujours fermé
  if (day === 5 && hour >= 22) return true; // vendredi après 22h UTC
  if (day === 0 && hour < 22) return true; // dimanche avant 22h UTC

  return false;
}

/**
 * Identifiant de semaine (année + numéro de semaine ISO), utilisé pour ne générer
 * le bilan qu'une seule fois par week-end plutôt qu'à chaque cycle de cron.
 * @param {Date} date
 * @returns {string} ex: "2026-W30"
 */
export function getWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNum}`;
}

/**
 * Génère un bilan/analyse d'erreurs à partir des trades des 7 derniers jours.
 * Réutilise le moteur de stats existant, plus une identification de la pire perte
 * et une synthèse en texte des erreurs les plus fréquentes de la semaine.
 * @param {Array} trades - tous les trades (état shadow)
 * @returns {Object} bilan hebdomadaire
 */
export function generateWeekendReview(trades) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekTrades = trades.filter(t => t.status === 'closed' && t.closedAt >= sevenDaysAgo);

  const stats = calculateStats(weekTrades);

  const worstTrade = weekTrades.length > 0
    ? [...weekTrades].sort((a, b) => a.pnl - b.pnl)[0]
    : null;

  // Identifie la raison de clôture la plus fréquente parmi les trades perdants de la semaine
  const losingTrades = weekTrades.filter(t => t.pnl < 0);
  const lossReasonCounts = {};
  losingTrades.forEach(t => {
    lossReasonCounts[t.closeReason] = (lossReasonCounts[t.closeReason] || 0) + 1;
  });
  const mostCommonLossReason = Object.entries(lossReasonCounts).sort((a, b) => b[1] - a[1])[0];

  const lessons = [];
  if (stats.overall.count === 0) {
    lessons.push("Aucun trade clos cette semaine — rien à analyser.");
  } else {
    if (stats.overall.winRate !== null) {
      lessons.push(`Winrate de la semaine : ${stats.overall.winRate}% sur ${stats.overall.count} trades, P&L ${stats.overall.totalPnl >= 0 ? '+' : ''}$${stats.overall.totalPnl.toFixed(2)}.`);
    }
    if (mostCommonLossReason) {
      const [reason, count] = mostCommonLossReason;
      lessons.push(`Raison de perte la plus fréquente : "${reason}" (${count} fois sur ${losingTrades.length} pertes).`);
    }
    if (stats.byDirection?.BUY?.winRate !== null && stats.byDirection?.SELL?.winRate !== null) {
      const buyWr = stats.byDirection.BUY.winRate;
      const sellWr = stats.byDirection.SELL.winRate;
      if (Math.abs(buyWr - sellWr) > 20) {
        lessons.push(`Écart notable entre BUY (${buyWr}%) et SELL (${sellWr}%) — à surveiller si ça persiste sur plusieurs semaines.`);
      }
    }
    if (worstTrade) {
      lessons.push(`Pire trade de la semaine : ${worstTrade.direction} @ $${worstTrade.entryPrice.toFixed(2)}, ${worstTrade.pnl.toFixed(2)}$ (${worstTrade.closeReason}).`);
    }
  }

  return {
    weekKey: getWeekKey(),
    generatedAt: Date.now(),
    tradesAnalyzed: weekTrades.length,
    stats,
    worstTrade,
    lessons,
  };
}
