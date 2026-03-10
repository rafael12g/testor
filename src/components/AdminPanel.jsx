import React from 'react';
import { ShieldCheck, Activity, LineChart } from 'lucide-react';

export default function AdminPanel({ races, adminLogs, raceHistory, permissions = {} }) {
  const canSeeCourses = permissions.acces_courses_lecture !== false;
  const canSeeBalises = permissions.acces_balises_lecture !== false;
  const canSeeEquipes = permissions.acces_equipes_lecture !== false;
  const canSeeEtatCourse = permissions.acces_etat_course_lecture !== false;

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck size={20} style={{ color: 'var(--danger)' }} /> Console Admin
          </h2>
          <p className="muted">Gestion du site — vue globale des courses (lecture seule depuis l'API).</p>
        </div>
      </div>

      <table className="table">
        <thead><tr>{canSeeCourses && <th>Course</th>}{canSeeBalises && <th>Balises</th>}{canSeeEquipes && <th>Équipes</th>}{canSeeEtatCourse && <th>Statut</th>}</tr></thead>
        <tbody>
          {!canSeeCourses && <tr><td colSpan={4} className="muted">Accès aux courses non autorisé.</td></tr>}
          {canSeeCourses && races.length === 0 && <tr><td colSpan={4} className="muted">Aucune course disponible.</td></tr>}
          {canSeeCourses && races.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td>
              {canSeeBalises && <td>{(r.checkpoints || []).length}</td>}
              {canSeeEquipes && <td>{(r.teams || []).length}</td>}
              {canSeeEtatCourse && <td>{r.isActive === false ? 'désactivée' : 'active'}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-divider" />
      <div className="card-header">
        <div>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={18} style={{ color: 'var(--primary)' }} /> Logs serveur</h3>
          <p className="muted">Logs temps réel du serveur, mis à jour automatiquement.</p>
        </div>
      </div>
      <div className="admin-logs-panel">
        {adminLogs.length === 0 && <p className="muted">Aucun log enregistré.</p>}
        <ul className="log-list">
          {adminLogs.map((log, i) => (
            <li key={log.id || i} className="log-row">
              <span className={`log-level log-level--${log.level || 'info'}`}>{String(log.level || 'info').toUpperCase()}</span>
              <span className="log-message">{log.message}</span>
              {log.meta && <span className="log-meta">{typeof log.meta === 'string' ? log.meta : JSON.stringify(log.meta)}</span>}
              <span className="log-time">{new Date(log.ts || log.timestamp).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="section-divider" />
      <div className="card-header">
        <div>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><LineChart size={18} style={{ color: 'var(--info)' }} /> Historique des courses</h3>
          <p className="muted">Événements de toutes les courses : créations, modifications, check-ins…</p>
        </div>
      </div>
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
    </div>
  );
}
