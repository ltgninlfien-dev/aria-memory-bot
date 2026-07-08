"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, TrendingDown, Brain, Activity, AlertTriangle, Target, History, Zap, Download, Upload, RefreshCw, Server } from 'lucide-react';

const STARTING_CAPITAL = 10000;
const REFRESH_INTERVAL = 30000;

function exportMemoryToFile(state) {
  const payload = { ...state, exportedAt: new Date().toISOString(), version: 2 };
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

export default function TradingBot({ apiPath = '/api/state', symbolLabel = 'XAU/USD' }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('live');
  const [importMessage, setImportMessage] = useState(null);
  const fileInputRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(apiPath, { cache: 'no-store' });
      const data = await res.json();
      setState(data);
      setError(null);
    } catch (e) {
      setError('Impossible de contacter le serveur : ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [apiPath]);

  useEffect(() => {
    fetchState();
    intervalRef.current = setInterval(fetchState, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchState]);

  const handleExport = () => {
    if (!state) return;
    exportMemoryToFile(state);
    setImportMessage({ type: 'success', text: 'Sauvegarde téléchargée.' });
    setTimeout(() => setImportMessage(null), 3000);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMessage({ type: 'error', text: "L'import n'est plus disponible depuis cette interface : la mémoire est gérée par le serveur." });
    setTimeout(() => setImportMessage(null), 6000);
    e.target.value = '';
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e8e6e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>
        <div>Chargement...</div>
      </div>
    );
  }

  const trades = state?.trades || [];
  const account = state?.account || { balance: STARTING_CAPITAL };
  const params = state?.params || { rsiOverbought: 70, rsiOversold: 30, confidenceThreshold: 0.4 };
  const openPosition = state?.openPosition || null;
  const lastSignal = state?.lastSignal || null;
  const riskPauseReason = state?.riskPauseReason || null;
  const lastCheckedAt = state?.lastCheckedAt || null;
  const priceHistory = state?.priceHistory || [];

  const closedTrades = trades.filter(t => t.status === 'closed');
  const winRate = closedTrades.length > 0 ? (closedTrades.filter(t => t.pnl > 0).length / closedTrades.length * 100).toFixed(1) : '—';
  const totalPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const equityCurve = closedTrades.reduce((acc, t) => {
    const last = acc.length > 0 ? acc[acc.length - 1].equity : STARTING_CAPITAL;
    acc.push({ trade: acc.length + 1, equity: last + t.pnl });
    return acc;
  }, [{ trade: 0, equity: STARTING_CAPITAL }]);

  const minutesSinceCheck = lastCheckedAt ? Math.round((Date.now() - lastCheckedAt) / 60000) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e8e6e1', fontFamily: "'IBM Plex Mono', 'Courier New', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .label-font { font-family: 'IBM Plex Sans', sans-serif; }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        button:focus-visible, input:focus-visible { outline: 2px solid #d4a843; outline-offset: 2px; }
      `}</style>

      <div style={{ borderBottom: '1px solid #1f2733', padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: 'linear-gradient(135deg, #d4a843, #8a6d1f)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Brain size={20} color="#0a0e14" />
          </div>
          <div>
            <div className="label-font" style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.3 }}>ARIA <span style={{ color: '#d4a843' }}>MEMORY</span></div>
            <div className="label-font" style={{ fontSize: 11, color: '#6b7685', letterSpacing: 1 }}>{symbolLabel} &middot; SERVEUR AUTONOME</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Server size={14} color="#4ade80" />
          <span className="label-font" style={{ fontSize: 12, color: '#9aa3af' }}>
            {minutesSinceCheck !== null ? `Dernière vérif. : il y a ${minutesSinceCheck} min` : 'En attente du premier cycle serveur'}
          </span>
          <button onClick={fetchState} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <RefreshCw size={14} color="#6b7685" />
          </button>
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

        {error && (
          <div style={{ background: '#2a1318', border: '1px solid #4a2229', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="#d4574a" />
            <span className="label-font" style={{ fontSize: 13, color: '#e8a8a8' }}>{error}</span>
          </div>
        )}

        {state?.notice && (
          <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
            <span className="label-font" style={{ fontSize: 13, color: '#9aa3af' }}>{state.notice}</span>
          </div>
        )}

        {riskPauseReason && (
          <div style={{ background: '#2a2010', border: '1px solid #4a3a1f', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={16} color="#d4a843" />
            <span className="label-font" style={{ fontSize: 13, color: '#e8d4a8' }}>Protection active : {riskPauseReason}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 4, background: '#10151f', border: '1px solid #1f2733', borderRadius: 8, padding: 4, marginBottom: 20, width: 'fit-content' }}>
          {['live', 'memoire', 'historique'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: '8px 16px', background: activeTab === tab ? '#1f2733' : 'transparent', border: 'none', borderRadius: 6, color: activeTab === tab ? '#e8e6e1' : '#6b7685', fontFamily: 'IBM Plex Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
              {tab}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label="Capital" value={`$${account.balance.toFixed(2)}`} accent={account.balance >= STARTING_CAPITAL ? '#4ade80' : '#d4574a'} />
          <StatCard label="P&L Total" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} accent={totalPnl >= 0 ? '#4ade80' : '#d4574a'} />
          <StatCard label="Win Rate" value={`${winRate}${winRate !== '—' ? '%' : ''}`} accent="#d4a843" />
          <StatCard label="Trades clos" value={closedTrades.length} accent="#9aa3af" />
          <StatCard label="Seuil confiance" value={`${(params.confidenceThreshold * 100).toFixed(0)}%`} accent="#9aa3af" />
        </div>

        {activeTab === 'live' && (
          <>
            {priceHistory.length > 0 && (
              <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginBottom: 14, letterSpacing: 0.5 }}>{symbolLabel} &middot; 5 MIN (dernier cycle serveur)</div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={priceHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2733" />
                    <XAxis dataKey="time" stroke="#4a5568" fontSize={10} tick={{ fill: '#6b7685' }} />
                    <YAxis domain={['auto', 'auto']} stroke="#4a5568" fontSize={10} tick={{ fill: '#6b7685' }} />
                    <Tooltip contentStyle={{ background: '#0a0e14', border: '1px solid #2a3441', borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="price" stroke="#d4a843" strokeWidth={2} dot={false} />
                    {openPosition && <ReferenceLine y={openPosition.entryPrice} stroke="#4a90d9" strokeDasharray="4 4" label={{ value: 'Entrée', fill: '#4a90d9', fontSize: 10 }} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <Zap size={15} color="#d4a843" />
                  <span className="label-font" style={{ fontSize: 12, color: '#6b7685', letterSpacing: 0.5 }}>DERNIER SIGNAL (serveur)</span>
                </div>
                {lastSignal ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      {lastSignal.direction === 'BUY' ? <TrendingUp color="#4ade80" size={22} /> : lastSignal.direction === 'SELL' ? <TrendingDown color="#d4574a" size={22} /> : <Activity color="#6b7685" size={22} />}
                      <span style={{ fontSize: 20, fontWeight: 700, color: lastSignal.direction === 'BUY' ? '#4ade80' : lastSignal.direction === 'SELL' ? '#d4574a' : '#9aa3af' }}>
                        {lastSignal.direction}
                      </span>
                      <span className="label-font" style={{ fontSize: 11, color: '#6b7685' }}>conf. {(lastSignal.confidence * 100).toFixed(0)}%</span>
                    </div>
                    {lastSignal.reasons?.map((r, i) => (
                      <div key={i} className="label-font" style={{ fontSize: 12, color: '#9aa3af', padding: '4px 0' }}>&bull; {r}</div>
                    ))}
                  </>
                ) : <div className="label-font" style={{ fontSize: 13, color: '#6b7685' }}>Pas encore de signal enregistré.</div>}
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
                ) : <div className="label-font" style={{ fontSize: 13, color: '#6b7685' }}>Aucune position. Le serveur attend un signal fiable.</div>}
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
              Après chaque trade clos, le serveur recalcule le taux de réussite sur les 20 derniers trades et ajuste ses paramètres automatiquement.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              <ParamCard label="Seuil de confiance" value={`${(params.confidenceThreshold * 100).toFixed(0)}%`} />
              <ParamCard label="RSI suracheté" value={params.rsiOverbought} />
              <ParamCard label="RSI survendu" value={params.rsiOversold} />
            </div>
            {closedTrades.length < 5 && (
              <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginTop: 18, fontStyle: 'italic' }}>
                L'ajustement automatique s'active après 5 trades clos. ({closedTrades.length}/5)
              </div>
            )}
          </div>
        )}

        {activeTab === 'historique' && (
          <div>
            <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileSelected} style={{ display: 'none' }} />
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <button onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: '#10151f', border: '1px solid #1f2733', borderRadius: 8, color: '#e8e6e1', fontFamily: 'IBM Plex Sans', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                <Download size={14} color="#d4a843" />
                Exporter la mémoire
              </button>
              <button onClick={handleImportClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: '#10151f', border: '1px solid #1f2733', borderRadius: 8, color: '#e8e6e1', fontFamily: 'IBM Plex Sans', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
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
                <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginBottom: 14 }}>COURBE D'ÉQUITÉ</div>
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
                      {t.status === 'closed' && <span className="label-font" style={{ fontSize: 11, color: '#6b7685' }}>→ ${t.exitPrice.toFixed(2)}</span>}
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
