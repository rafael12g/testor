import React, { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { MapPin, Flag } from 'lucide-react';
import StatCard from './ui/StatCard';
import NumberedMarker from './ui/NumberedMarker';
import { DEFAULT_START } from '../utils/helpers';

export default function RunnerPanel({ runnerSession, runnerSim, races, runnerProgress, runnerLegProgress, onValidate }) {
  const race = useMemo(() => races.find(r => r.id === runnerSession?.raceId), [races, runnerSession]);
  const totalCheckpoints = runnerSession?.order?.length || 0;
  const nextIndex = runnerProgress;
  const start = race?.start || DEFAULT_START;
  const currentLabel = totalCheckpoints === 0 ? 'Aucune balise' : (nextIndex === 0 ? 'Départ' : `Balise ${nextIndex}`);
  const nextLabel = totalCheckpoints === 0 ? '—' : (nextIndex >= totalCheckpoints ? 'Arrivée' : `Balise ${nextIndex + 1}`);

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Tableau Participant</h2>
            <p className="muted">Course: {race?.name || '—'} · Équipe {runnerSession?.teamName || '—'}</p>
          </div>
          <span className="pill">Code {runnerSession?.code || '—'}</span>
        </div>
        <div className="stats-grid">
          <StatCard icon={<MapPin size={18} />} label="Distance" value={`${runnerSim.distanceKm} km`} sub="progression" />
          <StatCard icon={<Flag size={18} />} label="Balises" value={`${runnerProgress}/${totalCheckpoints}`} sub="validées" />
          <StatCard icon={<Flag size={18} />} label="Position" value={`${currentLabel} → ${nextLabel}`} sub={`${Math.round(runnerLegProgress * 100)}%`} />
        </div>
        <div className="runner-actions">
          <button className="btn btn-success" onClick={onValidate} disabled={runnerProgress >= totalCheckpoints || runnerLegProgress < 1}>Valider la prochaine balise</button>
        </div>
      </section>

      <section className="card map-card">
        <h3 className="card-title">Carte des balises</h3>
        <div className="map-shell">
          <MapContainer center={[start.lat, start.lng]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <CircleMarker center={[start.lat, start.lng]} radius={7} pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.8 }}><Popup>Départ</Popup></CircleMarker>
            {(runnerSession?.order || []).map((cp, index) => {
              const isDone = index < runnerProgress;
              const isNext = index === nextIndex;
              const color = isDone ? '#22c55e' : isNext ? '#f59e0b' : '#94a3b8';
              return <NumberedMarker key={`${cp.lat}-${cp.lng}-${index}`} position={[cp.lat, cp.lng]} number={index + 1} color={color} />;
            })}
          </MapContainer>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Ordre des balises</h3>
        <ol className="checkpoint-list">
          {(runnerSession?.order || []).map((cp, index) => (
            <li key={`${cp.lat}-${cp.lng}-${index}`} className={`checkpoint ${index < runnerProgress ? 'checkpoint--done' : ''}`}>Balise {index + 1} · {cp.lat.toFixed(4)}, {cp.lng.toFixed(4)}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
