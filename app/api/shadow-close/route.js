// app/api/shadow-close/route.js
// Permet de fermer manuellement une position shadow ouverte, au prix actuel.
// N'affecte que le capital fictif shadow — aucun impact sur le bot réel.
// Usage : POST /api/shadow-close?symbol=XAU/USD&secret=...

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const TWELVE_DATA_API_KEY = 'c10b0989d426492f8413f93d0727132c';
const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com/time_series';

function redisKeyForSymbol(symbol) {
  const slug = symbol.replace('/', '').toLowerCase();
  return `aria-bot-shadow-${slug}`;
}

async function fetchCurrentPrice(symbol) {
  const url = `${TWELVE_DATA_BASE_URL}?symbol=${encodeURIComponent(symbol)}&interval=5min&outputsize=1&apikey=${TWELVE_DATA_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'error' || !data.values || data.values.length === 0) {
    throw new Error(`Erreur Twelve Data : ${data.message || 'réponse invalide'}`);
  }

  return parseFloat(data.values[0].close);
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'XAU/USD';
  const secret = searchParams.get('secret');

  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const redisKey = redisKeyForSymbol(symbol);

  try {
    const state = await redis.get(redisKey);

    if (!state || !state.openPosition) {
      return Response.json({ error: 'Aucune position shadow ouverte pour ce symbole' }, { status: 400 });
    }

    const currentPrice = await fetchCurrentPrice(symbol);
    const position = state.openPosition;

    const pnlPct =
      position.direction === 'BUY'
        ? (currentPrice - position.entryPrice) / position.entryPrice
        : (position.entryPrice - currentPrice) / position.entryPrice;

    const pnl = position.positionSize * pnlPct;

    const closedTrade = {
      ...position,
      status: 'closed',
      exitPrice: currentPrice,
      pnl,
      pnlPct,
      closedAt: Date.now(),
      closeReason: 'manual_close',
    };

    const newState = {
      ...state,
      trades: [...state.trades, closedTrade],
      openPosition: null,
      account: { balance: state.account.balance + pnl, equity: state.account.balance + pnl },
      shadowLog: [
        ...(state.shadowLog || []),
        { timestamp: Date.now(), outcome: 'closed', closeReason: 'manual_close' },
      ],
    };

    await redis.set(redisKey, newState);

    return Response.json({
      ok: true,
      symbol,
      closedTrade,
      newBalance: newState.account.balance,
    });
  } catch (error) {
    return Response.json({ error: error.message, symbol }, { status: 500 });
  }
}
