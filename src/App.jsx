import React, { useMemo, useState, useEffect } from 'react';
import L from 'leaflet';
import './App.css';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import { Navigation, MapPin, Users, Flag, ShieldCheck, LogIn, Activity, LineChart } from 'lucide-react';
import VueBeaconMap from './components/VueBeaconMap';
import { fetchBeaconSnapshot, fetchRecentBeaconEvents, fetchServerLogs, fetchRaceHistory, sendBeaconPing, sendRaceEvent } from './sim/fakeBackendApi';

// --- UTILITAIRES ---
const DEFAULT_START = { lat: 44.837789, lng: -0.57918 };
const ADMIN_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const shuffleArray = (array) => [...array].sort(() => Math.random() - 0.5);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const createSeries = (count, min, max) =>
  Array.from({ length: count }, () => Number((min + Math.random() * (max - min)).toFixed(2)));
const pushSeries = (series, value, maxPoints = 24) => {
  const next = [...series, value];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
};
const sanitizeText = (value, maxLength = 40) =>
  String(value || '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
const normalizeCode = (value) => sanitizeText(value, 12).replace(/[^A-Z0-9]/gi, '').toUpperCase();
const hashPassword = async (value) => {
  const data = new TextEncoder().encode(String(value || ''));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};
const interpolate = (from, to, t) => ({
  lat: from.lat + (to.lat - from.lat) * t,
  lng: from.lng + (to.lng - from.lng) * t,
});
const toRad = (deg) => (deg * Math.PI) / 180;
const haversineKm = (a, b) => {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s1 + s2));
};
const bearingDeg = (from, to) => {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

export default function OrienteeringApp() {
  const [user, setUser] = useState(null); // { role: 'admin' | 'orga' | 'runner', name: string }
  const [races, setRaces] = useState(JSON.parse(localStorage.getItem('races')) || []);
  const [orgaAccounts, setOrgaAccounts] = useState(JSON.parse(localStorage.getItem('orgaAccounts')) || []);
  const [view, setView] = useState('login');
  const [runnerSession, setRunnerSession] = useState(null); // { raceId, teamName, code, order }
  const [orgaLocation, setOrgaLocation] = useState(null); // { lat, lng, accuracy, updatedAt }
  const [runnerProgress, setRunnerProgress] = useState(0);
  const [runnerLegProgress, setRunnerLegProgress] = useState(0);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [orgaLoginId, setOrgaLoginId] = useState('');
  const [orgaPasswordInput, setOrgaPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [beaconEvents, setBeaconEvents] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [adminLogs, setAdminLogs] = useState([]);
  const [raceHistory, setRaceHistory] = useState([]);
  const [socketState, setSocketState] = useState('offline');
  const [runnerSim, setRunnerSim] = useState(() => ({
    distanceKm: 0,
    progressSeries: createSeries(18, 0.1, 0.6),
  }));
  const [orgaSim, setOrgaSim] = useState(() => ({
    activeTeams: 0,
    alerts: 0,
    checkinsSeries: createSeries(18, 2, 18),
    activeSeries: createSeries(18, 3, 12),
    teamPositions: {},
  }));

  useEffect(() => {
    setRaces(prev => prev.map(race => {
      const checkpoints = Array.isArray(race.checkpoints) ? race.checkpoints : [];
      const teams = Array.isArray(race.teams) ? race.teams : [];
      return {
        ...race,
        start: race.start || DEFAULT_START,
        isActive: race.isActive ?? true,
        checkpoints,
        teams: teams.map(team => ({
          ...team,
          order: Array.isArray(team.order) && team.order.length > 0 ? team.order : shuffleArray(checkpoints),
        })),
      };
    }));
  }, []);

  // Sauvegarde auto
  useEffect(() => {
    localStorage.setItem('races', JSON.stringify(races));
  }, [races]);

  useEffect(() => {
    localStorage.setItem('orgaAccounts', JSON.stringify(orgaAccounts));
  }, [orgaAccounts]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const interval = setInterval(() => {
      if (user.role === 'runner') {
        const total = runnerSession?.order?.length || 0;
        let nextLeg = runnerLegProgress;
        if (total === 0) {
          nextLeg = 0;
          setRunnerLegProgress(0);
        } else if (runnerProgress < total) {
          nextLeg = clamp(runnerLegProgress + 0.08 + Math.random() * 0.08, 0, 1);
          setRunnerLegProgress(nextLeg);
        }
        setRunnerSim(prev => {
          const distanceDelta = Number((0.08 + Math.random() * 0.22).toFixed(2));
          const nextDistance = Number((prev.distanceKm + distanceDelta).toFixed(2));
          return {
            ...prev,
            distanceKm: nextDistance,
            progressSeries: pushSeries(prev.progressSeries, Number(nextLeg.toFixed(2))),
          };
        });
      }
      if (user.role === 'orga') {
        const totalTeams = races.reduce((acc, race) => acc + race.teams.length, 0);
        const allTeams = races.flatMap(race => race.teams.map(team => ({
          code: team.code,
          name: team.name,
          checkpoints: team.order,
          start: race.start || DEFAULT_START,
        })));
        setOrgaSim(prev => {
          const activeTeams = clamp(Math.round(totalTeams * (0.5 + Math.random() * 0.4)), 0, totalTeams);
          const alerts = Math.random() > 0.78 ? prev.alerts + 1 : prev.alerts;
          const nextPositions = { ...prev.teamPositions };
          allTeams.forEach(team => {
            const maxIndex = Math.max(team.checkpoints.length - 1, 0);
            const existing = nextPositions[team.code] || { index: 0, progress: Math.random() * 0.3 };
            if (team.checkpoints.length === 0) {
              nextPositions[team.code] = { index: 0, progress: 0 };
              return;
            }
            if (existing.index >= team.checkpoints.length) {
              nextPositions[team.code] = existing;
              return;
            }
            const progress = clamp(existing.progress + Math.random() * 0.15, 0, 1);
            if (progress >= 1 && existing.index < maxIndex + 1) {
              const nextIndex = existing.index + 1;
              nextPositions[team.code] = { index: nextIndex, progress: 0 };
            } else {
              nextPositions[team.code] = { ...existing, progress };
            }
          });
          return {
            ...prev,
            activeTeams,
            alerts,
            checkinsSeries: pushSeries(prev.checkinsSeries, Math.round(2 + Math.random() * 20)),
            activeSeries: pushSeries(prev.activeSeries, activeTeams),
            teamPositions: nextPositions,
          };
        });
      }
    }, 1600);
    return () => clearInterval(interval);
  }, [user, runnerSession, races, runnerProgress, runnerLegProgress]);

  useEffect(() => {
    if (user?.role !== 'orga') return undefined;
    if (!('geolocation' in navigator)) return undefined;
    const watchId = navigator.geolocation.watchPosition(
      position => {
        setOrgaLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: Date.now(),
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'admin') { setAdminLogs([]); return undefined; }
    const poll = async () => { try { setAdminLogs(await fetchServerLogs(80)); } catch { setAdminLogs([]); } };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'orga' && user?.role !== 'admin') { setRaceHistory([]); return undefined; }
    const poll = async () => { try { setRaceHistory(await fetchRaceHistory(null, 60)); } catch { setRaceHistory([]); } };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'orga') {
      setBeaconEvents([]);
      setServerLogs([]);
      return undefined;
    }

    const tick = async () => {
      try {
        const raceSnapshots = await Promise.all(
          races.map(async race => [race.id, await fetchBeaconSnapshot(race.id)])
        );
        const snapshotByRace = new Map(raceSnapshots);

        const pingPromises = [];

        races.forEach(race => {
          const previousByTeam = new Map((snapshotByRace.get(race.id) || []).map(item => [item.teamCode, item]));
          race.teams.forEach(team => {
            const order = Array.isArray(team.order) ? team.order : [];
            if (order.length === 0) return;
            const position = orgaSim.teamPositions[team.code] || { index: 0, progress: 0 };
            const from = position.index === 0
              ? (race.start || DEFAULT_START)
              : order[Math.min(position.index - 1, order.length - 1)];
            const to = position.index >= order.length
              ? order[order.length - 1]
              : order[position.index];
            const point = interpolate(from, to, position.progress);
            const previous = previousByTeam.get(team.code);
            const distanceKm = haversineKm(from, to);
            const speedBase = distanceKm < 0.2 ? 6.8 : 8.9;
            const speedKmh = clamp(speedBase + (Math.random() - 0.5) * 2.4, 4.2, 12.8);
            const battery = Math.max(7, Number(((previous?.battery ?? (94 + Math.random() * 6)) - (0.03 + Math.random() * 0.08)).toFixed(1)));
            pingPromises.push(sendBeaconPing({
              raceId: race.id,
              teamCode: team.code,
              teamName: team.name,
              lat: Number(point.lat.toFixed(6)),
              lng: Number(point.lng.toFixed(6)),
              accuracy: Number(clamp(3 + Math.random() * 11 + (Math.random() > 0.9 ? 6 : 0), 3, 25).toFixed(1)),
              speedKmh: Number(speedKmh.toFixed(1)),
              heading: Number(bearingDeg(from, to).toFixed(1)),
              battery,
            }).catch(() => null));
          });
        });

        if (pingPromises.length > 0) {
          await Promise.all(pingPromises);
        }

        setBeaconEvents(await fetchRecentBeaconEvents(12));
        setServerLogs(await fetchServerLogs(40));
      } catch {
        setBeaconEvents([]);
      }
    };

    tick();
    const interval = setInterval(tick, 2200);
    return () => clearInterval(interval);
  }, [user, races, orgaSim.teamPositions]);

  useEffect(() => {
    if (user?.role !== 'orga') {
      setSocketState('offline');
      return undefined;
    }

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://localhost:8787/ws`;
    let ws;
    try {
      setSocketState('connecting');
      ws = new WebSocket(wsUrl);
    } catch {
      setSocketState('error');
      return undefined;
    }

    ws.onopen = () => setSocketState('online');
    ws.onclose = () => setSocketState('offline');
    ws.onerror = () => setSocketState('error');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'beacon_ping' && data.payload) {
          setBeaconEvents(prev => [
            {
              ...data.payload,
              updatedAt: data.payload.createdAt ?? Date.now(),
              id: `${data.payload.teamCode}-${data.payload.createdAt ?? Date.now()}`,
            },
            ...prev,
          ].slice(0, 20));
        }
        if (data.type === 'log' && data.payload) {
          setServerLogs(prev => [data.payload, ...prev].slice(0, 120));
        }
      } catch {
        // ignore invalid ws payload
      }
    };

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [user]);

  // --- ACTIONS ---
  const createRace = (name) => {
    const safeName = sanitizeText(name);
    if (!safeName) return;
    const newRace = { id: Date.now(), name: safeName, orga: user.name, checkpoints: [], teams: [], isActive: true, start: DEFAULT_START };
    setRaces([...races, newRace]);
  };

  const addCheckpoint = (raceId, latlng) => {
    setRaces(races.map(r => {
      if (r.id !== raceId) return r;
      const checkpoints = [...r.checkpoints, latlng];
      const teams = r.teams.map(t => ({ ...t, order: shuffleArray(checkpoints) }));
      return { ...r, checkpoints, teams };
    }));
  };

  const removeCheckpoint = (raceId, index) => {
    setRaces(races.map(r => {
      if (r.id !== raceId) return r;
      const next = r.checkpoints.filter((_, idx) => idx !== index);
      const teams = r.teams.map(t => ({ ...t, order: shuffleArray(next) }));
      return { ...r, checkpoints: next, teams };
    }));
  };

  const clearCheckpoints = (raceId) => {
    setRaces(races.map(r => r.id === raceId ? { ...r, checkpoints: [], teams: r.teams.map(t => ({ ...t, order: [] })) } : r));
  };

  const createTeam = (raceId, teamName) => {
    const safeName = sanitizeText(teamName);
    if (!safeName) return;
    setRaces(races.map(r => {
      if (r.id === raceId) {
        return { 
          ...r, 
          teams: [...r.teams, { name: safeName, code: generateCode(), order: shuffleArray(r.checkpoints) }] 
        };
      }
      return r;
    }));
  };

  const deleteTeam = (raceId, teamCode) => {
    setRaces(races.map(r => r.id !== raceId ? r : { ...r, teams: r.teams.filter(t => t.code !== teamCode) }));
  };

  const toggleRaceActive = (raceId) => {
    setRaces(races.map(r => r.id === raceId ? { ...r, isActive: !(r.isActive ?? true) } : r));
  };

  const deleteRace = (raceId) => {
    setRaces(races.filter(r => r.id !== raceId));
  };

  const resetAll = () => {
    setRaces([]);
    setRunnerSession(null);
    setRunnerProgress(0);
    setRunnerLegProgress(0);
  };

  const createOrgaAccount = async (name, password) => {
    const safeName = sanitizeText(name, 30);
    if (!safeName || !password) return { ok: false, message: 'Nom ou mot de passe manquant.' };
    if (orgaAccounts.some(acc => acc.name.toLowerCase() === safeName.toLowerCase())) {
      return { ok: false, message: 'Ce nom existe déjà.' };
    }
    const passwordHash = await hashPassword(password);
    const newAccount = { id: Date.now(), name: safeName, passwordHash };
    setOrgaAccounts([...orgaAccounts, newAccount]);
    return { ok: true };
  };

  const deleteOrgaAccount = (id) => {
    setOrgaAccounts(orgaAccounts.filter(acc => acc.id !== id));
  };

  const handleAdminLogin = async () => {
    setAuthError('');
    const hash = await hashPassword(adminPasswordInput);
    if (hash !== ADMIN_PASSWORD_HASH) {
      setAuthError('Mot de passe admin incorrect.');
      return;
    }
    setUser({ role: 'admin', name: 'Admin' });
    setAdminPasswordInput('');
  };

  const handleOrgaLogin = async () => {
    setAuthError('');
    const account = orgaAccounts.find(acc => String(acc.id) === String(orgaLoginId));
    if (!account) {
      setAuthError('Compte orga introuvable.');
      return;
    }
    const hash = await hashPassword(orgaPasswordInput);
    if (hash !== account.passwordHash) {
      setAuthError('Mot de passe orga incorrect.');
      return;
    }
    setUser({ role: 'orga', name: account.name });
    setOrgaPasswordInput('');
  };

  const exportData = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      races,
      orgaAccounts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'orienteering-offline-backup.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file) => {
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.races) || !Array.isArray(parsed.orgaAccounts)) {
        throw new Error('Format invalide');
      }
      setRaces(parsed.races);
      setOrgaAccounts(parsed.orgaAccounts);
      alert('Données importées.');
    } catch {
      alert('Fichier invalide.');
    }
  };

  const seedDemoRace = () => {
    const demoRace = {
      id: Date.now(),
      name: 'Démo Campus',
      orga: user.name,
      start: DEFAULT_START,
      checkpoints: [
        { lat: 44.8409, lng: -0.5783 },
        { lat: 44.8421, lng: -0.5831 },
        { lat: 44.8364, lng: -0.5802 },
        { lat: 44.8389, lng: -0.5734 },
      ],
      teams: [
        { name: 'Équipe Alpha', code: 'ALPHA1', order: [] },
        { name: 'Équipe Bravo', code: 'BRAVO2', order: [] },
      ],
      isActive: true,
    };
    demoRace.teams = demoRace.teams.map(t => ({
      ...t,
      order: shuffleArray(demoRace.checkpoints),
    }));
    setRaces([...races, demoRace]);
  };

  const joinByCode = (codeInput) => {
    const code = normalizeCode(codeInput);
    if (!code) return alert('Entre un code équipe.');
    for (const race of races) {
      if (race.isActive === false) continue;
      const team = race.teams.find(t => normalizeCode(t.code) === code);
      if (team) {
        setUser({ role: 'runner', name: team.name });
        setRunnerSession({ raceId: race.id, teamName: team.name, code: team.code, order: team.order });
        setRunnerProgress(0);
        setRunnerLegProgress(0);
        setView('runner');
        return;
      }
    }
    alert('Code introuvable.');
  };

  // --- COMPOSANTS DE VUE ---
  
  // 1. Ecran de Connexion (Simplifié)
  if (!user && view === 'runner_join') return (
    <div className="page">
      <div className="card login-card">
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 12, background: 'var(--success-light)', color: 'var(--success)', marginBottom: '1rem' }}>
            <Navigation size={24} />
          </div>
          <h1 className="title">Rejoindre une course</h1>
          <p className="muted">Entre le code d'équipe fourni par l'organisateur.</p>
        </div>
        <RunnerJoin onJoin={joinByCode} onBack={() => setView('login')} />
      </div>
    </div>
  );

  if (!user) return (
    <div className="page">
      <div className="card login-card">
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, var(--primary), var(--info))', color: '#fff', marginBottom: '1rem', boxShadow: '0 4px 14px rgba(79,70,229,0.25)' }}>
            <MapPin size={26} />
          </div>
          <h1 className="title">Course d'orientation</h1>
        </div>
        {authError && <div className="alert">{authError}</div>}
        <div className="stack">
          <div className="auth-block">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShieldCheck size={16} style={{ color: 'var(--danger)' }} /> Connexion Admin</h3>
            <input
              type="password"
              value={adminPasswordInput}
              onChange={e => setAdminPasswordInput(e.target.value)}
              placeholder="Mot de passe admin"
              className="input"
              onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
            />
            <button onClick={handleAdminLogin} className="btn btn-danger"><ShieldCheck size={16} /> Se connecter</button>
          </div>
          <div className="auth-block">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Users size={16} style={{ color: 'var(--primary)' }} /> Connexion Orga</h3>
            <select value={orgaLoginId} onChange={e => setOrgaLoginId(e.target.value)} className="input">
              <option value="">Choisir un compte…</option>
              {orgaAccounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
            <input
              type="password"
              value={orgaPasswordInput}
              onChange={e => setOrgaPasswordInput(e.target.value)}
              placeholder="Mot de passe orga"
              className="input"
              onKeyDown={e => e.key === 'Enter' && handleOrgaLogin()}
            />
            <button onClick={handleOrgaLogin} className="btn btn-primary"><Users size={16} /> Se connecter</button>
          </div>
          <div style={{ paddingTop: '0.25rem' }}>
            <button onClick={() => setView('runner_join')} className="btn btn-success" style={{ width: '100%' }}><Navigation size={16} /> Rejoindre une course</button>
          </div>
        </div>
      </div>
    </div>
  );

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
        <button
          onClick={() => {
            setUser(null);
            setRunnerSession(null);
            setRunnerProgress(0);
            setRunnerLegProgress(0);
            setView('login');
          }}
          className="btn btn-ghost"
        >
          <LogIn size={16} /> Déconnexion
        </button>
      </header>

      <main className="content">
        {user.role === 'admin' && (
          <AdminPanel
            races={races}
            deleteRace={deleteRace}
            toggleRaceActive={toggleRaceActive}
            resetAll={resetAll}
            orgaAccounts={orgaAccounts}
            createOrgaAccount={createOrgaAccount}
            deleteOrgaAccount={deleteOrgaAccount}
            adminLogs={adminLogs}
            raceHistory={raceHistory}
          />
        )}
        {user.role === 'orga' && (
          <OrgaPanel
            races={races}
            createRace={createRace}
            addCheckpoint={addCheckpoint}
            removeCheckpoint={removeCheckpoint}
            clearCheckpoints={clearCheckpoints}
            createTeam={createTeam}
            deleteTeam={deleteTeam}
            seedDemoRace={seedDemoRace}
            orgaSim={orgaSim}
            orgaLocation={orgaLocation}
            toggleRaceActive={toggleRaceActive}
            beaconEvents={beaconEvents}
            serverLogs={serverLogs}
            socketState={socketState}
            raceHistory={raceHistory}
          />
        )}
        {user.role === 'runner' && (
          <RunnerPanel
            runnerSession={runnerSession}
            runnerSim={runnerSim}
            races={races}
            runnerProgress={runnerProgress}
            runnerLegProgress={runnerLegProgress}
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

// --- SOUS-COMPOSANTS ---

function OrgaPanel({
  races,
  createRace,
  addCheckpoint,
  removeCheckpoint,
  clearCheckpoints,
  createTeam,
  deleteTeam,
  seedDemoRace,
  orgaSim,
  orgaLocation,
  toggleRaceActive,
  beaconEvents,
  serverLogs,
  socketState,
  raceHistory,
}) {
  const [selectedRace, setSelectedRace] = useState(null);
  const [newTeamName, setNewTeamName] = useState("");

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
              <Activity size={20} style={{ color: 'var(--primary)' }} />
              Tableau Orga
            </h2>
            <p className="muted">Simulation temps réel des équipes et check-ins.</p>
          </div>
          <div className="actions">
            <button onClick={seedDemoRace} className="btn btn-ghost"><Flag size={16} /> Démo</button>
            <button onClick={() => createRace(prompt("Nom de la course ?"))} className="btn btn-primary">+ Créer une course</button>
          </div>
        </div>
        <div className="stats-grid">
          <StatCard icon={<Users size={18} />} label="Équipes actives" value={orgaSim.activeTeams} sub={`${races.reduce((acc, race) => acc + race.teams.length, 0)} au total`} />
          <StatCard icon={<Flag size={18} />} label="Balises" value={races.reduce((acc, race) => acc + race.checkpoints.length, 0)} sub="total" />
          <StatCard icon={<ShieldCheck size={18} />} label="Alertes" value={orgaSim.alerts} sub="signalements" />
          <StatCard
            icon={<MapPin size={18} />}
            label="Position orga"
            value={orgaLocation ? `${orgaLocation.lat.toFixed(4)}, ${orgaLocation.lng.toFixed(4)}` : 'GPS non actif'}
            sub={orgaLocation ? `±${Math.round(orgaLocation.accuracy)}m · live` : 'Autorise la géolocalisation'}
          />
        </div>
        <div className="chart-grid">
          <ChartCard title="Check-ins par minute" icon={<Activity size={16} />}>
            <MiniLineChart data={orgaSim.checkinsSeries} color="#0ea5e9" />
          </ChartCard>
          <ChartCard title="Équipes actives" icon={<LineChart size={16} />}>
            <MiniLineChart data={orgaSim.activeSeries} color="#22c55e" />
          </ChartCard>
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
                <div className="muted">
                  {event.lat.toFixed(5)}, {event.lng.toFixed(5)} · {event.speedKmh.toFixed(1)} km/h · ±{Math.round(event.accuracy)}m
                </div>
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
                <span className={`history-badge history-badge--${evt.event_type || evt.eventType || 'info'}`}>
                  {evt.event_type || evt.eventType || '?'}
                </span>
                <span className="history-msg">
                  {evt.race_id ? `Course #${evt.race_id}` : ''} {evt.payload ? (typeof evt.payload === 'string' ? evt.payload : JSON.stringify(evt.payload)) : ''}
                </span>
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
          {races.flatMap(race => race.teams).length === 0 && (
            <li className="muted">Ajoute des équipes pour suivre leur progression.</li>
          )}
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
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${percent}%` }} />
                </div>
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
                <button onClick={() => toggleRaceActive(selectedRace.id)} className="btn btn-ghost">
                  {selectedRace.isActive === false ? 'Activer' : 'Désactiver'}
                </button>
                <button onClick={() => clearCheckpoints(selectedRace.id)} className="btn btn-danger">Vider balises</button>
              </div>
            </div>
            <VueBeaconMap
              raceId={selectedRace.id}
              checkpoints={selectedRace.checkpoints}
              center={selectedRace.start || DEFAULT_START}
              orgaLocation={orgaLocation}
              onMapClick={(latlng) => addCheckpoint(selectedRace.id, latlng)}
            />
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
              <button onClick={() => { createTeam(selectedRace.id, newTeamName); setNewTeamName(""); }} className="btn btn-success">Ajouter</button>
            </div>
            <ul className="list">
              {selectedRace.teams.length === 0 && <li className="muted">Aucune équipe pour le moment.</li>}
              {selectedRace.teams.map((t, idx) => (
                <li key={idx} className="list-row">
                  <div>
                    <div>{t.name} <span className="pill">Code {t.code}</span></div>
                    {selectedRace.checkpoints.length > 0 && (
                      <div className="muted">
                        Ordre: {t.order
                          .map(cp => selectedRace.checkpoints.findIndex(item => item.lat === cp.lat && item.lng === cp.lng) + 1)
                          .filter(n => n > 0)
                          .join(' → ')}
                      </div>
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

function AdminPanel({ races, deleteRace, toggleRaceActive, resetAll, orgaAccounts, createOrgaAccount, deleteOrgaAccount, adminLogs, raceHistory }) {
  const [newOrgaName, setNewOrgaName] = useState('');
  const [newOrgaPassword, setNewOrgaPassword] = useState('');
  const [orgaMessage, setOrgaMessage] = useState('');

  const handleCreateOrga = async () => {
    setOrgaMessage('');
    const result = await createOrgaAccount(newOrgaName, newOrgaPassword);
    if (!result.ok) {
      setOrgaMessage(result.message);
      return;
    }
    setNewOrgaName('');
    setNewOrgaPassword('');
    setOrgaMessage('Compte orga créé.');
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldCheck size={20} style={{ color: 'var(--danger)' }} />
            Console Super-Admin
          </h2>
          <p className="muted">Vue globale de toutes les courses créées par les organisateurs.</p>
        </div>
        <button className="btn btn-danger" onClick={resetAll}>Réinitialiser tout</button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Course</th>
            <th>Organisateur</th>
            <th>Balises</th>
            <th>Équipes</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {races.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.orga}</td>
              <td>{r.checkpoints.length}</td>
              <td>{r.teams.length}</td>
              <td>{r.isActive === false ? 'désactivée' : 'active'}</td>
              <td>
                <div className="row-actions">
                  <button className="btn btn-ghost" onClick={() => toggleRaceActive(r.id)}>
                    {r.isActive === false ? 'Activer' : 'Désactiver'}
                  </button>
                  <button className="btn btn-danger" onClick={() => deleteRace(r.id)}>Supprimer</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-divider" />
      <div className="card-header">
        <div>
          <h3 className="card-title">Comptes Orga</h3>
          <p className="muted">Création réservée à l'admin.</p>
        </div>
      </div>
      {orgaMessage && <div className="alert">{orgaMessage}</div>}
      <div className="input-row">
        <input
          value={newOrgaName}
          onChange={e => setNewOrgaName(e.target.value)}
          placeholder="Nom organisateur"
          className="input"
        />
        <input
          type="password"
          value={newOrgaPassword}
          onChange={e => setNewOrgaPassword(e.target.value)}
          placeholder="Mot de passe"
          className="input"
        />
        <button className="btn btn-primary" onClick={handleCreateOrga}>Créer</button>
      </div>
      <ul className="list">
        {orgaAccounts.length === 0 && <li className="muted">Aucun compte orga.</li>}
        {orgaAccounts.map(acc => (
          <li key={acc.id} className="list-row">
            <span>{acc.name}</span>
            <button className="btn btn-ghost" onClick={() => deleteOrgaAccount(acc.id)}>Supprimer</button>
          </li>
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
              <span className={`log-level log-level--${log.level || 'info'}`}>
                {String(log.level || 'info').toUpperCase()}
              </span>
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
              <span className={`history-badge history-badge--${evt.event_type || evt.eventType || 'info'}`}>
                {evt.event_type || evt.eventType || '?'}
              </span>
              <span className="history-msg">
                {evt.race_id ? `Course #${evt.race_id}` : ''} {evt.payload ? (typeof evt.payload === 'string' ? evt.payload : JSON.stringify(evt.payload)) : ''}
              </span>
              <span className="history-time">{new Date(evt.ts || evt.timestamp).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RunnerJoin({ onJoin, onBack }) {
  const [code, setCode] = useState('');
  return (
    <div className="stack">
      <input
        value={code}
        onChange={e => setCode(e.target.value)}
        placeholder="Ex: ALPHA1"
        className="input"
      />
      <button onClick={() => onJoin(code)} className="btn btn-success">Rejoindre</button>
      <button onClick={onBack} className="btn btn-ghost">Retour</button>
    </div>
  );
}

function RunnerPanel({ runnerSession, runnerSim, races, runnerProgress, runnerLegProgress, onValidate }) {
  const race = useMemo(() => races.find(r => r.id === runnerSession?.raceId), [races, runnerSession]);
  const totalCheckpoints = runnerSession?.order?.length || 0;
  const nextIndex = runnerProgress;
  const start = race?.start || DEFAULT_START;
  const order = runnerSession?.order || [];
  const currentLabel = totalCheckpoints === 0
    ? 'Aucune balise'
    : (nextIndex === 0 ? 'Départ' : `Balise ${nextIndex}`);
  const nextLabel = totalCheckpoints === 0
    ? '—'
    : (nextIndex >= totalCheckpoints ? 'Arrivée' : `Balise ${nextIndex + 1}`);
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
          <button
            className="btn btn-success"
            onClick={onValidate}
            disabled={runnerProgress >= totalCheckpoints || runnerLegProgress < 1}
          >
            Valider la prochaine balise
          </button>
        </div>
      </section>

      <section className="card map-card">
        <h3 className="card-title">Carte des balises</h3>
        <div className="map-shell">
          <MapContainer center={[44.837789, -0.57918]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <CircleMarker
              center={[start.lat, start.lng]}
              radius={7}
              pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.8 }}
            >
              <Popup>Départ</Popup>
            </CircleMarker>
            {(runnerSession?.order || []).map((cp, index) => {
              const isDone = index < runnerProgress;
              const isNext = index === nextIndex;
              const color = isDone ? '#22c55e' : isNext ? '#f59e0b' : '#94a3b8';
              return (
                <NumberedMarker
                  key={`${cp.lat}-${cp.lng}-${index}`}
                  position={[cp.lat, cp.lng]}
                  number={index + 1}
                  color={color}
                />
              );
            })}
          </MapContainer>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Ordre des balises</h3>
        <ol className="checkpoint-list">
          {(runnerSession?.order || []).map((cp, index) => (
            <li key={`${cp.lat}-${cp.lng}-${index}`} className={`checkpoint ${index < runnerProgress ? 'checkpoint--done' : ''}`}>
              Balise {index + 1} · {cp.lat.toFixed(4)}, {cp.lng.toFixed(4)}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="muted" style={{ fontSize: '0.72rem', marginTop: '0.1rem' }}>{sub}</div>}
      </div>
    </div>
  );
}

function ChartCard({ title, icon, children }) {
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

function MiniLineChart({ data, color }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((value, idx) => {
      const x = (idx / (data.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 90 - 5;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 100" className="mini-chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${points} 100,100`} fill={`url(#grad-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NumberedMarker({ position, number, color = '#2563eb' }) {
  const icon = useMemo(() => L.divIcon({
    className: 'marker-number',
    html: `<span style="background:${color}">${number}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  }), [number, color]);
  return (
    <Marker position={position} icon={icon}>
      <Popup>Balise {number}</Popup>
    </Marker>
  );
}
