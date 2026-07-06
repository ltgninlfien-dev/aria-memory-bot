// app/api/cron/route.js
// Cette route est appelée périodiquement par un cron externe (cron-job.org).
// Elle exécute un cycle complet : récupère le prix, calcule le signal, décide, sauvegarde.
// Protégée par une clé secrète pour éviter les appels non autorisés.

import { Redis } from '@upstash/redis';
import { runTradingCycle, STARTING_CAPITAL } from '../../lib/tradingEngine';

const STATE_KEY = 'aria-bot-state';

function getRedis() {
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
  });
}

async function loadState(redis, forceResetParams) {
  const state = await redis.get(STATE_KEY);
  if (state && !forceResetParams) return state;
  if (state && forceResetParams) {
    return { ...state, params: { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.45 } };
  }
  return {
    trades: [],
    params: { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.45 },
    account: { balance: STARTING_CAPITAL, equity: STARTING_CAPITAL },
    openPosition: null,
    lastSignal: null,
    riskPauseReason: null,
    lastCheckedAt: null
  };
}

async function saveState(redis, state) {
  await redis.set(STATE_KEY, state);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const apiKey = searchParams.get('apikey');
  const resetParams = searchParams.get('resetParams') === 'true';

  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Non autorisé' }, { status: 401 });
  }
  if (!apiKey) {
    return Response.json({ error: 'apikey Twelve Data manquante' }, { status: 400 });
  }

  try {
    const redis = getRedis();
    const state = await loadState(redis, resetParams);

    const marketRes = await fetch(
      `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=60&apikey=${apiKey}`,
      { cache: 'no-store' }
    );
    const marketData = await marketRes.json();

    if (marketData.status === 'error' || !marketData.values) {
      return Response.json({ error: 'Erreur Twelve Data', detail: marketData.message }, { status: 502 });
    }

    const closes = marketData.values.map(v => parseFloat(v.close)).reverse();
    const currentPrice = closes[closes.length - 1];

    // Données 1h pour la confirmation multi-timeframe (best-effort : si ça échoue, on continue sans)
    let closes1h = null;
    try {
      const market1hRes = await fetch(
        `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1h&outputsize=30&apikey=${apiKey}`,
        { cache: 'no-store' }
      );
      const market1hData = await market1hRes.json();
      if (market1hData.values) {
        closes1h = market1hData.values.map(v => parseFloat(v.close)).reverse();
      }
    } catch {
      // Pas bloquant : le signal fonctionnera sans confirmation 1h
    }

    const newState = runTradingCycle(state, closes, currentPrice, closes1h);
    await saveState(redis, newState);

    return Response.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      signal: newState.lastSignal,
      openPosition: newState.openPosition,
      balance: newState.account.balance,
      tradesCount: newState.trades.length
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
