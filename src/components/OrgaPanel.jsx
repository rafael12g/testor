import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Flag, Users, Clock, MapPin, ChevronDown, ChevronUp, Play, Pause, Square, Timer, CheckCircle, RotateCcw } from 'lucide-react';
import VueBeaconMap from './VueBeaconMap';
import { fetchRaceChrono, startRace, pauseRace, resumeRace, stopRace, pauseTeam, resumeTeam, stopTeam, recordCheckpoint, fetchRaceHistory } from '../api';
import { DEFAULT_START } from '../utils/helpers';

function formatElapsed(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function LiveChrono({ startedAt, resumedAt, elapsed = 0, state = 'stopped' }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [state]);
  let total = elapsed || 0;
  if (state === 'running' && (resumedAt || startedAt)) {
    total += now - (resumedAt || startedAt);
  }
  const cls = state === 'running' ? 'chrono-running' : state === 'paused' ? 'chrono-paused' : 'chrono-stopped';
  return <span className={`chrono-display ${cls}`}>{formatElapsed(total)}</span>;
}

export default function OrgaPanel({ races }) {
  const [selectedRace, setSelectedRace] = useState(null);
  const [chrono, setChrono] = useState(null);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [raceHistory, setRaceHistory] = useState([]);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef(null);

  // Sync selected race quand les courses changent
  useEffect(() => {
    if (!selectedRace) return;
    const updated = races.find(r => r.id === selectedRace.id);
    if (updated) setSelectedRace(updated);
  }, [races, selectedRace]);

  // Poller le chrono de la course sélectionnée
  const pollChrono = useCallback(async () => {
    if (!selectedRace) return;
    const c = await fetchRaceChrono(selectedRace.id);
    setChrono(c);
  }, [selectedRace]);

  useEffect(() => {
    if (!selectedRace) { setChrono(null); return; }
    pollChrono();
    pollRef.current = setInterval(pollChrono, 2000);
    return () => clearInterval(pollRef.current);
  }, [selectedRace, pollChrono]);

  // Historique
  useEffect(() => {
    if (!selectedRace) { setRaceHistory([]); return; }
    const poll = async () => {
      const items = await fetchRaceHistory(selectedRace.id, 50);
      setRaceHistory(items);
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [selectedRace]);

  const handleStartRace = async () => {
    if (!selectedRace) return;
    const msg = chrono?.startedAt
      ? 'La course est déjà en cours. Veux-tu la redémarrer ? (Les chronos seront remis à zéro)'
      : 'Démarrer la course ? Le chrono commencera pour toutes les équipes.';
    if (!confirm(msg)) return;
    setStarting(true);
    await startRace(selectedRace.id);
    await pollChrono();
    setStarting(false);
  };

  const handlePauseRace = async () => {
    if (!selectedRace) return;
    await pauseRace(selectedRace.id);
    await pollChrono();
  };

  const handleResumeRace = async () => {
    if (!selectedRace) return;
    await resumeRace(selectedRace.id);
    await pollChrono();
  };

  const handleStopRace = async () => {
    if (!selectedRace) return;
    if (!confirm('Arrêter la course ? Les chronos seront figés définitivement.')) return;
    await stopRace(selectedRace.id);
    await pollChrono();
  };

  const handlePauseTeam = async (teamCode) => {
    if (!selectedRace) return;
    await pauseTeam(selectedRace.id, teamCode);
    await pollChrono();
  };

  const handleResumeTeam = async (teamCode) => {
    if (!selectedRace) return;
    await resumeTeam(selectedRace.id, teamCode);
    await pollChrono();
  };

  const handleStopTeam = async (teamCode) => {
    if (!selectedRace) return;
    if (!confirm(`Arrêter le chrono de l'équipe ${teamCode} ?`)) return;
    await stopTeam(selectedRace.id, teamCode);
    await pollChrono();
  };

  const handleRecordCheckpoint = async (teamCode, cpIndex) => {
    if (!selectedRace || !chrono?.startedAt) return;
    await recordCheckpoint(selectedRace.id, teamCode, cpIndex);
    await pollChrono();
  };

  const toggleTeam = (code) => {
    setExpandedTeam(prev => prev === code ? null : code);
  };

  const getTeamChrono = (teamCode) => {
    return chrono?.teamChronos?.[teamCode] || null;
  };

  return (
    <div className="stack-lg">
      {/* En-tête */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Activity size={20} style={{ color: 'var(--info)' }} /> Espace Organisateur
            </h2>
            <p className="muted">Supervise tes courses, suis les équipes en temps réel.</p>
          </div>
        </div>

        {/* Sélection de la course */}
        <div style={{ marginTop: '1rem' }}>
          <h3 className="card-title" style={{ marginBottom: '0.75rem' }}>Sélectionne une course</h3>
          <div className="grid">
            {races.length === 0 && <p className="muted">Aucune course disponible pour le moment.</p>}
            {races.map(r => (
              <button key={r.id} onClick={() => { setSelectedRace(r); setExpandedTeam(null); }} className={`race-btn ${selectedRace?.id === r.id ? 'race-btn--active' : ''}`}>
                <div className="race-title">{r.name}</div>
                <div className="muted">{(r.checkpoints || []).length} balises · {(r.teams || []).length} équipes · {r.isActive === false ? 'désactivée' : 'active'}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Panneau de la course sélectionnée */}
      {selectedRace && (
        <>
          {/* Chrono global + Boutons Démarrer/Pause/Stop */}
          <section className="card orga-chrono-card">
            <div className="card-header">
              <div>
                <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Timer size={20} style={{ color: 'var(--warning, #f59e0b)' }} /> {selectedRace.name}
                </h2>
                <p className="muted">
                  {(selectedRace.teams || []).length} équipes · {(selectedRace.checkpoints || []).length} balises
                  {chrono?.state && <> · <span className={`orga-state-pill orga-state-pill--${chrono.state}`}>{chrono.state === 'running' ? 'En cours' : chrono.state === 'paused' ? 'En pause' : 'Arrêtée'}</span></>}
                </p>
              </div>
              <div className="actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <LiveChrono startedAt={chrono?.startedAt} resumedAt={chrono?.resumedAt} elapsed={chrono?.elapsed} state={chrono?.state} />
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {/* Démarrer / Redémarrer */}
                  {(!chrono?.state || chrono.state === 'stopped') && (
                    <button onClick={handleStartRace} disabled={starting} className="btn btn-success btn-lg">
                      <Play size={18} /> {chrono?.stoppedAt ? 'Relancer' : 'Démarrer'}
                    </button>
                  )}
                  {/* Pause */}
                  {chrono?.state === 'running' && (
                    <button onClick={handlePauseRace} className="btn btn-warning btn-lg">
                      <Pause size={18} /> Pause
                    </button>
                  )}
                  {/* Reprendre */}
                  {chrono?.state === 'paused' && (
                    <button onClick={handleResumeRace} className="btn btn-success btn-lg">
                      <Play size={18} /> Reprendre
                    </button>
                  )}
                  {/* Arrêter */}
                  {(chrono?.state === 'running' || chrono?.state === 'paused') && (
                    <button onClick={handleStopRace} className="btn btn-danger btn-lg">
                      <Square size={18} /> Arrêter
                    </button>
                  )}
                  {/* Redémarrer depuis stopped */}
                  {chrono?.state === 'stopped' && chrono?.stoppedAt && (
                    <button onClick={handleStartRace} disabled={starting} className="btn btn-ghost btn-lg">
                      <RotateCcw size={18} /> Nouveau chrono
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Ordre des balises */}
          <section className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Flag size={18} style={{ color: 'var(--primary)' }} /> Parcours — Ordre des balises
            </h3>
            {(selectedRace.checkpoints || []).length === 0 ? (
              <p className="muted">Aucune balise configurée pour cette course.</p>
            ) : (
              <div className="orga-checkpoints-list">
                {selectedRace.checkpoints.map((cp, idx) => (
                  <div key={idx} className="orga-checkpoint-item">
                    <span className="orga-cp-number">{idx + 1}</span>
                    <span className="muted">{cp.lat.toFixed(5)}, {cp.lng.toFixed(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Carte */}
          <section className="card map-card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <MapPin size={18} style={{ color: 'var(--success)' }} /> Carte du parcours
            </h3>
            <VueBeaconMap raceId={selectedRace.id} checkpoints={selectedRace.checkpoints || []} center={selectedRace.start || DEFAULT_START} />
          </section>

          {/* Équipes avec chrono individuel */}
          <section className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={18} style={{ color: 'var(--info)' }} /> Équipes — Chrono & Passages
            </h3>
            {!chrono?.startedAt && <p className="muted" style={{ marginBottom: '0.75rem' }}>Démarre la course pour activer les chronos.</p>}

            <div className="orga-teams-list">
              {(selectedRace.teams || []).length === 0 && <p className="muted">Aucune équipe dans cette course.</p>}
              {(selectedRace.teams || []).map(team => {
                const tc = getTeamChrono(team.code);
                const isExpanded = expandedTeam === team.code;
                const passedCount = tc?.checkpoints?.length || 0;
                const totalCp = (selectedRace.checkpoints || []).length;
                const percent = totalCp > 0 ? Math.round((passedCount / totalCp) * 100) : 0;
                const isFinished = passedCount >= totalCp && totalCp > 0;
                const teamState = tc?.state || (chrono?.state === 'running' ? 'running' : chrono?.state || 'stopped');

                return (
                  <div key={team.code} className={`orga-team-card ${isExpanded ? 'orga-team-card--expanded' : ''} ${isFinished ? 'orga-team-card--finished' : ''} ${teamState === 'paused' ? 'orga-team-card--paused' : ''} ${teamState === 'stopped' && tc ? 'orga-team-card--stopped' : ''}`}>
                    {/* En-tête de l'équipe */}
                    <div className="orga-team-header" onClick={() => toggleTeam(team.code)}>
                      <div className="orga-team-info">
                        <div className="orga-team-name">
                          {isFinished && <CheckCircle size={16} style={{ color: 'var(--success)' }} />}
                          {team.name}
                          <span className="pill">{team.code}</span>
                          {tc?.state && <span className={`orga-state-pill orga-state-pill--${tc.state}`}>{tc.state === 'running' ? '▶' : tc.state === 'paused' ? '⏸' : '⏹'}</span>}
                        </div>
                        <div className="orga-team-stats">
                          {chrono?.startedAt && (
                            <span className="orga-team-chrono">
                              <Clock size={14} />
                              <LiveChrono
                                startedAt={tc?.startedAt || chrono.startedAt}
                                resumedAt={tc?.resumedAt || chrono.resumedAt}
                                elapsed={tc?.elapsed ?? chrono.elapsed}
                                state={tc?.state || chrono.state}
                              />
                            </span>
                          )}
                          <span className="muted">{passedCount}/{totalCp} balises</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {/* Boutons chrono équipe */}
                        {chrono?.state === 'running' && teamState === 'running' && !isFinished && (
                          <button className="btn btn-warning btn-sm" title="Pause équipe" onClick={(e) => { e.stopPropagation(); handlePauseTeam(team.code); }}>
                            <Pause size={14} />
                          </button>
                        )}
                        {teamState === 'paused' && chrono?.state === 'running' && (
                          <button className="btn btn-success btn-sm" title="Reprendre équipe" onClick={(e) => { e.stopPropagation(); handleResumeTeam(team.code); }}>
                            <Play size={14} />
                          </button>
                        )}
                        {(teamState === 'running' || teamState === 'paused') && tc && (
                          <button className="btn btn-danger btn-sm" title="Arrêter équipe" onClick={(e) => { e.stopPropagation(); handleStopTeam(team.code); }}>
                            <Square size={14} />
                          </button>
                        )}
                        <div className="progress-bar" style={{ width: 80 }}><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
                        <span className="progress-percent">{percent}%</span>
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </div>

                    {/* Détail des passages */}
                    {isExpanded && (
                      <div className="orga-team-detail">
                        <table className="table orga-checkpoint-table">
                          <thead>
                            <tr>
                              <th>Balise</th>
                              <th>Coordonnées</th>
                              <th>Temps de passage</th>
                              <th>Temps écoulé</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selectedRace.checkpoints || []).map((cp, idx) => {
                              const passage = tc?.checkpoints?.find(c => c.index === idx);
                              const isPassed = !!passage;
                              const canValidate = chrono?.state === 'running' && teamState === 'running' && !isPassed;
                              return (
                                <tr key={idx} className={isPassed ? 'orga-cp-passed' : ''}>
                                  <td><span className={`orga-cp-badge ${isPassed ? 'orga-cp-badge--done' : ''}`}>{idx + 1}</span></td>
                                  <td className="muted">{cp.lat.toFixed(4)}, {cp.lng.toFixed(4)}</td>
                                  <td>{isPassed ? new Date(passage.time).toLocaleTimeString() : '—'}</td>
                                  <td>{isPassed ? formatElapsed(passage.elapsed) : '—'}</td>
                                  <td>
                                    {canValidate ? (
                                      <button className="btn btn-success btn-sm" onClick={(e) => { e.stopPropagation(); handleRecordCheckpoint(team.code, idx); }}>
                                        <CheckCircle size={14} /> Valider
                                      </button>
                                    ) : isPassed ? (
                                      <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓</span>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Historique de la course */}
          <section className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={18} style={{ color: 'var(--info)' }} /> Historique de la course
            </h3>
            <p className="muted">Événements enregistrés : démarrage, passages de balises…</p>
            <div className="race-history-panel">
              {raceHistory.length === 0 && <p className="muted">Aucun événement enregistré.</p>}
              <ul className="history-list">
                {raceHistory.map((evt, i) => (
                  <li key={evt.id || i} className="history-row">
                    <span className={`history-badge history-badge--${evt.event_type || evt.eventType || 'info'}`}>{evt.event_type || evt.eventType || '?'}</span>
                    <span className="history-msg">
                      {evt.payload ? (typeof evt.payload === 'string' ? evt.payload : JSON.stringify(evt.payload)) : ''}
                    </span>
                    <span className="history-time">{new Date(evt.created_at || evt.ts || evt.timestamp).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
