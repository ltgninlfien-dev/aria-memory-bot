// app/api/migration-close-eurusd/route.js
// Route à usage unique : ferme une position V1 orpheline sur EUR/USD avant la migration V2.
// Détecte l'absence des champs V2 (stopLoss undefined) pour confirmer qu'il s'agit bien
// d'une position ouverte sous l'ancien tradingEngine.js, pas d'un faux positif.
// À utiliser une seule fois, puis supprimer ce fichier une fois la migration terminée.

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

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
    const redis = getRedis();
    const state = await redis.get(STATE_KEY);

    if (!state) {
      return Response.json({ ok: false, message: 'Aucun état trouvé pour EUR/USD.' });
    }

    if (!state.openPosition) {
      return Response.json({ ok: false, message: 'Aucune position ouverte — rien à fermer.' });
    }

    // Garde-fou : on ne ferme que si la position n'a PAS les champs V2 (stopLoss undefined).
    // Si elle les a déjà, c'est probablement une position V2/shadow — on ne touche à rien.
    if (state.openPosition.stopLoss !== undefined) {
      return Response.json({
        ok: false,
        message: 'La position ouverte a déjà des champs V2 (stopLoss défini) — pas une position V1 orpheline, rien fait par sécurité.',
        openPosition: state.openPosition
      });
    }

    // Récupère le prix courant pour clôturer au marché
    const marketRes = await fetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent(SYMBOL)}&apikey=${apiKey}`,
      { cache: 'no-store' }
    );
    const marketData = await marketRes.json();
    const currentPrice = parseFloat(marketData.price);

    if (!currentPrice || Number.isNaN(currentPrice)) {
      return Response.json({ error: 'Erreur Twelve Data', detail: marketData }, { status: 502 });
    }

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
      closeReason: 'engine_migration_close'
    };

    const newTrades = state.trades.map(t => (t.id === position.id ? closedTrade : t));
    const newAccount = {
      balance: state.account.balance + pnl,
      equity: state.account.balance + pnl
    };

    const newState = {
      ...state,
      trades: newTrades,
      account: newAccount,
      openPosition: null
    };

    await redis.set(STATE_KEY, newState);

    await sendNotification(
      `🔧 ARIA EUR/USD — Position V1 fermée (migration V2)`,
      `<p>Position <strong>${position.direction}</strong> ouverte le ${new Date(position.openedAt).toLocaleString('fr-FR')} fermée manuellement avant migration vers le moteur V2.</p>
       <p>Entrée: ${position.entryPrice} → Sortie: ${currentPrice}</p>
       <p>P&L: <strong>${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</strong></p>
       <p>Capital après clôture: $${newAccount.balance.toFixed(2)}</p>`
    );

    return Response.json({
      ok: true,
      message: 'Position V1 orpheline fermée avec succès.',
      closedTrade,
      newBalance: newAccount.balance
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
