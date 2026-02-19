import React from 'react';

export default function ChartCard({ title, icon, children }) {
  return (
    <div className="chart-card">
      <div className="chart-title">
        {icon}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}
