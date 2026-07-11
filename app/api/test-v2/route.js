// app/api/test-v2/route.js
// Route de TEST MANUEL du moteur V2 — lecture seule, n'écrit JAMAIS dans Redis, n'ouvre aucune position
// Usage : https://aria-memory-bot.vercel.app/api/test-v2?symbol=XAU/USD
//     ou : https://aria-memory-bot.vercel.app/api/test-v2?symbol=EUR/USD

import { calculateScore } from '../../lib/scoreEngine';

const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com/time_series';

async function fetchCandles(symbol, interval, outputsize) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error(
      'TWELVE_DATA_API_KEY manquante dans les variables d\'environnement Vercel. ' +
      'Vérifie le nom exact de la variable utilisée dans cron/route.js et ajuste ici si besoin.'
    );
  }

  const url = `${TWELVE_DATA_BASE_URL}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'error' || !data.values) {
    throw new Error(`Erreur Twelve Data (${interval}): ${data.message || 'réponse invalide'}`);
  }

  // Twelve Data renvoie du plus récent au plus ancien -> on inverse pour avoir ancien -> récent
  const candles = data.values
    .map(v => ({
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      datetime: v.datetime,
    }))
    .reverse();

  return candles;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'XAU/USD';

  try {
    const [candles5min, candles1h] = await Promise.all([
      fetchCandles(symbol, '5min', 250),
      fetchCandles(symbol, '1h', 100),
    ]);

    const result = calculateScore(candles5min, candles1h);

    return Response.json({
      symbol,
      timestamp: new Date().toISOString(),
      lastCandle5min: candles5min[candles5min.length - 1],
      lastCandle1h: candles1h[candles1h.length - 1],
      candlesCount: { fiveMin: candles5min.length, oneHour: candles1h.length },
      v2Result: result,
      note: 'Route de test en lecture seule — aucune écriture Redis, aucune position ouverte.',
    });
  } catch (error) {
    return Response.json(
      { error: error.message, symbol },
      { status: 500 }
    );
  }
}
