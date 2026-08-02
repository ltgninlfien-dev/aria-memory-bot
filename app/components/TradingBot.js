"use client";
import React, { useState, useEffect } from 'react';
import { Brain, TrendingUp, Activity, Trophy, ChevronRight, Server } from 'lucide-react';

const CARD_ACCENT = '#D4AF37';
const CARD_ACCENT_DARK = '#B8860B';

function useReadOnly(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(path, { cache: 'no-store' })
      .then(res => res.json())
      .then(json => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [path]);

  return { data, error };
}

function Card({ href, icon, title, subtitle, children }) {
  return (
    <a href={href} style={{
      display: 'block', textDecoration: 'none', color: 'inherit',
      background: '#1A1A22', border: '1px solid #2c2c38', borderRadius: 14,
      padding: 20, transition: 'border-color 0.15s'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, background: '#242430',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {icon}
          </div>
          <div>
            <div className="body-font" style={{ fontSize: 15, fontWeight: 700, color: '#FFFFFF' }}>{title}</div>
            <div className="body-font" style={{ fontSize: 11, color: '#8a8a95' }}>{subtitle}</div>
          </div>
        </div>
        <ChevronRight size={18} color="#8a8a95" />
      </div>
      {children}
    </a>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <div>
      <div className="body-font" style={{ fontSize: 10, color: '#8a8a95', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: accent || '#FFFFFF' }}>{value}</div>
    </div>
  );
}

export default function Hub() {
  const { data: xau } = useReadOnly('/api/state');
  const { data: eur } = useReadOnly('/api/state-eurusd');
  const { data: shadowXau } = useReadOnly('/api/shadow-stats?symbol=XAU/USD');
  const { data: shadowEur } = useReadOnly('/api/shadow-stats?symbol=EUR/USD');
  const { data: predictions } = useReadOnly('/api/predictions');

  const fmtMoney = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : '—');

  return (
    <div style={{ minHeight: '100vh', background: '#0B0B0F', color: '#FFFFFF', fontFamily: "'Montserrat', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Montserrat:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .body-font { font-family: 'Montserrat', sans-serif; }
        .title-font { font-family: 'Cinzel', serif; letter-spacing: 0.5px; }
        a:active { opacity: 0.8; }
      `}</style>

      <div style={{ borderBottom: '1px solid #2c2c38', padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 9, background: `linear-gradient(135deg, ${CARD_ACCENT}, ${CARD_ACCENT_DARK})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Brain size={21} color="#0B0B0F" />
        </div>
        <div>
          <div className="title-font" style={{ fontSize: 19, fontWeight: 700 }}>AURUM AI <span style={{ color: CARD_ACCENT }}>90MM</span></div>
          <div className="body-font" style={{ fontSize: 11, color: '#8a8a95', letterSpacing: 1 }}>NAVIGATION CENTRALE</div>
        </div>
      </div>

      <div style={{ padding: '24px 20px', maxWidth: 640, margin: '0 auto', display: 'grid', gap: 14 }}>

        <Card href="/xauusd" icon={<TrendingUp size={17} color={CARD_ACCENT} />} title="XAU/USD" subtitle="Bot réel · V1/V2">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <MiniStat label="Capital" value={fmtMoney(xau?.account?.balance)} accent="#4ade80" />
            <MiniStat label="Position" value={xau?.openPosition ? xau.openPosition.direction : 'Aucune'} accent={xau?.openPosition ? '#4a90d9' : '#8a8a95'} />
          </div>
        </Card>

        <Card href="/eurusd" icon={<TrendingUp size={17} color={CARD_ACCENT} />} title="EUR/USD" subtitle="Bot réel · V1/V2">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <MiniStat label="Capital" value={fmtMoney(eur?.account?.balance)} accent="#4ade80" />
            <MiniStat label="Position" value={eur?.openPosition ? eur.openPosition.direction : 'Aucune'} accent={eur?.openPosition ? '#4a90d9' : '#8a8a95'} />
          </div>
        </Card>

        <Card href="/shadow-dashboard" icon={<Activity size={17} color={CARD_ACCENT} />} title="Shadow V2" subtitle="XAU/USD + EUR/USD · Simulation">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <MiniStat label="XAU Win Rate" value={shadowXau?.winRate != null ? `${shadowXau.winRate}%` : '—'} />
            <MiniStat label="EUR Win Rate" value={shadowEur?.winRate != null ? `${shadowEur.winRate}%` : '—'} />
          </div>
        </Card>

        <Card href="/predictions-dashboard" icon={<Trophy size={17} color={CARD_ACCENT} />} title="PrédireFoot" subtitle="Prédictions du jour">
          <MiniStat
            label="Matchs analysés"
            value={Array.isArray(predictions?.matches) ? predictions.matches.length : (predictions?.count ?? '—')}
          />
        </Card>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 8 }}>
          <Server size={12} color="#4ade80" />
          <span className="body-font" style={{ fontSize: 11, color: '#8a8a95' }}>Aperçu en lecture seule — aucun appel Twelve Data</span>
        </div>

      </div>
    </div>
  );
}
