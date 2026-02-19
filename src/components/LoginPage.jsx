import React, { useState } from 'react';
import { Navigation, MapPin, ShieldCheck, Users } from 'lucide-react';
import { loginAdmin } from '../sim/fakeBackendApi';
import { hashPassword } from '../utils/helpers';

export default function LoginPage({ orgaAccounts, onLogin, onRunnerJoin }) {
  const [view, setView] = useState('main');
  const [adminPassword, setAdminPassword] = useState('');
  const [orgaLoginId, setOrgaLoginId] = useState('');
  const [orgaPassword, setOrgaPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  const handleAdminLogin = async () => {
    setError('');
    const result = await loginAdmin(adminPassword);
    if (!result.ok) { setError(result.error || 'Mot de passe admin incorrect.'); return; }
    setAdminPassword('');
    onLogin({ role: 'admin', name: 'Admin' });
  };

  const handleOrgaLogin = async () => {
    setError('');
    const account = orgaAccounts.find(acc => String(acc.id) === String(orgaLoginId));
    if (!account) { setError('Compte orga introuvable.'); return; }
    const hash = await hashPassword(orgaPassword);
    if (hash !== account.passwordHash) { setError('Mot de passe orga incorrect.'); return; }
    setOrgaPassword('');
    onLogin({ role: 'orga', name: account.name });
  };

  if (view === 'runner_join') return (
    <div className="page">
      <div className="card login-card">
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: 'var(--success-light)', color: 'var(--success)', marginBottom: '1rem' }}>
            <Navigation size={24} />
          </div>
          <h1 className="title">Rejoindre une course</h1>
          <p className="muted">Entre le code d'équipe fourni par l'organisateur.</p>
        </div>
        <div className="stack">
          <input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Ex: ALPHA1" className="input" />
          <button onClick={() => onRunnerJoin(joinCode)} className="btn btn-success">Rejoindre</button>
          <button onClick={() => setView('main')} className="btn btn-ghost">Retour</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="card login-card">
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, var(--primary), var(--info))', color: '#fff', marginBottom: '1rem', boxShadow: '0 4px 14px rgba(79,70,229,0.25)' }}>
            <MapPin size={26} />
          </div>
          <h1 className="title">Course d'orientation</h1>
        </div>
        {error && <div className="alert">{error}</div>}
        <div className="stack">
          <div className="auth-block">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShieldCheck size={16} style={{ color: 'var(--danger)' }} /> Connexion Admin</h3>
            <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Mot de passe admin" className="input" onKeyDown={e => e.key === 'Enter' && handleAdminLogin()} />
            <button onClick={handleAdminLogin} className="btn btn-danger"><ShieldCheck size={16} /> Se connecter</button>
          </div>
          <div className="auth-block">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Users size={16} style={{ color: 'var(--primary)' }} /> Connexion Orga</h3>
            <select value={orgaLoginId} onChange={e => setOrgaLoginId(e.target.value)} className="input">
              <option value="">Choisir un compte…</option>
              {orgaAccounts.map(acc => (<option key={acc.id} value={acc.id}>{acc.name}</option>))}
            </select>
            <input type="password" value={orgaPassword} onChange={e => setOrgaPassword(e.target.value)} placeholder="Mot de passe orga" className="input" onKeyDown={e => e.key === 'Enter' && handleOrgaLogin()} />
            <button onClick={handleOrgaLogin} className="btn btn-primary"><Users size={16} /> Se connecter</button>
          </div>
          <div style={{ paddingTop: '0.25rem' }}>
            <button onClick={() => setView('runner_join')} className="btn btn-success" style={{ width: '100%' }}><Navigation size={16} /> Rejoindre une course</button>
          </div>
        </div>
      </div>
    </div>
  );
}
