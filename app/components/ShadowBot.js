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

// Formate une durée en minutes vers un texte lisible (ex: "2h15", "45min")
function formatDuration(openedAt, closedAt) {
  const minutes = Math.round((closedAt - openedAt) / 60000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h${rem}` : `${hours}h`;
}

// Génère une interprétation factuelle du trade — basée sur la mécanique connue (raison de
// clôture, gain/perte), jamais une spéculation sur le marché que le système ne peut pas vérifier.
function interpretTrade(trade) {
  const won = trade.pnl >= 0;
  switch (trade.closeReason) {
    case 'stop_loss':
      return won
        ? "Cas rare : sortie sur stop-loss avec un léger gain — probablement un mouvement de prix entre deux vérifications (cron 30 min)."
        : "Sortie sur stop-loss fixe (1.5×ATR). Le marché est allé à l'encontre de la position sans jamais atteindre le seuil de break-even (+1×ATR). Leçon : ce trade n'a montré aucun signe de traction favorable dès le départ.";
    case 'breakeven_stop':
      return Math.abs(trade.pnl) < 1
        ? "Position sortie proche de l'équilibre : le trade est parti en profit, le stop a été remonté à l'entrée, puis le marché s'est retourné. Le capital a été protégé comme prévu."
        : `Sortie au break-even avec un écart de $${trade.pnl.toFixed(2)} — signe probable d'un léger décalage d'exécution dû à la vérification toutes les 30 minutes plutôt qu'en continu.`;
    case 'trailing_stop':
      return won
        ? "Gain sécurisé par le trailing stop après un mouvement favorable prolongé. Le take-profit fixe aurait pu couper le gain plus tôt ou plus tard selon le cas — ici le trailing a mieux suivi le mouvement."
        : "Le trailing s'était activé (trade en profit à un moment) mais le marché s'est retourné plus vite que le stop ne pouvait suivre. Leçon : un trailing à 1.5×ATR peut encore laisser une perte modérée si le retournement est brutal.";
    case 'manual_close':
      return won
        ? "Fermé manuellement en profit — décision humaine plutôt qu'un mécanisme automatique. Utile pour comparer plus tard si sortir plus tôt aurait été préférable au trailing."
        : "Fermé manuellement en perte — décision humaine plutôt qu'un mécanisme automatique.";
    default:
      return "Raison de clôture non reconnue.";
  }
}

export default function ShadowBot({ symbol = 'XAU/USD' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);
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

  const handleManualClose = async () => {
    const confirmed = window.confirm(
      `Fermer maintenant la position shadow ${symbol} ? Cette action est définitive.`
    );
    if (!confirmed) return;

    setClosing(true);
    try {
      const res = await fetch(
        `/api/shadow-close?symbol=${encodeURIComponent(symbol)}&secret=c10b0989d426492f8413f93d0727132c`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (!res.ok) {
        alert(`Erreur : ${json.error}`);
      } else {
        await fetchData();
      }
    } catch (e) {
      alert('Erreur lors de la fermeture : ' + e.message);
    } finally {
      setClosing(false);
    }
  };

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
  const equityCurve = data?.equityCurve || [];
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

        {equityCurve.length > 1 && (
          <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div className="label-font" style={{ fontSize: 12, color: '#6b7685', marginBottom: 14, letterSpacing: 0.5 }}>COURBE DE CAPITAL SHADOW</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={equityCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2733" />
                <XAxis dataKey="trade" stroke="#4a5568" fontSize={10} tick={{ fill: '#6b7685' }} />
                <YAxis stroke="#4a5568" fontSize={10} tick={{ fill: '#6b7685' }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: '#0a0e14', border: '1px solid #2a3441', borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={10000} stroke="#4a5568" strokeDasharray="4 4" label={{ value: 'Départ', fill: '#6b7685', fontSize: 10 }} />
                <Line type="monotone" dataKey="equity" stroke="#9d7ad4" strokeWidth={2} dot={false} />
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

              <button
                onClick={handleManualClose}
                disabled={closing}
                style={{
                  marginTop: 16,
                  width: '100%',
                  padding: '10px 16px',
                  background: closing ? '#1f2733' : '#2a1318',
                  border: '1px solid #4a2229',
                  borderRadius: 8,
                  color: closing ? '#6b7685' : '#e8a8a8',
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: closing ? 'not-allowed' : 'pointer',
                }}
              >
                {closing ? 'Fermeture en cours...' : 'Fermer maintenant (sortie manuelle)'}
              </button>
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
              <div key={t.id} style={{ padding: '14px 20px', borderBottom: '1px solid #161c26' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.direction === 'BUY' ? '#4ade80' : '#d4574a' }}>{t.direction}</span>
                    <span className="label-font" style={{ fontSize: 12, color: '#9aa3af' }}>@ ${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)}</span>
                    <span className="label-font" style={{ fontSize: 10, color: '#6b7685', padding: '2px 6px', background: '#0a0e14', borderRadius: 4 }}>{t.closeReason}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.pnl >= 0 ? '#4ade80' : '#d4574a' }}>{t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}</span>
                </div>
                {t.openedAt && t.closedAt && (
                  <div className="label-font" style={{ fontSize: 11, color: '#6b7685', marginBottom: 6 }}>
                    Ouvert le {new Date(t.openedAt).toLocaleString('fr-FR')} &middot; Fermé le {new Date(t.closedAt).toLocaleString('fr-FR')} &middot; Durée : {formatDuration(t.openedAt, t.closedAt)}
                  </div>
                )}
                <div className="label-font" style={{ fontSize: 12, color: '#9aa3af', lineHeight: 1.5, fontStyle: 'italic' }}>
                  {interpretTrade(t)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
