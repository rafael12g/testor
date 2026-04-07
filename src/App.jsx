import React, { useState, useEffect } from 'react';
import './App.css';
import { MapPin, LogIn } from 'lucide-react';
import LoginPage from './components/LoginPage';
import AdminPanel from './components/AdminPanel';
import RunnerPanel from './components/RunnerPanel';
import OrgaPanel from './components/OrgaPanel';
import { DEFAULT_START, clamp, normalizeCode } from './utils/helpers';
import { fetchServerLogs, fetchRaceHistory, fetchCourses, fetchTeamByCode, setSessionToken } from './api';

export default function OrienteeringApp() {
  const [user, setUser] = useState(null);
  const [races, setRaces] = useState([]);
  const [runnerSession, setRunnerSession] = useState(null);
  const [runnerProgress, setRunnerProgress] = useState(0);
  const [runnerLegProgress, setRunnerLegProgress] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [adminLogs, setAdminLogs] = useState([]);
  const [raceHistory, setRaceHistory] = useState([]);


  // ── Charger les courses depuis PostgreSQL (lecture seule) ──
  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'orga') { setRaces([]); return; }
    const loadCourses = async () => {
      try {
        setRaces(await fetchCourses());
      } catch {
        setRaces([]);
      }
    };
    loadCourses();
    const interval = setInterval(loadCourses, 15000);
    return () => clearInterval(interval);
  }, [user]);

  // ── Online / Offline ──
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);



  // ── Admin : logs serveur ──
  useEffect(() => {
    if (user?.role !== 'admin') { setAdminLogs([]); return; }
    const poll = async () => { try { setAdminLogs(await fetchServerLogs(80)); } catch { setAdminLogs([]); } };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [user]);

  // ── Admin : historique courses ──
  useEffect(() => {
    if (user?.role !== 'admin') { setRaceHistory([]); return; }
    const poll = async () => { try { setRaceHistory(await fetchRaceHistory(null, 60)); } catch { setRaceHistory([]); } };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [user]);

  // ── Rejoindre une course par code (lecture API PostgreSQL) ──
  const joinByCode = async (codeInput) => {
    const code = normalizeCode(codeInput);
    if (!code) return alert('Entre un code équipe.');
    try {
      const data = await fetchTeamByCode(code);
      const payload = data?.data || data;
      const hasTeamAndCourse = !!(payload?.team && payload?.course);
      const explicitlyFailed = payload?.ok === false;
      if (!hasTeamAndCourse || explicitlyFailed) return alert(payload?.error || 'Code introuvable ou course inactive.');
      const { team, course } = payload;
      setUser({ role: 'runner', name: team.name });
      setRunnerSession({
        raceId: course.id,
        raceName: course.name,
        teamName: team.name,
        code: team.code,
        order: course.checkpoints || [],
        start: course.start || DEFAULT_START,
      });
      setRunnerProgress(0);
      setRunnerLegProgress(0);
    } catch {
      alert('Erreur de connexion au serveur.');
    }
  };

  const logout = () => { setSessionToken(null); setUser(null); setRunnerSession(null); setRunnerProgress(0); setRunnerLegProgress(0); };

  if (!user) return <LoginPage onLogin={setUser} onRunnerJoin={joinByCode} />;

  return (
    <div className="app">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--primary), var(--info))', color: '#fff', flexShrink: 0 }}>
            <MapPin size={16} />
          </div>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)', marginRight: '0.5rem' }}>-</span>
          <span className="badge">{user.role.toUpperCase()}</span>
          <span className="header-title">{user.name}</span>
          {!isOnline && <span className="offline-pill">Hors ligne</span>}
        </div>
        <button onClick={logout} className="btn btn-ghost"><LogIn size={16} /> Déconnexion</button>
      </header>
      <main className="content">
        {user.role === 'admin' && (
          <AdminPanel races={races} adminLogs={adminLogs} raceHistory={raceHistory} permissions={user.permissions || {}} />
        )}
        {user.role === 'orga' && (
          <OrgaPanel races={races} />
        )}
        {user.role === 'runner' && (
          <RunnerPanel
            runnerSession={runnerSession} races={races}
            runnerProgress={runnerProgress} runnerLegProgress={runnerLegProgress}
            permissions={user.permissions || {}}
            onValidate={() => {
              const total = runnerSession?.order?.length || 0;
              if (runnerLegProgress < 1) return;
              setRunnerProgress(prev => clamp(prev + 1, 0, total));
              setRunnerLegProgress(0);
            }}
          />
        )}
      </main>
    </div>
  );
}
