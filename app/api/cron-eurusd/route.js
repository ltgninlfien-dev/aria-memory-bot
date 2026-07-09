// app/api/cron-eurusd/route.js
// Bot indépendant pour EUR/USD — même moteur que XAU/USD mais état Redis totalement séparé.

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import { runTradingCycle, STARTING_CAPITAL } from '../../lib/tradingEngine';

const STATE_KEY = 'aria-bot-state-eurusd';
const SYMBOL = 'EUR/USD';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;

function getRedis() {
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
  });
}

async function sendNotification(subject, html) {
  if (!process.env.RESEND_API_KEY || !NOTIFY_EMAIL) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'ARIA Memory Bot <onboarding@resend.dev>',
      to: NOTIFY_EMAIL,
      subject,
      html
    });
  } catch (err) {
    console.error('Notification email échouée:', err.message);
  }
}

async function notifyEvents(prevState, newState) {
  if (!prevState.openPosition && newState.openPosition) {
    const p = newState.openPosition;
    await sendNotification(
      `🟢 ARIA EUR/USD — Position ${p.direction} ouverte`,
      `<p><strong>${p.direction}</strong> EUR/USD @ ${p.entryPrice.toFixed(5)}</p>
       <p>Taille: $${p.positionSize.toFixed(2)} · Confiance: ${(p.confidence * 100).toFixed(0)}%</p>
       <p>Raisons: ${p.reasons.join(', ')}</p>`
    );
  }

  const prevClosedCount = prevState.trades.filter(t => t.status === 'closed').length;
  const newClosedCount = newState.trades.filter(t => t.status === 'closed').length;
  if (newClosedCount > prevClosedCount) {
    const lastClosed = [...newState.trades].filter(t => t.status === 'closed').sort((a, b) => b.closedAt - a.closedAt)[0];
    const emoji = lastClosed.pnl >= 0 ? '✅' : '❌';
    await sendNotification(
      `${emoji} ARIA EUR/USD — Trade clos : ${lastClosed.pnl >= 0 ? '+' : ''}$${lastClosed.pnl.toFixed(2)}`,
      `<p><strong>${lastClosed.direction}</strong> @ ${lastClosed.entryPrice.toFixed(5)} → ${lastClosed.exitPrice.toFixed(5)}</p>
       <p>P&L: <strong>${lastClosed.pnl >= 0 ? '+' : ''}$${lastClosed.pnl.toFixed(2)}</strong> (${(lastClosed.pnlPct * 100).toFixed(2)}%)</p>
       <p>Raison de clôture: ${lastClosed.closeReason}</p>
       <p>Capital actuel: $${newState.account.balance.toFixed(2)}</p>`
    );
  }
}

async function loadState(redis, forceResetParams) {
  const state = await redis.get(STATE_KEY);
  if (state && !forceResetParams) return state;
  if (state && forceResetParams) {
    return { ...state, params: { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.4 } };
  }
  return {
    trades: [],
    params: { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.4 },
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
      `https://api.twelvedata.com/time_series?symbol=${SYMBOL}&interval=5min&outputsize=60&apikey=${apiKey}`,
      { cache: 'no-store' }
    );
    const marketData = await marketRes.json();

    if (marketData.status === 'error' || !marketData.values) {
      return Response.json({ error: 'Erreur Twelve Data', detail: marketData.message }, { status: 502 });
    }

    const closes = marketData.values.map(v => parseFloat(v.close)).reverse();
    const currentPrice = closes[closes.length - 1];

    let closes1h = null;
    try {
      const market1hRes = await fetch(
        `https://api.twelvedata.com/time_series?symbol=${SYMBOL}&interval=1h&outputsize=30&apikey=${apiKey}`,
        { cache: 'no-store' }
      );
      const market1hData = await market1hRes.json();
      if (market1hData.values) {
        closes1h = market1hData.values.map(v => parseFloat(v.close)).reverse();
      }
    } catch {
      // Pas bloquant
    }

    const newState = runTradingCycle(state, closes, currentPrice, closes1h);
    await notifyEvents(state, newState);

    newState.priceHistory = marketData.values
      .map(v => ({ time: v.datetime.slice(5, 16), price: parseFloat(v.close) }))
      .reverse();

    await saveState(redis, newState);

    return Response.json({
      ok: true,
      symbol: SYMBOL,
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
