import React, { useState } from 'react';
import { ShieldCheck, Activity, LineChart } from 'lucide-react';

export default function AdminPanel({ races, deleteRace, toggleRaceActive, resetAll, orgaAccounts, createOrgaAccount, deleteOrgaAccount, adminLogs, raceHistory }) {
  const [newOrgaName, setNewOrgaName] = useState('');
  const [newOrgaPassword, setNewOrgaPassword] = useState('');
  const [orgaMessage, setOrgaMessage] = useState('');

  const handleCreateOrga = async () => {
    setOrgaMessage('');
    const result = await createOrgaAccount(newOrgaName, newOrgaPassword);
    if (!result.ok) { setOrgaMessage(result.message); return; }
    setNewOrgaName('');
    setNewOrgaPassword('');
    setOrgaMessage('Compte orga créé.');
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck size={20} style={{ color: 'var(--danger)' }} /> Console Super-Admin
          </h2>
          <p className="muted">Vue globale de toutes les courses créées par les organisateurs.</p>
        </div>
        <button className="btn btn-danger" onClick={resetAll}>Réinitialiser tout</button>
      </div>
      <table className="table">
        <thead><tr><th>Course</th><th>Organisateur</th><th>Balises</th><th>Équipes</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>
          {races.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td><td>{r.orga}</td><td>{r.checkpoints.length}</td><td>{r.teams.length}</td>
              <td>{r.isActive === false ? 'désactivée' : 'active'}</td>
              <td>
                <div className="row-actions">
                  <button className="btn btn-ghost" onClick={() => toggleRaceActive(r.id)}>{r.isActive === false ? 'Activer' : 'Désactiver'}</button>
                  <button className="btn btn-danger" onClick={() => deleteRace(r.id)}>Supprimer</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-divider" />
      <div className="card-header">
        <div><h3 className="card-title">Comptes Orga</h3><p className="muted">Création réservée à l'admin.</p></div>
      </div>
      {orgaMessage && <div className="alert">{orgaMessage}</div>}
      <div className="input-row">
        <input value={newOrgaName} onChange={e => setNewOrgaName(e.target.value)} placeholder="Nom organisateur" className="input" />
        <input type="password" value={newOrgaPassword} onChange={e => setNewOrgaPassword(e.target.value)} placeholder="Mot de passe" className="input" />
        <button className="btn btn-primary" onClick={handleCreateOrga}>Créer</button>
      </div>
      <ul className="list">
        {orgaAccounts.length === 0 && <li className="muted">Aucun compte orga.</li>}
        {orgaAccounts.map(acc => (
          <li key={acc.id} className="list-row"><span>{acc.name}</span><button className="btn btn-ghost" onClick={() => deleteOrgaAccount(acc.id)}>Supprimer</button></li>
        ))}
      </ul>

      <div className="section-divider" />
      <div className="card-header">
        <div>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={18} style={{ color: 'var(--primary)' }} /> Logs serveur (BDD)</h3>
          <p className="muted">Logs réels stockés en base de données SQL, mis à jour automatiquement.</p>
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
