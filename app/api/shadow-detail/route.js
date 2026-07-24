// app/api/shadow-detail/route.js
// Route de détail pour le dashboard shadow — combine bougies fraîches (graphique)
// et état de la position shadow stockée en Redis (SL, TP, break-even, trailing).
// Lecture seule, n'écrit jamais dans Redis.
// Usage : /api/shadow-detail?symbol=XAU/USD

import { Redis } from '@upstash/redis';
import { adjustV2ThresholdFromHistory } from '../../lib/v2LearningEngine';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const TWELVE_DATA_API_KEY = 'c10b0989d426492f8413f93d0727132c';
const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com/time_series';

const STARTING_CAPITAL = 10000;

function redisKeyForSymbol(symbol) {
  const slug = symbol.replace('/', '').toLowerCase();
  return `aria-bot-shadow-${slug}`;
}

async function fetchRecentCandles(symbol, outputsize = 60) {
  const url = `${TWELVE_DATA_BASE_URL}?symbol=${encodeURIComponent(symbol)}&interval=5min&outputsize=${outputsize}&apikey=${TWELVE_DATA_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'error' || !data.values) {
    throw new Error(`Erreur Twelve Data : ${data.message || 'réponse invalide'}`);
  }

  return data.values
    .map(v => ({ time: v.datetime.slice(11, 16), price: parseFloat(v.close) }))
    .reverse();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'XAU/USD';
  const redisKey = redisKeyForSymbol(symbol);

  try {
    const [priceHistory, shadowState] = await Promise.all([
      fetchRecentCandles(symbol),
      redis.get(redisKey),
    ]);

    const openPosition = shadowState?.openPosition || null;
    const trades = shadowState?.trades || [];
    const balance = shadowState?.account?.balance ?? null;
    const learningState = adjustV2ThresholdFromHistory(trades, shadowState?.params?.thresholdAdjustment || 0);

    // Courbe de capital : calculée à partir de tout l'historique des trades clos,
    // triés chronologiquement, en partant du capital de départ.
    const closedTradesSorted = trades
      .filter(t => t.status === 'closed')
      .sort((a, b) => a.closedAt - b.closedAt);

    const equityCurve = closedTradesSorted.reduce(
      (acc, t) => {
        const last = acc.length > 0 ? acc[acc.length - 1].equity : STARTING_CAPITAL;
        acc.push({ trade: acc.length + 1, equity: Math.round((last + t.pnl) * 100) / 100 });
        return acc;
      },
      [{ trade: 0, equity: STARTING_CAPITAL }]
    );

    // Bilans par période — journée, semaine (lundi-dimanche), mois calendaire en cours
    function summarizePeriod(trades) {
      if (trades.length === 0) return { count: 0, winRate: null, totalPnl: 0 };
      const wins = trades.filter(t => t.pnl > 0).length;
      const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
      return {
        count: trades.length,
        winRate: Math.round((wins / trades.length) * 1000) / 10,
        totalPnl: Math.round(totalPnl * 100) / 100,
      };
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // lundi=1 ... dimanche=7
    const startOfWeek = startOfDay - (dayOfWeek - 1) * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const periodSummary = {
      today: summarizePeriod(closedTradesSorted.filter(t => t.closedAt >= startOfDay)),
      thisWeek: summarizePeriod(closedTradesSorted.filter(t => t.closedAt >= startOfWeek)),
      thisMonth: summarizePeriod(closedTradesSorted.filter(t => t.closedAt >= startOfMonth)),
    };

    // Statut lisible de la position, pour affichage direct sans logique côté client
    let positionStatus = null;
    if (openPosition) {
      if (openPosition.trailingActive) positionStatus = 'trailing_actif';
      else if (openPosition.breakEvenTriggered) positionStatus = 'breakeven_actif';
      else positionStatus = 'sl_fixe';
    }

    return Response.json({
      symbol,
      priceHistory,
      openPosition,
      positionStatus,
      equityCurve,
      periodSummary,
      learningState,
      allClosedTrades: [...closedTradesSorted].reverse(), // du plus récent au plus ancien
      balance,
      note: 'Route de détail shadow — lecture seule, aucune écriture Redis.',
    });
  } catch (error) {
    return Response.json({ error: error.message, symbol }, { status: 500 });
  }
}
