// app/api/cron/route.js
// Cette route est appelée périodiquement par un cron externe (cron-job.org).
// Elle exécute un cycle complet : récupère le prix, calcule le signal, décide, sauvegarde.
// Protégée par une clé secrète pour éviter les appels non autorisés.

import { put, get } from '@vercel/blob';
import { runTradingCycle, STARTING_CAPITAL } from '../../lib/tradingEngine';

const STATE_BLOB_PATH = 'aria-bot-state.json';

async function loadState() {
  try {
    const result = await get(STATE_BLOB_PATH, { access: 'private' });
    const text = await result.blob.text();
    return JSON.parse(text);
  } catch {
    // Aucun état existant : on initialise
    return {
      trades: [],
      params: { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.6 },
      account: { balance: STARTING_CAPITAL, equity: STARTING_CAPITAL },
      openPosition: null,
      lastSignal: null,
      riskPauseReason: null,
      lastCheckedAt: null
    };
  }
}

async function saveState(state) {
  await put(STATE_BLOB_PATH, JSON.stringify(state), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const apiKey = searchParams.get('apikey');

  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Non autorisé' }, { status: 401 });
  }
  if (!apiKey) {
    return Response.json({ error: 'apikey Twelve Data manquante' }, { status: 400 });
  }

  try {
    const state = await loadState();

    const marketRes = await fetch(
      `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=5min&outputsize=50&apikey=${apiKey}`,
      { cache: 'no-store' }
    );
    const marketData = await marketRes.json();

    if (marketData.status === 'error' || !marketData.values) {
      return Response.json({ error: 'Erreur Twelve Data', detail: marketData.message }, { status: 502 });
    }

    const closes = marketData.values.map(v => parseFloat(v.close)).reverse();
    const currentPrice = closes[closes.length - 1];

    const newState = runTradingCycle(state, closes, currentPrice);
    await saveState(newState);

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
