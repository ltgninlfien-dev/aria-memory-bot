// app/api/state/route.js
// Route de LECTURE utilisée par l'interface web pour afficher l'état géré par le cron serveur.
// L'interface ne fait plus de trading elle-même — elle affiche ce que le cron a décidé.

import { head } from '@vercel/blob';
import { STARTING_CAPITAL } from '../../lib/tradingEngine';

const STATE_BLOB_PATH = 'aria-bot-state.json';

export async function GET() {
  try {
    const blobInfo = await head(STATE_BLOB_PATH);
    const res = await fetch(blobInfo.url, { cache: 'no-store' });
    const state = await res.json();
    return Response.json(state);
  } catch {
    return Response.json({
      trades: [],
      params: { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.6 },
      account: { balance: STARTING_CAPITAL, equity: STARTING_CAPITAL },
      openPosition: null,
      lastSignal: null,
      riskPauseReason: null,
      lastCheckedAt: null,
      notice: 'Aucune donnée encore — le cron serveur n\'a pas encore tourné.'
    });
  }
}
