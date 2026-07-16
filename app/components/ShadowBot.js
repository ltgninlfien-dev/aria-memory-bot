"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, TrendingDown, Target, RefreshCw, FlaskConical, ShieldCheck } from 'lucide-react';

const REFRESH_INTERVAL = 30000;

const STATUS_LABELS = {
  sl_fixe: { label: 'Stop-loss fixe', color: '#d4574a' },
  breakeven_actif: { label: 'Break-even actif', color: '#d4a843' },
  trailing_actif: { label: 'Trailing actif', color: '#4ade80' },
};

export default function ShadowBot({ symbol = 'XAU/USD' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/shadow-detail?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError('Impossible de contacter le serveur : ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e8e6e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>
        <div>Chargement...</div>
      </div>
    );
  }

  const priceHistory = data?.priceHistory || [];
  const openPosition = data?.openPosition || null;
  const positionStatus = data?.positionStatus || null;
  const recentClosedTrades = data?.recentClosedTrades || [];
  const balance = data?.balance;

  const currentPrice = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].price : null;

  const livePnl = openPosition && currentPrice !== null
    ? (() => {
        const pnlPct = openPosition.direction === 'BUY'
          ? (currentPrice - openPosition.entryPrice) / openPosition.entryPrice
          : (openPosition.entryPrice - currentPrice) / openPosition.entryPrice;
        return { pnlPct, pnl: openPosition.positionSize * pnlPct };
      })()
    : null;

  const statusInfo = positionStatus ? STATUS_LABELS[positionStatus] : null;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e8e6e1', fontFamily: "'IBM Plex Mono', 'Courier New', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .label-font { font-family: 'IBM Plex Sans', sans-serif; }
        button:focus-visible { outline: 2px solid #9d7ad4; outline-offset: 2px; }
      `}</style>

      <div style={{ borderBottom: '1px solid #1f2733', padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: 'linear-gradient(135deg, #9d7ad4, #5c3d8a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FlaskConical size={20} color="#0a0e14" />
          </div>
          <div>
            <div className="label-font" style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.3 }}>ARIA <span style={{ color: '#9d7ad4' }}>SHADOW V2</span></div>
            <div className="label-font" style={{ fontSize: 11, color: '#6b7685', letterSpacing: 1 }}>{symbol} &middot; SIMULATION — CAPITAL FICTIF SÉPARÉ</div>
          </div>
        </div>
        <button onClick={fetchData} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <RefreshCw size={14} color="#6b7685" />
        </button>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

        {error && (
          <div style={{ background: '#2a1318', border: '1px solid #4a2229', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
            <span className="label-font" style={{ fontSize: 13, color: '#e8a8a8' }}>{error}</span>
          </div>
        )}

        {balance !== null && balance !== undefined && (
          <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 10, padding: '14px 16px', marginBottom: 20, width: 'fit-content' }}>
            <div className="label-font" style={{ fontSize: 10, color: '#6b7685', letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }}>Capital fictif shadow</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: balance >= 10000 ? '#4ade80' : '#d4574a' }}>${balance.toFixed(2)}</div>
          </div>
        )}

        {priceHistory.length > 0 && (
          <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginBottom: 14, letterSpacing: 0.5 }}>{symbol} &middot; 5 MIN</div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={priceHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2733" />
                <XAxis dataKey="time" stroke="#4a5568" fontSize={10} tick={{ fill: '#6b7685' }} />
                <YAxis domain={['auto', 'auto']} stroke="#4a5568" fontSize={10} tick={{ fill: '#6b7685' }} />
                <Tooltip contentStyle={{ background: '#0a0e14', border: '1px solid #2a3441', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="price" stroke="#9d7ad4" strokeWidth={2} dot={false} />
                {openPosition && (
                  <ReferenceLine y={openPosition.entryPrice} stroke="#4a90d9" strokeDasharray="4 4" label={{ value: 'Entrée', fill: '#4a90d9', fontSize: 10 }} />
                )}
                {openPosition && (
                  <ReferenceLine y={openPosition.stopLoss} stroke="#d4574a" strokeDasharray="4 4" label={{ value: 'SL', fill: '#d4574a', fontSize: 10 }} />
                )}
                {openPosition && !openPosition.trailingActive && (
                  <ReferenceLine y={openPosition.takeProfit} stroke="#4ade80" strokeDasharray="4 4" label={{ value: 'TP', fill: '#4ade80', fontSize: 10 }} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Target size={15} color="#9d7ad4" />
            <span className="label-font" style={{ fontSize: 12, color: '#6b7685', letterSpacing: 0.5 }}>POSITION SHADOW OUVERTE</span>
          </div>

          {openPosition ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                {openPosition.direction === 'BUY' ? <TrendingUp color="#4ade80" size={20} /> : <TrendingDown color="#d4574a" size={20} />}
                <span style={{ fontSize: 18, fontWeight: 700, color: openPosition.direction === 'BUY' ? '#4ade80' : '#d4574a' }}>{openPosition.direction}</span>
                <span className="label-font" style={{ fontSize: 12, color: '#9aa3af' }}>@ ${openPosition.entryPrice.toFixed(2)}</span>
                {statusInfo && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: statusInfo.color, padding: '3px 8px', background: '#0a0e14', border: `1px solid ${statusInfo.color}`, borderRadius: 4 }}>
                    <ShieldCheck size={11} />
                    {statusInfo.label}
                  </span>
                )}
              </div>

              {livePnl !== null && (
                <div style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: livePnl.pnl >= 0 ? '#4ade80' : '#d4574a' }}>
                    {livePnl.pnl >= 0 ? '+' : ''}${livePnl.pnl.toFixed(2)}
                  </span>
                  <span className="label-font" style={{ fontSize: 11, color: '#6b7685', marginLeft: 6 }}>
                    ({livePnl.pnlPct >= 0 ? '+' : ''}{(livePnl.pnlPct * 100).toFixed(2)}%, non réalisé)
                  </span>
                </div>
              )}

              <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginBottom: 4 }}>Taille : ${openPosition.positionSize.toFixed(2)}</div>
              <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginBottom: 4 }}>Score V2 à l'ouverture : {openPosition.score}</div>
              <div className="label-font" style={{ fontSize: 12, color: '#6b7685' }}>Ouvert : {new Date(openPosition.openedAt).toLocaleString('fr-FR')}</div>

              <div style={{ display: 'flex', gap: 20, marginTop: 14, paddingTop: 14, borderTop: '1px solid #1f2733', flexWrap: 'wrap' }}>
                <div>
                  <div className="label-font" style={{ fontSize: 10, color: '#6b7685', textTransform: 'uppercase' }}>Stop-loss actuel</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#d4574a' }}>${openPosition.stopLoss.toFixed(2)}</div>
                </div>
                {!openPosition.trailingActive && (
                  <div>
                    <div className="label-font" style={{ fontSize: 10, color: '#6b7685', textTransform: 'uppercase' }}>Take-profit</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>${openPosition.takeProfit.toFixed(2)}</div>
                  </div>
                )}
                {openPosition.trailingActive && (
                  <div>
                    <div className="label-font" style={{ fontSize: 10, color: '#6b7685', textTransform: 'uppercase' }}>Sortie</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#4ade80' }}>Trailing (pas de TP fixe)</div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="label-font" style={{ fontSize: 13, color: '#6b7685' }}>Aucune position shadow. En attente d'un signal V2 fiable.</div>
          )}
        </div>

        <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #1f2733' }}>
            <span className="label-font" style={{ fontSize: 12, color: '#6b7685', letterSpacing: 0.5 }}>DERNIERS TRADES SHADOW CLOS</span>
          </div>
          {recentClosedTrades.length === 0 ? (
            <div className="label-font" style={{ padding: 24, fontSize: 13, color: '#6b7685' }}>Aucun trade clos pour l'instant.</div>
          ) : (
            recentClosedTrades.map(t => (
              <div key={t.id} style={{ padding: '12px 20px', borderBottom: '1px solid #161c26', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: t.direction === 'BUY' ? '#4ade80' : '#d4574a' }}>{t.direction}</span>
                  <span className="label-font" style={{ fontSize: 12, color: '#9aa3af' }}>@ ${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)}</span>
                  <span className="label-font" style={{ fontSize: 10, color: '#6b7685', padding: '2px 6px', background: '#0a0e14', borderRadius: 4 }}>{t.closeReason}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: t.pnl >= 0 ? '#4ade80' : '#d4574a' }}>{t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
