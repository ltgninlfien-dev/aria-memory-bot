"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';

export default function PredictionsBot() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPredictions = useCallback(async () => {
    try {
      const res = await fetch('/api/predictions', { cache: 'no-store' });
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError('Impossible de contacter le serveur : ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPredictions();
  }, [fetchPredictions]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e8e6e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>
        <div>Chargement...</div>
      </div>
    );
  }

  const predictions = data?.predictions || [];

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e14', color: '#e8e6e1', fontFamily: "'IBM Plex Mono', 'Courier New', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        .label-font { font-family: 'IBM Plex Sans', sans-serif; }
        button:focus-visible { outline: 2px solid #4ade80; outline-offset: 2px; }
      `}</style>

      <div style={{ borderBottom: '1px solid #1f2733', padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: 'linear-gradient(135deg, #4ade80, #1f7a4a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Trophy size={20} color="#0a0e14" />
          </div>
          <div>
            <div className="label-font" style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.3 }}>PRÉDIRE <span style={{ color: '#4ade80' }}>FOOT</span></div>
            <div className="label-font" style={{ fontSize: 11, color: '#6b7685', letterSpacing: 1 }}>{data?.date} &middot; MODÈLE POISSON</div>
          </div>
        </div>
        <button onClick={fetchPredictions} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <RefreshCw size={14} color="#6b7685" />
        </button>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

        {error && (
          <div style={{ background: '#2a1318', border: '1px solid #4a2229', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
            <span className="label-font" style={{ fontSize: 13, color: '#e8a8a8' }}>{error}</span>
          </div>
        )}

        {data?.message && (
          <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
            <span className="label-font" style={{ fontSize: 13, color: '#9aa3af' }}>{data.message}</span>
          </div>
        )}

        {predictions.length === 0 && !data?.message && (
          <div className="label-font" style={{ fontSize: 13, color: '#6b7685' }}>Aucun match pour cette date.</div>
        )}

        {predictions.map((match) => (
          <MatchCard key={match.fixtureId} match={match} />
        ))}
      </div>
    </div>
  );
}

function MatchCard({ match }) {
  const { homeTeam, awayTeam, league, prediction, leagueAveragesReliable } = match;
  const { topScores, outcomes, scoring, coherence } = prediction;
  const topScore = topScores[0];

  return (
    <div style={{ background: '#10151f', border: '1px solid #1f2733', borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div className="label-font" style={{ fontSize: 11, color: '#6b7685', marginBottom: 10, letterSpacing: 0.5 }}>
        {league.name} &middot; {league.country}
        {!leagueAveragesReliable && (
          <span style={{ color: '#d4a843', marginLeft: 8 }}>⚠ moyennes par défaut (échantillon insuffisant)</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{homeTeam.name}</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#4ade80' }}>{topScore.home} - {topScore.away}</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{awayTeam.name}</span>
      </div>

      <div className="label-font" style={{ fontSize: 11, color: '#6b7685', textAlign: 'center', marginBottom: 16 }}>
        Score le plus probable ({(topScore.p * 100).toFixed(1)}%)
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
        <ProbBar label="Domicile" value={outcomes.pHome} color="#4ade80" />
        <ProbBar label="Nul" value={outcomes.pDraw} color="#9aa3af" />
        <ProbBar label="Extérieur" value={outcomes.pAway} color="#d4574a" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid #1f2733' }}>
        {coherence.coherent ? (
          <CheckCircle2 size={14} color="#4ade80" />
        ) : (
          <XCircle size={14} color="#d4574a" />
        )}
        <span className="label-font" style={{ fontSize: 11, color: '#9aa3af' }}>
          Score pondéré ({scoring.homeScore.toFixed(0)}/{scoring.awayScore.toFixed(0)}) : {coherence.coherent ? 'cohérent avec le Poisson' : 'diverge du modèle Poisson — à considérer avec prudence'}
        </span>
      </div>
    </div>
  );
}

function ProbBar({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="label-font" style={{ fontSize: 10, color: '#6b7685', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{(value * 100).toFixed(0)}%</div>
    </div>
  );
}
