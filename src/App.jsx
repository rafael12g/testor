import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import { MapPin, LogIn } from 'lucide-react';
import LoginPage from './components/LoginPage';
import AdminPanel from './components/AdminPanel';
import OrgaPanel from './components/OrgaPanel';
import RunnerPanel from './components/RunnerPanel';
import useWebSocket from './hooks/useWebSocket';
import { DEFAULT_START, clamp, createSeries, pushSeries, shuffleArray, sanitizeText, normalizeCode, generateCode, hashPassword } from './utils/helpers';
import { interpolate, haversineKm, bearingDeg } from './utils/geo';
import { fetchBeaconSnapshot, fetchRecentBeaconEvents, fetchServerLogs, fetchRaceHistory, sendBeaconPing } from './sim/fakeBackendApi';

export default function OrienteeringApp() {
  const [user, setUser] = useState(null);
  const [races, setRaces] = useState(JSON.parse(localStorage.getItem('races')) || []);
  const [orgaAccounts, setOrgaAccounts] = useState(JSON.parse(localStorage.getItem('orgaAccounts')) || []);
  const [runnerSession, setRunnerSession] = useState(null);
  const [orgaLocation, setOrgaLocation] = useState(null);
  const [runnerProgress, setRunnerProgress] = useState(0);
  const [runnerLegProgress, setRunnerLegProgress] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [beaconEvents, setBeaconEvents] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);
  const [adminLogs, setAdminLogs] = useState([]);
  const [raceHistory, setRaceHistory] = useState([]);
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

  const handleWsMessage = useCallback((data) => {
    if (data.type === 'beacon_ping' && data.payload) {
      setBeaconEvents(prev => [{
        ...data.payload,
        updatedAt: data.payload.createdAt ?? Date.now(),
        id: `${data.payload.teamCode}-${data.payload.createdAt ?? Date.now()}`,
      }, ...prev].slice(0, 20));
    }
    if (data.type === 'log' && data.payload) {
      setServerLogs(prev => [data.payload, ...prev].slice(0, 120));
    }
  }, []);

  const socketState = useWebSocket(user?.role === 'orga', handleWsMessage);

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

  useEffect(() => { localStorage.setItem('races', JSON.stringify(races)); }, [races]);
  useEffect(() => { localStorage.setItem('orgaAccounts', JSON.stringify(orgaAccounts)); }, [orgaAccounts]);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (user.role === 'runner') {
        const total = runnerSession?.order?.length || 0;
        let nextLeg = runnerLegProgress;
        if (total === 0) { nextLeg = 0; setRunnerLegProgress(0); }
        else if (runnerProgress < total) {
          nextLeg = clamp(runnerLegProgress + 0.08 + Math.random() * 0.08, 0, 1);
          setRunnerLegProgress(nextLeg);
        }
        setRunnerSim(prev => ({
          ...prev,
          distanceKm: Number((prev.distanceKm + 0.08 + Math.random() * 0.22).toFixed(2)),
          progressSeries: pushSeries(prev.progressSeries, Number(nextLeg.toFixed(2))),
        }));
      }
      if (user.role === 'orga') {
        const totalTeams = races.reduce((acc, race) => acc + race.teams.length, 0);
        const allTeams = races.flatMap(race => race.teams.map(team => ({
          code: team.code, name: team.name, checkpoints: team.order, start: race.start || DEFAULT_START,
        })));
        setOrgaSim(prev => {
          const activeTeams = clamp(Math.round(totalTeams * (0.5 + Math.random() * 0.4)), 0, totalTeams);
          const alerts = Math.random() > 0.78 ? prev.alerts + 1 : prev.alerts;
          const nextPositions = { ...prev.teamPositions };
          allTeams.forEach(team => {
            const maxIndex = Math.max(team.checkpoints.length - 1, 0);
            const existing = nextPositions[team.code] || { index: 0, progress: Math.random() * 0.3 };
            if (team.checkpoints.length === 0) { nextPositions[team.code] = { index: 0, progress: 0 }; return; }
            if (existing.index >= team.checkpoints.length) { nextPositions[team.code] = existing; return; }
            const progress = clamp(existing.progress + Math.random() * 0.15, 0, 1);
            if (progress >= 1 && existing.index < maxIndex + 1) {
              nextPositions[team.code] = { index: existing.index + 1, progress: 0 };
            } else {
              nextPositions[team.code] = { ...existing, progress };
            }
          });
          return {
            ...prev, activeTeams, alerts,
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
    if (user?.role !== 'orga' || !('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      pos => setOrgaLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, updatedAt: Date.now() }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'admin') { setAdminLogs([]); return; }
    const poll = async () => { try { setAdminLogs(await fetchServerLogs(80)); } catch { setAdminLogs([]); } };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'orga' && user?.role !== 'admin') { setRaceHistory([]); return; }
    const poll = async () => { try { setRaceHistory(await fetchRaceHistory(null, 60)); } catch { setRaceHistory([]); } };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (user?.role !== 'orga') { setBeaconEvents([]); setServerLogs([]); return; }
    const tick = async () => {
      try {
        const raceSnapshots = await Promise.all(races.map(async race => [race.id, await fetchBeaconSnapshot(race.id)]));
        const snapshotByRace = new Map(raceSnapshots);
        const pingPromises = [];
        races.forEach(race => {
          const previousByTeam = new Map((snapshotByRace.get(race.id) || []).map(item => [item.teamCode, item]));
          race.teams.forEach(team => {
            const order = Array.isArray(team.order) ? team.order : [];
            if (order.length === 0) return;
            const position = orgaSim.teamPositions[team.code] || { index: 0, progress: 0 };
            const from = position.index === 0 ? (race.start || DEFAULT_START) : order[Math.min(position.index - 1, order.length - 1)];
            const to = position.index >= order.length ? order[order.length - 1] : order[position.index];
            const point = interpolate(from, to, position.progress);
            const previous = previousByTeam.get(team.code);
            const distanceKm = haversineKm(from, to);
            const speedBase = distanceKm < 0.2 ? 6.8 : 8.9;
            const speedKmh = clamp(speedBase + (Math.random() - 0.5) * 2.4, 4.2, 12.8);
            const battery = Math.max(7, Number(((previous?.battery ?? (94 + Math.random() * 6)) - (0.03 + Math.random() * 0.08)).toFixed(1)));
            pingPromises.push(sendBeaconPing({
              raceId: race.id, teamCode: team.code, teamName: team.name,
              lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)),
              accuracy: Number(clamp(3 + Math.random() * 11 + (Math.random() > 0.9 ? 6 : 0), 3, 25).toFixed(1)),
              speedKmh: Number(speedKmh.toFixed(1)), heading: Number(bearingDeg(from, to).toFixed(1)), battery,
            }).catch(() => null));
          });
        });
        if (pingPromises.length > 0) await Promise.all(pingPromises);
        setBeaconEvents(await fetchRecentBeaconEvents(12));
        setServerLogs(await fetchServerLogs(40));
      } catch { setBeaconEvents([]); }
    };
    tick();
    const interval = setInterval(tick, 2200);
    return () => clearInterval(interval);
  }, [user, races, orgaSim.teamPositions]);

  const createRace = (name) => {
    const safeName = sanitizeText(name);
    if (!safeName) return;
    setRaces([...races, { id: Date.now(), name: safeName, orga: user.name, checkpoints: [], teams: [], isActive: true, start: DEFAULT_START }]);
  };

  const addCheckpoint = (raceId, latlng) => {
    setRaces(races.map(r => {
      if (r.id !== raceId) return r;
      const checkpoints = [...r.checkpoints, latlng];
      return { ...r, checkpoints, teams: r.teams.map(t => ({ ...t, order: shuffleArray(checkpoints) })) };
    }));
  };

  const removeCheckpoint = (raceId, index) => {
    setRaces(races.map(r => {
      if (r.id !== raceId) return r;
      const next = r.checkpoints.filter((_, idx) => idx !== index);
      return { ...r, checkpoints: next, teams: r.teams.map(t => ({ ...t, order: shuffleArray(next) })) };
    }));
  };

  const clearCheckpoints = (raceId) => {
    setRaces(races.map(r => r.id === raceId ? { ...r, checkpoints: [], teams: r.teams.map(t => ({ ...t, order: [] })) } : r));
  };

  const createTeam = (raceId, teamName) => {
    const safeName = sanitizeText(teamName);
    if (!safeName) return;
    setRaces(races.map(r => r.id === raceId ? { ...r, teams: [...r.teams, { name: safeName, code: generateCode(), order: shuffleArray(r.checkpoints) }] } : r));
  };

  const deleteTeam = (raceId, teamCode) => {
    setRaces(races.map(r => r.id !== raceId ? r : { ...r, teams: r.teams.filter(t => t.code !== teamCode) }));
  };

  const toggleRaceActive = (raceId) => {
    setRaces(races.map(r => r.id === raceId ? { ...r, isActive: !(r.isActive ?? true) } : r));
  };

  const deleteRace = (raceId) => setRaces(races.filter(r => r.id !== raceId));

  const resetAll = () => { setRaces([]); setRunnerSession(null); setRunnerProgress(0); setRunnerLegProgress(0); };

  const createOrgaAccount = async (name, password) => {
    const safeName = sanitizeText(name, 30);
    if (!safeName || !password) return { ok: false, message: 'Nom ou mot de passe manquant.' };
    if (orgaAccounts.some(acc => acc.name.toLowerCase() === safeName.toLowerCase())) return { ok: false, message: 'Ce nom existe déjà.' };
    const passwordHash = await hashPassword(password);
    setOrgaAccounts([...orgaAccounts, { id: Date.now(), name: safeName, passwordHash }]);
    return { ok: true };
  };

  const deleteOrgaAccount = (id) => setOrgaAccounts(orgaAccounts.filter(acc => acc.id !== id));

  const seedDemoRace = () => {
    const demo = {
      id: Date.now(), name: 'Démo Campus', orga: user.name, start: DEFAULT_START, isActive: true,
      checkpoints: [{ lat: 44.8409, lng: -0.5783 }, { lat: 44.8421, lng: -0.5831 }, { lat: 44.8364, lng: -0.5802 }, { lat: 44.8389, lng: -0.5734 }],
      teams: [{ name: 'Équipe Alpha', code: 'ALPHA1', order: [] }, { name: 'Équipe Bravo', code: 'BRAVO2', order: [] }],
    };
    demo.teams = demo.teams.map(t => ({ ...t, order: shuffleArray(demo.checkpoints) }));
    setRaces([...races, demo]);
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
        return;
      }
    }
    alert('Code introuvable.');
  };

  const logout = () => { setUser(null); setRunnerSession(null); setRunnerProgress(0); setRunnerLegProgress(0); };

  if (!user) return <LoginPage orgaAccounts={orgaAccounts} onLogin={setUser} onRunnerJoin={joinByCode} />;

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
          <AdminPanel
            races={races} deleteRace={deleteRace} toggleRaceActive={toggleRaceActive}
            resetAll={resetAll} orgaAccounts={orgaAccounts} createOrgaAccount={createOrgaAccount}
            deleteOrgaAccount={deleteOrgaAccount} adminLogs={adminLogs} raceHistory={raceHistory}
          />
        )}
        {user.role === 'orga' && (
          <OrgaPanel
            races={races} createRace={createRace} addCheckpoint={addCheckpoint}
            removeCheckpoint={removeCheckpoint} clearCheckpoints={clearCheckpoints}
            createTeam={createTeam} deleteTeam={deleteTeam} seedDemoRace={seedDemoRace}
            orgaSim={orgaSim} orgaLocation={orgaLocation} toggleRaceActive={toggleRaceActive}
            beaconEvents={beaconEvents} serverLogs={serverLogs} socketState={socketState}
            raceHistory={raceHistory}
          />
        )}
        {user.role === 'runner' && (
          <RunnerPanel
            runnerSession={runnerSession} runnerSim={runnerSim} races={races}
            runnerProgress={runnerProgress} runnerLegProgress={runnerLegProgress}
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
