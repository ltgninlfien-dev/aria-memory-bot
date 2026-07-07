// app/lib/tradingEngine.js
// Logique de trading pure (sans état React), utilisée par la route cron serveur.

export const STARTING_CAPITAL = 10000;
export const RISK_PER_TRADE = 0.01;
export const SYMBOL = 'XAU/USD';

export const DAILY_LOSS_LIMIT_PCT = 0.03;
export const MAX_CONSECUTIVE_LOSSES = 3;
export const CONSECUTIVE_LOSS_PAUSE_MS = 2 * 60 * 60 * 1000;
export const POSITION_SIZE_REDUCTION_AFTER_LOSS = 0.25;
export const MAX_JUDGMENT_LOG_SIZE = 300; // nombre max d'entrées conservées dans le journal de jugements

// ============ QUALITY FILTERS CONSTANTS ============
export const TREND_SMA_PERIOD = 50; // moyenne mobile pour détecter la tendance de fond
export const MIN_VOLATILITY = 0.0003; // en dessous, le marché est jugé trop calme pour trader fiablement

// ============ INDICATOR MATH ============
export function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  const out = [ema];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

export function calcMACD(closes) {
  if (closes.length < 26) return null;
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine.slice(-9 - 9), 9);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

export function calcBollinger(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + mult * sd, mid: mean, lower: mean - mult * sd };
}

// Moyenne mobile simple — utilisée pour détecter la tendance de fond
export function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ATR simplifié à partir des seules clôtures (proxy de volatilité quand on n'a pas high/low)
// Mesure la variation moyenne absolue entre bougies successives sur la période.
export function calcVolatility(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-period - 1);
  let sumAbsDiff = 0;
  for (let i = 1; i < recent.length; i++) {
    sumAbsDiff += Math.abs(recent[i] - recent[i - 1]);
  }
  const avgMove = sumAbsDiff / period;
  const avgPrice = recent.reduce((a, b) => a + b, 0) / recent.length;
  return avgMove / avgPrice; // volatilité relative, ex: 0.001 = 0.1% de mouvement moyen par bougie
}

// ============ SIGNAL ENGINE ============
// closes1h est optionnel : si fourni, active la confirmation multi-timeframe.
export function generateSignal(closes, params, closes1h = null) {
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const boll = calcBollinger(closes);
  const sma = calcSMA(closes, TREND_SMA_PERIOD);
  const volatility = calcVolatility(closes);
  if (rsi === null || !macd || !boll) return null;

  const price = closes[closes.length - 1];
  let score = 0;
  const reasons = [];

  if (rsi < params.rsiOversold) { score += 1; reasons.push(`RSI survendu (${rsi.toFixed(1)})`); }
  if (rsi > params.rsiOverbought) { score -= 1; reasons.push(`RSI suracheté (${rsi.toFixed(1)})`); }
  if (macd.histogram > 0) { score += 1; reasons.push('MACD haussier'); }
  if (macd.histogram < 0) { score -= 1; reasons.push('MACD baissier'); }
  if (price < boll.lower) { score += 1; reasons.push('Prix sous bande de Bollinger basse'); }
  if (price > boll.upper) { score -= 1; reasons.push('Prix au-dessus bande de Bollinger haute'); }

  let confidence = Math.abs(score) / 3;
  let direction = score > 0 ? 'BUY' : score < 0 ? 'SELL' : 'NEUTRAL';

  // === FILTRE 1 : Tendance de fond (SMA 50) ===
  // On ne prend un BUY que si le prix est au-dessus de la tendance, un SELL que si en dessous.
  // Sinon, on ne bloque pas complètement mais on pénalise fortement la confiance.
  if (sma !== null && direction !== 'NEUTRAL') {
    const alignedWithTrend = (direction === 'BUY' && price > sma) || (direction === 'SELL' && price < sma);
    if (!alignedWithTrend) {
      reasons.push('Contre la tendance de fond (SMA50) — confiance réduite');
      confidence *= 0.4;
    } else {
      reasons.push('Aligné avec la tendance de fond (SMA50)');
    }
  }

  // === FILTRE 2 : Volatilité minimum ===
  // Si le marché est trop calme, les indicateurs sont peu fiables : on annule le signal.
  if (volatility !== null && volatility < MIN_VOLATILITY && direction !== 'NEUTRAL') {
    reasons.push(`Volatilité trop faible (${(volatility * 100).toFixed(3)}%) — signal ignoré`);
    direction = 'NEUTRAL';
    confidence = 0;
  }

  // === FILTRE 3 : Confirmation multi-timeframe (1h) ===
  // Si on a les données 1h, le signal 1h doit aller dans le même sens, sinon confiance réduite.
  if (closes1h && closes1h.length >= 26 && direction !== 'NEUTRAL') {
    const macd1h = calcMACD(closes1h);
    const rsi1h = calcRSI(closes1h);
    if (macd1h && rsi1h !== null) {
      const trend1hUp = macd1h.histogram > 0 && rsi1h > 45;
      const trend1hDown = macd1h.histogram < 0 && rsi1h < 55;
      const confirmed = (direction === 'BUY' && trend1hUp) || (direction === 'SELL' && trend1hDown);
      if (confirmed) {
        reasons.push('Confirmé par le timeframe 1h');
        confidence = Math.min(1, confidence * 1.3);
      } else {
        reasons.push('Non confirmé par le timeframe 1h — confiance réduite');
        confidence *= 0.5;
      }
    }
  }

  return { direction, confidence, score, rsi, macd, boll, sma, volatility, price, reasons, timestamp: Date.now() };
}

// ============ LEARNING ENGINE ============
export function adjustParamsFromHistory(trades, currentParams) {
  const closed = trades.filter(t => t.status === 'closed');
  if (closed.length < 5) return currentParams;

  const recent = closed.slice(-20);
  const winRate = recent.filter(t => t.pnl > 0).length / recent.length;
  const newParams = { ...currentParams };

  if (winRate < 0.4) {
    newParams.confidenceThreshold = Math.min(0.9, currentParams.confidenceThreshold + 0.05);
    newParams.rsiOverbought = Math.min(80, currentParams.rsiOverbought + 1);
    newParams.rsiOversold = Math.max(20, currentParams.rsiOversold - 1);
  } else if (winRate > 0.6) {
    newParams.confidenceThreshold = Math.max(0.4, currentParams.confidenceThreshold - 0.02);
  }

  return newParams;
}

// ============ RISK MANAGEMENT ============
export function getTodayPnlPct(trades, startingBalance) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayClosed = trades.filter(t => t.status === 'closed' && t.closedAt >= startOfDay.getTime());
  const todayPnl = todayClosed.reduce((sum, t) => sum + t.pnl, 0);
  return todayPnl / startingBalance;
}

export function getConsecutiveLosses(trades) {
  const closed = [...trades].filter(t => t.status === 'closed').sort((a, b) => b.closedAt - a.closedAt);
  let count = 0;
  for (const t of closed) {
    if (t.pnl < 0) count++; else break;
  }
  return count;
}

export function getRiskPause(trades) {
  const dailyPnlPct = getTodayPnlPct(trades, STARTING_CAPITAL);
  if (dailyPnlPct <= -DAILY_LOSS_LIMIT_PCT) {
    return { paused: true, reason: `Limite de perte journalière atteinte (${(dailyPnlPct * 100).toFixed(1)}%).` };
  }

  const consecutiveLosses = getConsecutiveLosses(trades);
  if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
    const closed = [...trades].filter(t => t.status === 'closed').sort((a, b) => b.closedAt - a.closedAt);
    const lastLossTime = closed[0]?.closedAt || Date.now();
    const resumeAt = lastLossTime + CONSECUTIVE_LOSS_PAUSE_MS;
    if (Date.now() < resumeAt) {
      return { paused: true, reason: `${consecutiveLosses} pertes consécutives. Pause jusqu'à ${new Date(resumeAt).toLocaleTimeString('fr-FR')}.` };
    }
  }

  return { paused: false, reason: null };
}

export function getPositionSizeMultiplier(trades) {
  const closed = [...trades].filter(t => t.status === 'closed').sort((a, b) => b.closedAt - a.closedAt);
  if (closed.length === 0) return 1;

  const lastTrade = closed[0];
  if (lastTrade.pnl < 0) {
    const consecutiveLosses = getConsecutiveLosses(trades);
    const reduction = Math.min(0.6, POSITION_SIZE_REDUCTION_AFTER_LOSS * consecutiveLosses);
    return Math.max(0.4, 1 - reduction);
  }
  return 1;
}

// Ajoute une entrée au journal de jugements, avec rotation automatique (garde les N derniers)
function logJudgment(judgmentLog, signal, outcome) {
  const entry = {
    timestamp: signal.timestamp,
    direction: signal.direction,
    confidence: signal.confidence,
    reasons: signal.reasons,
    outcome // 'opened' | 'closed' | 'held' | 'skipped_risk_pause' | 'no_action'
  };
  const updated = [...(judgmentLog || []), entry];
  return updated.length > MAX_JUDGMENT_LOG_SIZE
    ? updated.slice(updated.length - MAX_JUDGMENT_LOG_SIZE)
    : updated;
}

// ============ MAIN DECISION FUNCTION ============
// Prend l'état actuel + les derniers prix (5min et 1h), retourne le nouvel état après décision.
export function runTradingCycle(state, closes, currentPrice, closes1h = null) {
  const { trades, params, account, openPosition } = state;
  const signal = generateSignal(closes, params, closes1h);

  if (!signal) {
    return { ...state, lastSignal: null, lastCheckedAt: Date.now() };
  }

  let newTrades = trades;
  let newAccount = account;
  let newOpenPosition = openPosition;
  let newParams = params;
  const judgmentLog = state.judgmentLog || [];

  // Fermeture de position existante
  if (openPosition) {
    const pnlPct = openPosition.direction === 'BUY'
      ? (currentPrice - openPosition.entryPrice) / openPosition.entryPrice
      : (openPosition.entryPrice - currentPrice) / openPosition.entryPrice;

    const shouldClose = pnlPct >= 0.015 || pnlPct <= -0.008 || signal.direction !== openPosition.direction;

    if (shouldClose) {
      const pnl = openPosition.positionSize * pnlPct;
      const closedTrade = {
        ...openPosition,
        status: 'closed',
        exitPrice: currentPrice,
        pnl,
        pnlPct,
        closedAt: Date.now(),
        closeReason: pnlPct >= 0.015 ? 'target' : pnlPct <= -0.008 ? 'stop' : 'signal_reversal'
      };
      newTrades = trades.map(t => t.id === openPosition.id ? closedTrade : t);
      newAccount = { balance: account.balance + pnl, equity: account.balance + pnl };
      newOpenPosition = null;
      newParams = adjustParamsFromHistory(newTrades, params);

      return {
        ...state,
        trades: newTrades,
        account: newAccount,
        openPosition: newOpenPosition,
        params: newParams,
        lastSignal: signal,
        judgmentLog: logJudgment(judgmentLog, signal, 'closed'),
        lastCheckedAt: Date.now()
      };
    }
  }

  // Ouverture de nouvelle position
  if (!openPosition && signal.direction !== 'NEUTRAL' && signal.confidence >= params.confidenceThreshold) {
    const risk = getRiskPause(trades);
    if (risk.paused) {
      return {
        ...state,
        lastSignal: signal,
        riskPauseReason: risk.reason,
        judgmentLog: logJudgment(judgmentLog, signal, 'skipped_risk_pause'),
        lastCheckedAt: Date.now()
      };
    }

    const sizeMultiplier = getPositionSizeMultiplier(trades);
    const basePositionSize = account.balance * RISK_PER_TRADE * (1 / 0.008);
    const positionSize = Math.min(basePositionSize * sizeMultiplier, account.balance * 0.5);

    const newTrade = {
      id: Date.now(),
      direction: signal.direction,
      entryPrice: currentPrice,
      positionSize,
      sizeMultiplier,
      confidence: signal.confidence,
      reasons: signal.reasons,
      status: 'open',
      openedAt: Date.now()
    };
    newTrades = [...trades, newTrade];
    newOpenPosition = newTrade;

    return {
      ...state,
      trades: newTrades,
      openPosition: newOpenPosition,
      lastSignal: signal,
      riskPauseReason: null,
      judgmentLog: logJudgment(judgmentLog, signal, 'opened'),
      lastCheckedAt: Date.now()
    };
  }

  const outcome = openPosition ? 'held' : 'no_action';
  return {
    ...state,
    lastSignal: signal,
    riskPauseReason: null,
    judgmentLog: logJudgment(judgmentLog, signal, outcome),
    lastCheckedAt: Date.now()
  };
}
