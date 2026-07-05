"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, TrendingDown, Brain, Activity, Settings, Play, Pause, AlertTriangle, Target, History, Zap, Download, Upload } from 'lucide-react';

// ============ CONSTANTS ============
const STARTING_CAPITAL = 10000;
const RISK_PER_TRADE = 0.01; // 1%
const SYMBOL = 'XAU/USD';
const POLL_INTERVAL = 60000; // 60s entre chaque check (limite API gratuite)

// ============ RISK MANAGEMENT CONSTANTS ============
const DAILY_LOSS_LIMIT_PCT = 0.03; // stop trading si -3% sur la journée
const MAX_CONSECUTIVE_LOSSES = 3; // pause après 3 pertes d'affilée
const CONSECUTIVE_LOSS_PAUSE_MS = 2 * 60 * 60 * 1000; // 2h de pause
const POSITION_SIZE_REDUCTION_AFTER_LOSS = 0.25; // -25% après une perte
const POSITION_SIZE_RECOVERY_STEP = 0.10; // +10% par trade gagnant, retour progressif

// ============ INDICATOR MATH ============
function calcRSI(closes, period = 14) {
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

function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes[0];
  const out = [ema];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function calcMACD(closes) {
  if (closes.length < 26) return null;
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine.slice(-9 - 9), 9);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

function calcBollinger(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + mult * sd, mid: mean, lower: mean - mult * sd };
}

// ============ STORAGE HELPERS (localStorage — persiste dans ce navigateur) ============
async function loadMemory() {
  try {
    const trades = localStorage.getItem('aria-trades-log');
    const params = localStorage.getItem('aria-learned-params');
    const account = localStorage.getItem('aria-account-state');
    return {
      trades: trades ? JSON.parse(trades) : [],
      params: params ? JSON.parse(params) : { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.6 },
      account: account ? JSON.parse(account) : { balance: STARTING_CAPITAL, equity: STARTING_CAPITAL }
    };
  } catch {
    return { trades: [], params: { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.6 }, account: { balance: STARTING_CAPITAL, equity: STARTING_CAPITAL } };
  }
}

async function saveTrades(trades) {
  try { localStorage.setItem('aria-trades-log', JSON.stringify(trades)); } catch (e) { console.error(e); }
}
async function saveParams(params) {
  try { localStorage.setItem('aria-learned-params', JSON.stringify(params)); } catch (e) { console.error(e); }
}
async function saveAccount(account) {
  try { localStorage.setItem('aria-account-state', JSON.stringify(account)); } catch (e) { console.error(e); }
}

// ============ EXPORT / IMPORT MEMORY ============
function exportMemoryToFile(trades, params, account) {
  const payload = {
    exportedAt: new Date().toISOString(),
    trades,
    params,
    account,
    version: 1
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `aria-memory-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importMemoryFromFile(file, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const payload = JSON.parse(e.target.result);
      if (!payload.trades || !payload.params || !payload.account) {
        onError('Fichier invalide : structure inattendue.');
        return;
      }
      onSuccess(payload);
    } catch (err) {
      onError('Fichier invalide : impossible de lire le JSON.');
    }
  };
  reader.onerror = () => onError('Erreur de lecture du fichier.');
  reader.readAsText(file);
}

// ============ SIGNAL ENGINE ============
function generateSignal(closes, params) {
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const boll = calcBollinger(closes);
  if (rsi === null || !macd || !boll) return null;

  const price = closes[closes.length - 1];
  let score = 0;
  const reasons = [];

  if (rsi < params.rsiOversold) { score += 1; reasons.push(`RSI survendu (${rsi.toFixed(1)})`); }
  if (rsi > params.rsiOverbought) { score -= 1; reasons.push(`RSI surachet\u00e9 (${rsi.toFixed(1)})`); }
  if (macd.histogram > 0) { score += 1; reasons.push('MACD haussier'); }
  if (macd.histogram < 0) { score -= 1; reasons.push('MACD baissier'); }
  if (price < boll.lower) { score += 1; reasons.push('Prix sous bande de Bollinger basse'); }
  if (price > boll.upper) { score -= 1; reasons.push('Prix au-dessus bande de Bollinger haute'); }

  const confidence = Math.abs(score) / 3;
  const direction = score > 0 ? 'BUY' : score < 0 ? 'SELL' : 'NEUTRAL';

  return { direction, confidence, score, rsi, macd, boll, price, reasons, timestamp: Date.now() };
}

// ============ LEARNING ENGINE ============
function adjustParamsFromHistory(trades, currentParams) {
  const closed = trades.filter(t => t.status === 'closed');
  if (closed.length < 5) return currentParams;

  const recent = closed.slice(-20);
  const winRate = recent.filter(t => t.pnl > 0).length / recent.length;
  const newParams = { ...currentParams };

  // Si winrate faible, on resserre les seuils (plus s\u00e9lectif)
  if (winRate < 0.4) {
    newParams.confidenceThreshold = Math.min(0.9, currentParams.confidenceThreshold + 0.05);
    newParams.rsiOverbought = Math.min(80, currentParams.rsiOverbought + 1);
    newParams.rsiOversold = Math.max(20, currentParams.rsiOversold - 1);
  } else if (winRate > 0.6) {
    newParams.confidenceThreshold = Math.max(0.4, currentParams.confidenceThreshold - 0.02);
  }

  return newParams;
}

// ============ RISK MANAGEMENT FUNCTIONS ============

// Calcule la perte/gain du jour en cours à partir des trades clos
function getTodayPnlPct(trades, startingBalance) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayClosed = trades.filter(t => t.status === 'closed' && t.closedAt >= startOfDay.getTime());
  const todayPnl = todayClosed.reduce((sum, t) => sum + t.pnl, 0);
  return todayPnl / startingBalance;
}

// Compte les pertes consécutives les plus récentes
function getConsecutiveLosses(trades) {
  const closed = [...trades].filter(t => t.status === 'closed').sort((a, b) => b.closedAt - a.closedAt);
  let count = 0;
  for (const t of closed) {
    if (t.pnl < 0) count++; else break;
  }
  return count;
}

// Détermine si le bot doit être en pause de sécurité, et pourquoi
function getRiskPause(trades, account) {
  const dailyPnlPct = getTodayPnlPct(trades, STARTING_CAPITAL);
  if (dailyPnlPct <= -DAILY_LOSS_LIMIT_PCT) {
    return { paused: true, reason: `Limite de perte journalière atteinte (${(dailyPnlPct * 100).toFixed(1)}%). Reprise demain.`, until: null };
  }

  const consecutiveLosses = getConsecutiveLosses(trades);
  if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
    const closed = [...trades].filter(t => t.status === 'closed').sort((a, b) => b.closedAt - a.closedAt);
    const lastLossTime = closed[0]?.closedAt || Date.now();
    const resumeAt = lastLossTime + CONSECUTIVE_LOSS_PAUSE_MS;
    if (Date.now() < resumeAt) {
      return { paused: true, reason: `${consecutiveLosses} pertes consécutives. Pause de sécurité jusqu'à ${new Date(resumeAt).toLocaleTimeString('fr-FR')}.`, until: resumeAt };
    }
  }

  return { paused: false, reason: null, until: null };
}

// Calcule le multiplicateur de taille de position selon le résultat des derniers trades
function getPositionSizeMultiplier(trades) {
  const closed = [...trades].filter(t => t.status === 'closed').sort((a, b) => b.closedAt - a.closedAt);
  if (closed.length === 0) return 1;

  const lastTrade = closed[0];
  if (lastTrade.pnl < 0) {
    // Réduit après une perte, cumulatif léger selon pertes consécutives récentes
    const consecutiveLosses = getConsecutiveLosses(trades);
    const reduction = Math.min(0.6, POSITION_SIZE_REDUCTION_AFTER_LOSS * consecutiveLosses);
    return Math.max(0.4, 1 - reduction);
  } else {
    // Retour progressif à la normale après un gain
    return 1;
  }
}

// ============ MAIN COMPONENT ============
export default function TradingBot() {
  const [apiKey, setApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [running, setRunning] = useState(false);
  const [priceHistory, setPriceHistory] = useState([]);
  const [currentSignal, setCurrentSignal] = useState(null);
  const [openPosition, setOpenPosition] = useState(null);
  const [trades, setTrades] = useState([]);
  const [params, setParams] = useState({ rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.6 });
  const [account, setAccount] = useState({ balance: STARTING_CAPITAL, equity: STARTING_CAPITAL });
  const [status, setStatus] = useState('idle');
  const [riskStatus, setRiskStatus] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('live');
  const [importMessage, setImportMessage] = useState(null);
  const intervalRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load memory on mount
  useEffect(() => {
    loadMemory().then(mem => {
      setTrades(mem.trades);
      setParams(mem.params);
      setAccount(mem.account);
      const open = mem.trades.find(t => t.status === 'open');
      if (open) setOpenPosition(open);
    });
  }, []);

  const fetchPrice = useCallback(async () => {
    if (!apiKey) return;
    try {
      setStatus('fetching');
      const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(SYMBOL)}&interval=5min&outputsize=50&apikey=${apiKey}`);
      const data = await res.json();
      if (data.status === 'error' || !data.values) {
        setError(data.message || 'Erreur API \u2014 v\u00e9rifie ta cl\u00e9');
        setStatus('error');
        return;
      }
      setError(null);
      const closes = data.values.map(v => parseFloat(v.close)).reverse();
      const chartData = data.values.map(v => ({ time: v.datetime.slice(5, 16), price: parseFloat(v.close) })).reverse();
      setPriceHistory(chartData);

      const signal = generateSignal(closes, params);
      setCurrentSignal(signal);
      setStatus('ok');

      const risk = getRiskPause(trades, account);
      setRiskStatus(risk.paused ? risk : null);

      await evaluateAndTrade(signal, closes[closes.length - 1]);
    } catch (e) {
      setError('Erreur r\u00e9seau: ' + e.message);
      setStatus('error');
    }
  }, [apiKey, params, openPosition, trades, account]);

  const evaluateAndTrade = async (signal, currentPrice) => {
    if (!signal) return;

    // Close existing position if signal reverses or hits target/stop
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
        const newTrades = trades.map(t => t.id === openPosition.id ? closedTrade : t);
        const newBalance = account.balance + pnl;
        const newAccount = { balance: newBalance, equity: newBalance };

        setTrades(newTrades);
        setAccount(newAccount);
        setOpenPosition(null);
        await saveTrades(newTrades);
        await saveAccount(newAccount);

        const newParams = adjustParamsFromHistory(newTrades, params);
        if (JSON.stringify(newParams) !== JSON.stringify(params)) {
          setParams(newParams);
          await saveParams(newParams);
        }
        return;
      }
    }

    // Open new position if no open position and signal is confident enough
    if (!openPosition && signal.direction !== 'NEUTRAL' && signal.confidence >= params.confidenceThreshold) {
      // === PROTECTION 1 & 2 : vérifier si le bot doit être en pause de sécurité ===
      const risk = getRiskPause(trades, account);
      if (risk.paused) {
        setRiskStatus(risk);
        return;
      }
      setRiskStatus(null);

      // === PROTECTION 3 : ajuster la taille de position selon l'historique récent ===
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
      const newTrades = [...trades, newTrade];
      setTrades(newTrades);
      setOpenPosition(newTrade);
      await saveTrades(newTrades);
    }
  };

  useEffect(() => {
    if (running && apiKeySet) {
      fetchPrice();
      intervalRef.current = setInterval(fetchPrice, POLL_INTERVAL);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, apiKeySet, fetchPrice]);

  const handleExport = () => {
    exportMemoryToFile(trades, params, account);
    setImportMessage({ type: 'success', text: 'Sauvegarde téléchargée.' });
    setTimeout(() => setImportMessage(null), 3000);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importMemoryFromFile(
      file,
      async (payload) => {
        setTrades(payload.trades);
        setParams(payload.params);
        setAccount(payload.account);
        const open = payload.trades.find(t => t.status === 'open');
        setOpenPosition(open || null);
        await saveTrades(payload.trades);
        await saveParams(payload.params);
        await saveAccount(payload.account);
        setImportMessage({ type: 'success', text: `Mémoire restaurée (${payload.trades.length} trades, sauvegarde du ${new Date(payload.exportedAt).toLocaleDateString('fr-FR')}).` });
        setTimeout(() => setImportMessage(null), 5000);
      },
      (errorMsg) => {
        setImportMessage({ type: 'error', text: errorMsg });
        setTimeout(() => setImportMessage(null), 5000);
      }
    );
    e.target.value = '';
  };

  const closedTrades = trades.filter(t => t.status === 'closed');
  const winRate = closedTrades.length > 0 ? (closedTrades.filter(t => t.pnl > 0).length / closedTrades.length * 100).toFixed(1) : '\u2014';
  const totalPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const equityCurve = closedTrades.reduce((acc, t) => {
    const last = acc.length > 0 ? acc[acc.length - 1].equity : STARTING_CAPITAL;
    acc.push({ trade: acc.length + 1, equity: last + t.pnl });
    return acc;
  }, [{ trade: 0, equity: STARTING_CAPITAL }]);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e8e6e1', fontFamily: "'IBM Plex Mono', 'Courier New', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .label-font { font-family: 'IBM Plex Sans', sans-serif; }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .scanline { position: relative; overflow: hidden; }
        button:focus-visible, input:focus-visible { outline: 2px solid #d4a843; outline-offset: 2px; }
      `}</style>

      {/* HEADER */}
      <div style={{ borderBottom: '1px solid #1f2733', padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: 'linear-gradient(135deg, #d4a843, #8a6d1f)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Brain size={20} color="#0a0e14" />
          </div>
          <div>
            <div className="label-font" style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.3 }}>ARIA <span style={{ color: '#d4a843' }}>MEMORY</span></div>
            <div className="label-font" style={{ fontSize: 11, color: '#6b7685', letterSpacing: 1 }}>XAU/USD &middot; PAPER TRADING ENGINE</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className={status === 'ok' && running ? 'pulse' : ''} style={{ width: 8, height: 8, borderRadius: '50%', background: status === 'error' ? '#d4574a' : (running ? '#4ade80' : '#6b7685') }} />
            <span className="label-font" style={{ fontSize: 12, color: '#9aa3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {running ? (status === 'ok' ? 'Actif' : status === 'fetching' ? 'Synchro...' : 'Erreur') : 'En pause'}
            </span>
          </div>
        </div>
      </div>

      {/* API KEY SETUP */}
      {!apiKeySet && (
        <div style={{ maxWidth: 520, margin: '60px auto', padding: '0 20px' }}>
          <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Settings size={18} color="#d4a843" />
              <h2 className="label-font" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Configuration requise</h2>
            </div>
            <p className="label-font" style={{ fontSize: 13, color: '#9aa3af', lineHeight: 1.6, marginBottom: 18 }}>
              Cr\u00e9e une cl\u00e9 gratuite sur <a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer" style={{ color: '#d4a843' }}>twelvedata.com</a> pour les donn\u00e9es Or en direct. La cl\u00e9 reste uniquement dans cette session.
            </p>
            <input
              type="password"
              placeholder="Cl\u00e9 API Twelve Data"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', background: '#0a0e14', border: '1px solid #2a3441', borderRadius: 8, color: '#e8e6e1', fontFamily: 'IBM Plex Mono', fontSize: 13, marginBottom: 14 }}
            />
            <button
              onClick={() => apiKey.trim() && setApiKeySet(true)}
              style={{ width: '100%', padding: '12px', background: '#d4a843', border: 'none', borderRadius: 8, color: '#0a0e14', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'IBM Plex Sans' }}
            >
              Connecter
            </button>
          </div>
        </div>
      )}

      {apiKeySet && (
        <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

          {error && (
            <div style={{ background: '#2a1318', border: '1px solid #4a2229', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle size={16} color="#d4574a" />
              <span className="label-font" style={{ fontSize: 13, color: '#e8a8a8' }}>{error}</span>
            </div>
          )}

          {riskStatus && riskStatus.paused && (
            <div style={{ background: '#2a2010', border: '1px solid #4a3a1f', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertTriangle size={16} color="#d4a843" />
              <span className="label-font" style={{ fontSize: 13, color: '#e8d4a8' }}>Protection active : {riskStatus.reason}</span>
            </div>
          )}

          {/* CONTROL BAR */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <button
              onClick={() => setRunning(r => !r)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: running ? '#2a1d10' : '#1a3a2a', border: `1px solid ${running ? '#5a4020' : '#2a5a3a'}`, borderRadius: 8, color: running ? '#d4a843' : '#4ade80', fontFamily: 'IBM Plex Sans', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
            >
              {running ? <Pause size={15} /> : <Play size={15} />}
              {running ? 'Mettre en pause' : 'D\u00e9marrer le bot'}
            </button>
            <div style={{ display: 'flex', gap: 4, background: '#10151f', border: '1px solid #1f2733', borderRadius: 8, padding: 4 }}>
              {['live', 'memoire', 'historique'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{ padding: '8px 16px', background: activeTab === tab ? '#1f2733' : 'transparent', border: 'none', borderRadius: 6, color: activeTab === tab ? '#e8e6e1' : '#6b7685', fontFamily: 'IBM Plex Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* STATS ROW */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard label="Capital" value={`$${account.balance.toFixed(2)}`} accent={account.balance >= STARTING_CAPITAL ? '#4ade80' : '#d4574a'} />
            <StatCard label="P&L Total" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} accent={totalPnl >= 0 ? '#4ade80' : '#d4574a'} />
            <StatCard label="Win Rate" value={`${winRate}${winRate !== '\u2014' ? '%' : ''}`} accent="#d4a843" />
            <StatCard label="Trades clos" value={closedTrades.length} accent="#9aa3af" />
            <StatCard label="Seuil confiance" value={`${(params.confidenceThreshold * 100).toFixed(0)}%`} accent="#9aa3af" />
          </div>

          {activeTab === 'live' && (
            <>
              {/* CHART */}
              <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginBottom: 14, letterSpacing: 0.5 }}>XAU/USD &middot; 5 MIN</div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={priceHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2733" />
                    <XAxis dataKey="time" stroke="#4a5568" fontSize={10} tick={{ fill: '#6b7685' }} />
                    <YAxis domain={['auto', 'auto']} stroke="#4a5568" fontSize={10} tick={{ fill: '#6b7685' }} />
                    <Tooltip contentStyle={{ background: '#0a0e14', border: '1px solid #2a3441', borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="price" stroke="#d4a843" strokeWidth={2} dot={false} />
                    {openPosition && <ReferenceLine y={openPosition.entryPrice} stroke="#4a90d9" strokeDasharray="4 4" label={{ value: 'Entr\u00e9e', fill: '#4a90d9', fontSize: 10 }} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* SIGNAL + POSITION */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <Zap size={15} color="#d4a843" />
                    <span className="label-font" style={{ fontSize: 12, color: '#6b7685', letterSpacing: 0.5 }}>SIGNAL ACTUEL</span>
                  </div>
                  {currentSignal ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        {currentSignal.direction === 'BUY' ? <TrendingUp color="#4ade80" size={22} /> : currentSignal.direction === 'SELL' ? <TrendingDown color="#d4574a" size={22} /> : <Activity color="#6b7685" size={22} />}
                        <span style={{ fontSize: 20, fontWeight: 700, color: currentSignal.direction === 'BUY' ? '#4ade80' : currentSignal.direction === 'SELL' ? '#d4574a' : '#9aa3af' }}>
                          {currentSignal.direction}
                        </span>
                        <span className="label-font" style={{ fontSize: 11, color: '#6b7685' }}>conf. {(currentSignal.confidence * 100).toFixed(0)}%</span>
                      </div>
                      {currentSignal.reasons.map((r, i) => (
                        <div key={i} className="label-font" style={{ fontSize: 12, color: '#9aa3af', padding: '4px 0' }}>&bull; {r}</div>
                      ))}
                    </>
                  ) : <div className="label-font" style={{ fontSize: 13, color: '#6b7685' }}>En attente de donn\u00e9es...</div>}
                </div>

                <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <Target size={15} color="#d4a843" />
                    <span className="label-font" style={{ fontSize: 12, color: '#6b7685', letterSpacing: 0.5 }}>POSITION OUVERTE</span>
                  </div>
                  {openPosition ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: openPosition.direction === 'BUY' ? '#4ade80' : '#d4574a' }}>{openPosition.direction}</span>
                        <span className="label-font" style={{ fontSize: 12, color: '#9aa3af' }}>@ ${openPosition.entryPrice.toFixed(2)}</span>
                      </div>
                      <div className="label-font" style={{ fontSize: 12, color: '#6b7685' }}>Taille: ${openPosition.positionSize.toFixed(2)}</div>
                      <div className="label-font" style={{ fontSize: 12, color: '#6b7685' }}>Ouvert: {new Date(openPosition.openedAt).toLocaleString('fr-FR')}</div>
                    </>
                  ) : <div className="label-font" style={{ fontSize: 13, color: '#6b7685' }}>Aucune position. Le bot attend un signal fiable.</div>}
                </div>
              </div>
            </>
          )}

          {activeTab === 'memoire' && (
            <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                <Brain size={16} color="#d4a843" />
                <span className="label-font" style={{ fontSize: 13, fontWeight: 600 }}>Ce que le bot a appris</span>
              </div>
              <p className="label-font" style={{ fontSize: 13, color: '#9aa3af', lineHeight: 1.7, marginBottom: 20 }}>
                Apr\u00e8s chaque trade clos, le bot recalcule son taux de r\u00e9ussite sur les 20 derniers trades et ajuste ses param\u00e8tres :
                si le winrate descend sous 40%, il devient plus s\u00e9lectif (seuil de confiance et seuils RSI resserr\u00e9s).
                S'il d\u00e9passe 60%, il s'autorise \u00e0 prendre plus de signaux.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                <ParamCard label="Seuil de confiance" value={`${(params.confidenceThreshold * 100).toFixed(0)}%`} />
                <ParamCard label="RSI surachat\u00e9" value={params.rsiOverbought} />
                <ParamCard label="RSI survendu" value={params.rsiOversold} />
              </div>
              {closedTrades.length < 5 && (
                <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginTop: 18, fontStyle: 'italic' }}>
                  L'ajustement automatique s'active apr\u00e8s 5 trades clos. ({closedTrades.length}/5)
                </div>
              )}
            </div>
          )}

          {activeTab === 'historique' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={handleFileSelected}
                style={{ display: 'none' }}
              />
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <button
                  onClick={handleExport}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: '#10151f', border: '1px solid #1f2733', borderRadius: 8, color: '#e8e6e1', fontFamily: 'IBM Plex Sans', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                >
                  <Download size={14} color="#d4a843" />
                  Exporter la mémoire
                </button>
                <button
                  onClick={handleImportClick}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: '#10151f', border: '1px solid #1f2733', borderRadius: 8, color: '#e8e6e1', fontFamily: 'IBM Plex Sans', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                >
                  <Upload size={14} color="#d4a843" />
                  Importer une sauvegarde
                </button>
              </div>
              {importMessage && (
                <div style={{
                  background: importMessage.type === 'success' ? '#10251a' : '#2a1318',
                  border: `1px solid ${importMessage.type === 'success' ? '#1f4a30' : '#4a2229'}`,
                  borderRadius: 8, padding: '10px 14px', marginBottom: 16,
                  fontFamily: 'IBM Plex Sans', fontSize: 12,
                  color: importMessage.type === 'success' ? '#8ae0a8' : '#e8a8a8'
                }}>
                  {importMessage.text}
                </div>
              )}
              {equityCurve.length > 1 && (
                <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20, marginBottom: 16 }}>
                  <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginBottom: 14 }}>COURBE D'\u00c9QUIT\u00c9</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2733" />
                      <XAxis dataKey="trade" stroke="#4a5568" fontSize={10} />
                      <YAxis stroke="#4a5568" fontSize={10} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ background: '#0a0e14', border: '1px solid #2a3441', borderRadius: 8 }} />
                      <ReferenceLine y={STARTING_CAPITAL} stroke="#4a5568" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="equity" stroke="#d4a843" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 20px', borderBottom: '1px solid #1f2733' }}>
                  <History size={15} color="#d4a843" />
                  <span className="label-font" style={{ fontSize: 12, color: '#6b7685', letterSpacing: 0.5 }}>JOURNAL DES TRADES</span>
                </div>
                {trades.length === 0 ? (
                  <div className="label-font" style={{ padding: 24, fontSize: 13, color: '#6b7685' }}>Aucun trade pour l'instant.</div>
                ) : (
                  [...trades].reverse().map(t => (
                    <div key={t.id} style={{ padding: '12px 20px', borderBottom: '1px solid #161c26', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: t.direction === 'BUY' ? '#4ade80' : '#d4574a' }}>{t.direction}</span>
                        <span className="label-font" style={{ fontSize: 12, color: '#9aa3af' }}>@ ${t.entryPrice.toFixed(2)}</span>
                        {t.status === 'closed' && <span className="label-font" style={{ fontSize: 11, color: '#6b7685' }}>\u2192 ${t.exitPrice.toFixed(2)}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {t.status === 'open' ? (
                          <span className="label-font" style={{ fontSize: 11, color: '#4a90d9', padding: '3px 8px', background: '#0d1f33', borderRadius: 4 }}>OUVERT</span>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 600, color: t.pnl >= 0 ? '#4ade80' : '#d4574a' }}>{t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 10, padding: '14px 16px' }}>
      <div className="label-font" style={{ fontSize: 10, color: '#6b7685', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>{value}</div>
    </div>
  );
}

function ParamCard({ label, value }) {
  return (
    <div style={{ background: '#0a0e14', border: '1px solid #1f2733', borderRadius: 8, padding: '14px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#d4a843', marginBottom: 4 }}>{value}</div>
      <div className="label-font" style={{ fontSize: 10, color: '#6b7685' }}>{label}</div>
    </div>
  );
}
