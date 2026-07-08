// app/api/state-eurusd/route.js
// Route de LECTURE pour le bot EUR/USD, indépendante de celle de XAU/USD.

import { Redis } from '@upstash/redis';
import { STARTING_CAPITAL } from '../../lib/tradingEngine';

const STATE_KEY = 'aria-bot-state-eurusd';

function getRedis() {
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN
  });
}

export async function GET() {
  try {
    const redis = getRedis();
    const state = await redis.get(STATE_KEY);
    if (state) return Response.json(state);

    return Response.json({
      trades: [],
      params: { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.4 },
      account: { balance: STARTING_CAPITAL, equity: STARTING_CAPITAL },
      openPosition: null,
      lastSignal: null,
      riskPauseReason: null,
      lastCheckedAt: null,
      notice: 'Aucune donnée encore — le cron EUR/USD n\'a pas encore tourné.'
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
