// app/api/shadow-stats/route.js
// Route de consultation des statistiques du shadow trading (V2.2)
// Usage : /api/shadow-stats?symbol=XAU/USD

import { Redis } from '@upstash/redis';
import { calculateStats } from '../../lib/statsEngine';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function redisKeyForSymbol(symbol) {
  const slug = symbol.replace('/', '').toLowerCase();
  return `aria-bot-shadow-${slug}`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'XAU/USD';
  const redisKey = redisKeyForSymbol(symbol);

  try {
    const state = await redis.get(redisKey);

    if (!state) {
      return Response.json({
        symbol,
        message: 'Aucune donnée shadow trouvée pour ce symbole — le cron a-t-il déjà tourné ?',
      });
    }

    const stats = calculateStats(state.trades);

    return Response.json({
      symbol,
      currentBalance: state.account.balance,
      openPosition: state.openPosition,
      stats,
    });
  } catch (error) {
    return Response.json({ error: error.message, symbol }, { status: 500 });
  }
}
