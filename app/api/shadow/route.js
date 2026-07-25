// app/api/shadow/route.js
// Route de shadow trading — simule des positions complètes avec le moteur V2
// Clé Redis séparée du bot réel : aucun impact sur les trades/capital réels
// Usage (cron) : /api/shadow?symbol=XAU/USD&secret=...
//            ou : /api/shadow?symbol=EUR/USD&secret=...

import { Redis } from '@upstash/redis';
import { runShadowCycle, createInitialShadowState } from '../../lib/shadowEngine';
import { isWeekendClosure, getWeekKey, generateWeekendReview } from '../../lib/weekendReview';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const TWELVE_DATA_API_KEY = 'c10b0989d426492f8413f93d0727132c';
const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com/time_series';

function redisKeyForSymbol(symbol) {
  // XAU/USD -> aria-bot-shadow-xauusd, EUR/USD -> aria-bot-shadow-eurusd
  const slug = symbol.replace('/', '').toLowerCase();
  return `aria-bot-shadow-${slug}`;
}

async function fetchCandles(symbol, interval, outputsize) {
  const url = `${TWELVE_DATA_BASE_URL}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_DATA_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'error' || !data.values) {
    throw new Error(`Erreur Twelve Data (${interval}): ${data.message || 'réponse invalide'}`);
  }

  return data.values
    .map(v => ({
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      datetime: v.datetime,
    }))
    .reverse();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'XAU/USD';
  const secret = searchParams.get('secret');

  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const redisKey = redisKeyForSymbol(symbol);

  try {
    // Marché fermé le week-end : on n'interroge pas Twelve Data pour rien (prix figés),
    // et on génère plutôt un bilan/analyse d'erreurs de la semaine, une seule fois par week-end.
    if (isWeekendClosure()) {
      const existingState = (await redis.get(redisKey)) || createInitialShadowState();
      const currentWeekKey = getWeekKey();

      if (existingState.weeklyReview?.weekKey === currentWeekKey) {
        return Response.json({
          ok: true,
          symbol,
          skipped: true,
          reason: 'weekend_closure',
          note: 'Marché fermé le week-end — bilan déjà généré pour cette semaine, aucun appel Twelve Data effectué.',
          weeklyReview: existingState.weeklyReview,
        });
      }

      const weeklyReview = generateWeekendReview(existingState.trades);
      const newState = { ...existingState, weeklyReview };
      await redis.set(redisKey, newState);

      return Response.json({
        ok: true,
        symbol,
        skipped: true,
        reason: 'weekend_closure',
        note: 'Marché fermé le week-end — bilan de la semaine généré, aucun appel Twelve Data effectué.',
        weeklyReview,
      });
    }

    const [candles5min, candles1h] = await Promise.all([
      fetchCandles(symbol, '5min', 250),
      fetchCandles(symbol, '1h', 100),
    ]);

    const existingState = (await redis.get(redisKey)) || createInitialShadowState();
    const newState = await runShadowCycle(existingState, candles5min, candles1h, symbol);

    await redis.set(redisKey, newState);

    return Response.json({
      ok: true,
      symbol,
      redisKey,
      timestamp: new Date().toISOString(),
      tradesCount: newState.trades.length,
      openPosition: newState.openPosition,
      balance: newState.account.balance,
      note: 'Shadow trading — capital fictif séparé, aucun impact sur le bot réel.',
    });
  } catch (error) {
    return Response.json({ error: error.message, symbol }, { status: 500 });
  }
}
