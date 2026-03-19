import React, { useState } from 'react';
import { Navigation, MapPin, ShieldCheck, ClipboardList } from 'lucide-react';
import { loginAdmin, loginOrga } from '../api';

export default function LoginPage({ onLogin, onRunnerJoin }) {
  const [view, setView] = useState('main');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  // Orga
  const [orgaUsername, setOrgaUsername] = useState('');
  const [orgaPassword, setOrgaPassword] = useState('');

  const handleAdminLogin = async () => {
    setError('');
    const result = await loginAdmin(adminUsername, adminPassword);
    if (!result.ok) { setError(result.error || 'Identifiants incorrects.'); return; }
    setAdminUsername('');
    setAdminPassword('');
    onLogin({ role: 'admin', name: result.account?.username || adminUsername || 'Admin', permissions: result.permissions || {} });
  };

  const handleOrgaLogin = async () => {
    setError('');
    const result = await loginOrga(orgaUsername, orgaPassword);
    if (!result.ok) { setError(result.error || 'Identifiants incorrects.'); return; }
    setOrgaUsername('');
    setOrgaPassword('');
    onLogin({ role: 'orga', name: result.account?.username || orgaUsername });
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

  if (view === 'orga_login') return (
    <div className="page">
      <div className="card login-card">
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: 'var(--info-light, rgba(6,182,212,0.1))', color: 'var(--info)', marginBottom: '1rem' }}>
            <ClipboardList size={24} />
          </div>
          <h1 className="title">Connexion Organisateur</h1>
          <p className="muted">Connecte-toi pour superviser tes courses.</p>
        </div>
        {error && <div className="alert">{error}</div>}
        <div className="stack">
          <input type="text" value={orgaUsername} onChange={e => setOrgaUsername(e.target.value)} placeholder="Nom d'utilisateur" className="input" />
          <input type="password" value={orgaPassword} onChange={e => setOrgaPassword(e.target.value)} placeholder="Mot de passe" className="input" onKeyDown={e => e.key === 'Enter' && handleOrgaLogin()} />
          <button onClick={handleOrgaLogin} className="btn btn-info"><ClipboardList size={16} /> Se connecter</button>
          <p className="muted" style={{ textAlign: 'center', fontSize: '0.8rem' }}>Demande à un admin de te créer un compte.</p>
          <button onClick={() => { setError(''); setView('main'); }} className="btn btn-ghost">Retour</button>
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
            <input type="text" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} placeholder="Nom d'utilisateur" className="input" />
            <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Mot de passe" className="input" onKeyDown={e => e.key === 'Enter' && handleAdminLogin()} />
            <button onClick={handleAdminLogin} className="btn btn-danger"><ShieldCheck size={16} /> Se connecter</button>
          </div>
          <div style={{ paddingTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button onClick={() => { setError(''); setView('orga_login'); }} className="btn btn-info" style={{ width: '100%' }}><ClipboardList size={16} /> Espace Organisateur</button>
            <button onClick={() => setView('runner_join')} className="btn btn-success" style={{ width: '100%' }}><Navigation size={16} /> Rejoindre une course</button>
          </div>
        </div>
      </div>
    </div>
  );
}
