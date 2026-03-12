import React, { useState } from 'react';
import { ShieldCheck, Activity, LineChart, UserPlus } from 'lucide-react';
import { registerOrga } from '../api';

export default function AdminPanel({ races, adminLogs, raceHistory, permissions = {} }) {
  const canSeeCourses = permissions.acces_courses_lecture !== false;
  const canSeeBalises = permissions.acces_balises_lecture !== false;
  const canSeeEquipes = permissions.acces_equipes_lecture !== false;
  const canSeeEtatCourse = permissions.acces_etat_course_lecture !== false;

  const [orgaUsername, setOrgaUsername] = useState('');
  const [orgaPassword, setOrgaPassword] = useState('');
  const [orgaConfirm, setOrgaConfirm] = useState('');
  const [orgaError, setOrgaError] = useState('');
  const [orgaSuccess, setOrgaSuccess] = useState('');

  const handleCreateOrga = async () => {
    setOrgaError(''); setOrgaSuccess('');
    if (!orgaUsername || !orgaPassword) { setOrgaError('Tous les champs sont requis.'); return; }
    if (orgaPassword !== orgaConfirm) { setOrgaError('Les mots de passe ne correspondent pas.'); return; }
    if (orgaUsername.length < 3 || orgaUsername.length > 30) { setOrgaError('Nom d\'utilisateur entre 3 et 30 caractères.'); return; }
    if (orgaPassword.length < 4) { setOrgaError('Mot de passe trop court (4 caractères min).'); return; }
    const result = await registerOrga(orgaUsername, orgaPassword);
    if (!result.ok) { setOrgaError(result.error || 'Erreur lors de la création.'); return; }
    setOrgaSuccess(`Compte organisateur "${orgaUsername}" créé avec succès !`);
    setOrgaUsername(''); setOrgaPassword(''); setOrgaConfirm('');
  };

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
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><UserPlus size={18} style={{ color: 'var(--info)' }} /> Créer un compte Organisateur</h3>
          <p className="muted">Limité à 3 créations par heure.</p>
        </div>
      </div>
      <div style={{ maxWidth: 400, marginTop: '0.5rem' }}>
        {orgaError && <div className="alert" style={{ marginBottom: '0.5rem' }}>{orgaError}</div>}
        {orgaSuccess && <div className="alert alert-success" style={{ marginBottom: '0.5rem' }}>{orgaSuccess}</div>}
        <div className="stack">
          <input type="text" value={orgaUsername} onChange={e => setOrgaUsername(e.target.value)} placeholder="Nom d'utilisateur (3-30 car.)" className="input" />
          <input type="password" value={orgaPassword} onChange={e => setOrgaPassword(e.target.value)} placeholder="Mot de passe (4 car. min)" className="input" />
          <input type="password" value={orgaConfirm} onChange={e => setOrgaConfirm(e.target.value)} placeholder="Confirmer le mot de passe" className="input" onKeyDown={e => e.key === 'Enter' && handleCreateOrga()} />
          <button onClick={handleCreateOrga} className="btn btn-info"><UserPlus size={16} /> Créer le compte</button>
        </div>
      </div>

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
