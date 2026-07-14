// app/lib/shadowEngine.js
// Moteur de "shadow trading" — simule des positions complètes avec le moteur V2
// (scoreEngine + positionManager), en paper trading fictif totalement séparé du bot réel.
// Objectif : accumuler un historique de trades V2 pour calculer des statistiques fiables
// avant de basculer le vrai bot dessus.

import { calculateScore } from './scoreEngine';
import { createPosition, evaluatePosition } from './positionManager';
import {
  getRiskPause,
  getPositionSizeMultiplier,
  STARTING_CAPITAL,
  RISK_PER_TRADE,
  MAX_JUDGMENT_LOG_SIZE,
} from './tradingEngine';

// Ajoute une entrée au journal shadow, avec rotation (même principe que judgmentLog réel)
function logShadowEntry(log, entry) {
  const updated = [...(log || []), entry];
  return updated.length > MAX_JUDGMENT_LOG_SIZE
    ? updated.slice(updated.length - MAX_JUDGMENT_LOG_SIZE)
    : updated;
}

/**
 * État shadow initial (à utiliser si aucune clé Redis n'existe encore)
 */
export function createInitialShadowState() {
  return {
    trades: [],
    openPosition: null,
    account: { balance: STARTING_CAPITAL, equity: STARTING_CAPITAL },
    shadowLog: [],
    lastCheckedAt: null,
  };
}

/**
 * Exécute un cycle complet de shadow trading V2 : calcule le score, gère la position
 * ouverte s'il y en a une (break-even, trailing, clôture), ou envisage une ouverture.
 * @param {Object} state - état shadow courant (voir createInitialShadowState)
 * @param {Array} candles5min - bougies 5min (250 recommandé)
 * @param {Array} candles1h - bougies 1h
 * @returns {Object} nouvel état shadow à persister
 */
export function runShadowCycle(state, candles5min, candles1h) {
  const currentPrice = candles5min[candles5min.length - 1].close;
  const v2Result = calculateScore(candles5min, candles1h);
  const currentAtr = v2Result.breakdown.volatility.detail.atr;

  let { trades, openPosition, account, shadowLog } = state;

  // --- Position déjà ouverte : on l'évalue (break-even / trailing / clôture) ---
  if (openPosition) {
    const { updatedPosition, shouldClose, closeReason } = evaluatePosition(openPosition, currentPrice);

    if (shouldClose) {
      const pnlPct =
        updatedPosition.direction === 'BUY'
          ? (currentPrice - updatedPosition.entryPrice) / updatedPosition.entryPrice
          : (updatedPosition.entryPrice - currentPrice) / updatedPosition.entryPrice;

      const pnl = updatedPosition.positionSize * pnlPct;

      const closedTrade = {
        ...updatedPosition,
        status: 'closed',
        exitPrice: currentPrice,
        pnl,
        pnlPct,
        closedAt: Date.now(),
        closeReason,
      };

      const newTrades = [...trades, closedTrade];
      const newAccount = { balance: account.balance + pnl, equity: account.balance + pnl };

      return {
        trades: newTrades,
        openPosition: null,
        account: newAccount,
        shadowLog: logShadowEntry(shadowLog, {
          timestamp: Date.now(),
          v2Result,
          outcome: 'closed',
          closeReason,
        }),
        lastCheckedAt: Date.now(),
      };
    }

    // Position toujours ouverte : on enregistre juste la mise à jour (break-even/trailing éventuel)
    return {
      trades,
      openPosition: updatedPosition,
      account,
      shadowLog: logShadowEntry(shadowLog, {
        timestamp: Date.now(),
        v2Result,
        outcome: 'held',
      }),
      lastCheckedAt: Date.now(),
    };
  }

  // --- Aucune position ouverte : on envisage une ouverture si le score le permet ---
  if (v2Result.shouldTrade && v2Result.direction !== 'NEUTRAL') {
    const risk = getRiskPause(trades);

    if (risk.paused) {
      return {
        trades,
        openPosition: null,
        account,
        shadowLog: logShadowEntry(shadowLog, {
          timestamp: Date.now(),
          v2Result,
          outcome: 'skipped_risk_pause',
          reason: risk.reason,
        }),
        lastCheckedAt: Date.now(),
      };
    }

    const sizeMultiplier = getPositionSizeMultiplier(trades);
    // Taille basée sur le risque par trade rapporté à la distance du SL (cohérent avec positionManager)
    const slDistance = currentAtr * 1.5; // doit rester aligné avec SL_ATR_MULTIPLIER de positionManager.js
    const riskAmount = account.balance * RISK_PER_TRADE;
    const basePositionSize = (riskAmount / slDistance) * currentPrice;
    const positionSize = Math.min(basePositionSize * sizeMultiplier, account.balance * 0.5);

    const newPosition = {
      ...createPosition(currentPrice, v2Result.direction, currentAtr),
      id: Date.now(),
      positionSize,
      sizeMultiplier,
      score: v2Result.score,
      entryAdx: v2Result.adx,
      entryThreshold: v2Result.threshold,
      status: 'open',
      openedAt: Date.now(),
    };

    return {
      trades,
      openPosition: newPosition,
      account,
      shadowLog: logShadowEntry(shadowLog, {
        timestamp: Date.now(),
        v2Result,
        outcome: 'opened',
      }),
      lastCheckedAt: Date.now(),
    };
  }

  // --- Rien à faire ce cycle ---
  return {
    trades,
    openPosition,
    account,
    shadowLog: logShadowEntry(shadowLog, {
      timestamp: Date.now(),
      v2Result,
      outcome: 'no_action',
    }),
    lastCheckedAt: Date.now(),
  };
}
