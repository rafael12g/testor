import React from 'react';

export default function StatCard({ icon, label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="muted" style={{ fontSize: '0.72rem', marginTop: '0.1rem' }}>{sub}</div>}
      </div>
    </div>
  );
}
