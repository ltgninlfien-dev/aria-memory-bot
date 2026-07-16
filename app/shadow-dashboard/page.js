"use client";
import React, { useState } from 'react';
import ShadowBot from '../components/ShadowBot';

export default function ShadowDashboardPage() {
  const [symbol, setSymbol] = useState('XAU/USD');

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, padding: '16px 28px 0', background: '#0a0e14' }}>
        {['XAU/USD', 'EUR/USD'].map(s => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            style={{
              padding: '8px 16px',
              background: symbol === s ? '#1f2733' : 'transparent',
              border: '1px solid #1f2733',
              borderRadius: 6,
              color: symbol === s ? '#e8e6e1' : '#6b7685',
              fontFamily: 'IBM Plex Sans, sans-serif',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <ShadowBot symbol={symbol} />
    </div>
  );
}
