import React, { useState, useEffect } from 'react';
import { Activity, LineChart, Flag, ShieldCheck, MapPin, Users } from 'lucide-react';
import VueBeaconMap from './VueBeaconMap';
import StatCard from './ui/StatCard';
import ChartCard from './ui/ChartCard';
import MiniLineChart from './ui/MiniLineChart';
import { DEFAULT_START } from '../utils/helpers';

export default function OrgaPanel({
  races, createRace, addCheckpoint, removeCheckpoint, clearCheckpoints,
  createTeam, deleteTeam, seedDemoRace, orgaSim, orgaLocation,
  toggleRaceActive, beaconEvents, serverLogs, socketState, raceHistory,
}) {
  const [selectedRace, setSelectedRace] = useState(null);
  const [newTeamName, setNewTeamName] = useState('');

  useEffect(() => {
    if (!selectedRace) return;
    const updated = races.find(r => r.id === selectedRace.id);
    if (updated) setSelectedRace(updated);
  }, [races, selectedRace]);

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={20} style={{ color: 'var(--primary)' }} /> Tableau Orga
            </h2>
            <p className="muted">Simulation temps réel des équipes et check-ins.</p>
          </div>
          <div className="actions">
            <button onClick={seedDemoRace} className="btn btn-ghost"><Flag size={16} /> Démo</button>
            <button onClick={() => createRace(prompt('Nom de la course ?'))} className="btn btn-primary">+ Créer une course</button>
          </div>
        </div>
        <div className="stats-grid">
          <StatCard icon={<Users size={18} />} label="Équipes actives" value={orgaSim.activeTeams} sub={`${races.reduce((acc, race) => acc + race.teams.length, 0)} au total`} />
          <StatCard icon={<Flag size={18} />} label="Balises" value={races.reduce((acc, race) => acc + race.checkpoints.length, 0)} sub="total" />
          <StatCard icon={<ShieldCheck size={18} />} label="Alertes" value={orgaSim.alerts} sub="signalements" />
          <StatCard icon={<MapPin size={18} />} label="Position orga" value={orgaLocation ? `${orgaLocation.lat.toFixed(4)}, ${orgaLocation.lng.toFixed(4)}` : 'GPS non actif'} sub={orgaLocation ? `±${Math.round(orgaLocation.accuracy)}m · live` : 'Autorise la géolocalisation'} />
        </div>
        <div className="chart-grid">
          <ChartCard title="Check-ins par minute" icon={<Activity size={16} />}><MiniLineChart data={orgaSim.checkinsSeries} color="#0ea5e9" /></ChartCard>
          <ChartCard title="Équipes actives" icon={<LineChart size={16} />}><MiniLineChart data={orgaSim.activeSeries} color="#22c55e" /></ChartCard>
        </div>
        <div className="section-divider" />
        <h3 className="card-title">Backend SQL + logs</h3>
        <p className="muted">Pings balises stockés en BDD SQL. WebSocket: <span className={`ws-pill ws-pill--${socketState}`}>{socketState}</span></p>
        <ul className="list">
          {beaconEvents.length === 0 && <li className="muted">Aucun ping pour l'instant.</li>}
          {beaconEvents.map(event => (
            <li key={event.id} className="list-row">
              <div>
                <div>{event.teamName} <span className="pill">{event.teamCode}</span></div>
                <div className="muted">{event.lat.toFixed(5)}, {event.lng.toFixed(5)} · {event.speedKmh.toFixed(1)} km/h · ±{Math.round(event.accuracy)}m</div>
              </div>
              <span className="muted">{Math.max(0, Math.round((Date.now() - event.updatedAt) / 1000))}s</span>
            </li>
          ))}
        </ul>
        <div className="section-divider" />
        <h3 className="card-title">Logs serveur</h3>
        <ul className="log-list">
          {serverLogs.length === 0 && <li className="muted">Aucun log.</li>}
          {serverLogs.map(log => (
            <li key={log.id} className="log-row">
              <span className={`log-level log-level--${log.level || 'info'}`}>{String(log.level || 'info').toUpperCase()}</span>
              <span>{log.message}</span>
              <span className="muted">{new Date(log.timestamp).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
        <div className="section-divider" />
        <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><LineChart size={18} style={{ color: 'var(--info)' }} /> Historique des courses</h3>
        <p className="muted">Événements enregistrés en BDD : créations, modifications, check-ins…</p>
        <div className="race-history-panel">
          {raceHistory.length === 0 && <p className="muted">Aucun événement enregistré.</p>}
          <ul className="history-list">
            {raceHistory.map((evt, i) => (
              <li key={evt.id || i} className="history-row">
                <span className={`history-badge history-badge--${evt.event_type || evt.eventType || 'info'}`}>{evt.event_type || evt.eventType || '?'}</span>
                <span className="history-msg">{evt.race_id ? `Course #${evt.race_id}` : ''} {evt.payload ? (typeof evt.payload === 'string' ? evt.payload : JSON.stringify(evt.payload)) : ''}</span>
                <span className="history-time">{new Date(evt.ts || evt.timestamp).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Mes Courses</h2>
        <div className="grid">
          {races.length === 0 && <p className="muted">Aucune course. Crée ou lance la démo.</p>}
          {races.map(r => (
            <button key={r.id} onClick={() => setSelectedRace(r)} className={`race-btn ${selectedRace?.id === r.id ? 'race-btn--active' : ''}`}>
              <div className="race-title">{r.name}</div>
              <div className="muted">{r.checkpoints.length} balises · {r.teams.length} équipes · {r.isActive === false ? 'désactivée' : 'active'}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Avancement des équipes</h2>
        <ul className="progress-list">
          {races.flatMap(race => race.teams).length === 0 && <li className="muted">Ajoute des équipes pour suivre leur progression.</li>}
          {races.flatMap(race => race.teams).map(team => {
            const position = orgaSim.teamPositions[team.code] || { index: 0, progress: 0 };
            const total = team.order.length || 0;
            const currentLabel = total === 0 ? 'Aucune balise' : (position.index === 0 ? 'Départ' : `Balise ${position.index}`);
            const nextLabel = total === 0 ? '—' : (position.index >= total ? 'Arrivée' : `Balise ${position.index + 1}`);
            const percent = total === 0 ? 0 : Math.round(position.progress * 100);
            return (
              <li key={team.code} className="progress-row">
                <div>
                  <div className="progress-title">{team.name}</div>
                  <div className="muted">{currentLabel} → {nextLabel} · Code {team.code}</div>
                </div>
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
                <div className="progress-percent">{percent}%</div>
              </li>
            );
          })}
        </ul>
      </section>

      {selectedRace && (
        <div className="grid-2">
          <section className="card map-card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Carte unique (Vue.js + backend SQL)</h3>
                <p className="muted">Course: {selectedRace.name} · clique sur la carte pour ajouter une balise.</p>
              </div>
              <div className="actions">
                <button onClick={() => toggleRaceActive(selectedRace.id)} className="btn btn-ghost">{selectedRace.isActive === false ? 'Activer' : 'Désactiver'}</button>
                <button onClick={() => clearCheckpoints(selectedRace.id)} className="btn btn-danger">Vider balises</button>
              </div>
            </div>
            <VueBeaconMap raceId={selectedRace.id} checkpoints={selectedRace.checkpoints} center={selectedRace.start || DEFAULT_START} orgaLocation={orgaLocation} onMapClick={(latlng) => addCheckpoint(selectedRace.id, latlng)} />
            <ul className="checkpoint-admin">
              {selectedRace.checkpoints.length === 0 && <li className="muted">Aucune balise pour l'instant.</li>}
              {selectedRace.checkpoints.map((cp, idx) => (
                <li key={`${cp.lat}-${cp.lng}-${idx}`} className="checkpoint-admin-row">
                  <span>Balise {idx + 1} · {cp.lat.toFixed(4)}, {cp.lng.toFixed(4)}</span>
                  <button className="btn btn-ghost" onClick={() => removeCheckpoint(selectedRace.id, idx)}>Supprimer</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h3 className="card-title">Gestion Équipes</h3>
            <div className="input-row">
              <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="Nom équipe" className="input" />
              <button onClick={() => { createTeam(selectedRace.id, newTeamName); setNewTeamName(''); }} className="btn btn-success">Ajouter</button>
            </div>
            <ul className="list">
              {selectedRace.teams.length === 0 && <li className="muted">Aucune équipe pour le moment.</li>}
              {selectedRace.teams.map((t, idx) => (
                <li key={idx} className="list-row">
                  <div>
                    <div>{t.name} <span className="pill">Code {t.code}</span></div>
                    {selectedRace.checkpoints.length > 0 && (
                      <div className="muted">Ordre: {t.order.map(cp => selectedRace.checkpoints.findIndex(item => item.lat === cp.lat && item.lng === cp.lng) + 1).filter(n => n > 0).join(' → ')}</div>
                    )}
                  </div>
                  <div className="row-actions">
                    <span className="muted">{t.order.length} balises</span>
                    <button className="btn btn-ghost" onClick={() => deleteTeam(selectedRace.id, t.code)}>Supprimer</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
