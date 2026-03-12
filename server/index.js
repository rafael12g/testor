import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBeaconSnapshotByRace,
  getRecentBeaconEvents,
  getServerLogs,
  getRaceHistory,
  initApi,
  isApiAvailable,
  getCoursesApi,
  getTeamByCodeApi,
  loginViaApi,
  insertBeaconPing,
  insertServerLog,
  insertRaceEvent,
  pruneBeacons,
  pruneServerLogs,
  registerOrga,
  loginOrga,
  getOrgaRegistrationInfo,
  startRaceChrono,
  pauseRaceChrono,
  resumeRaceChrono,
  stopRaceChrono,
  pauseTeamChrono,
  resumeTeamChrono,
  stopTeamChrono,
  getRaceChrono,
  recordTeamCheckpoint,
  getAllRaceChronos,
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT) || 8787;

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// ─── helpers ───

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function toNum(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, timestamp: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

async function log(level, message, meta = null) {
  const entry = await insertServerLog(level, message, meta);
  broadcast('log', entry);
  return entry;
}

// ─── websocket ───

wss.on('connection', async ws => {
  await log('info', 'WebSocket client connecté');
  ws.send(JSON.stringify({ type: 'connected', payload: { ok: true }, timestamp: Date.now() }));
  ws.on('close', () => log('info', 'WebSocket client déconnecté'));
});

// ─── middleware ───

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(null, false);
  },
}));
app.use(express.json());

const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: 'Trop de tentatives' } });
app.use('/api', apiLimiter);

// ─── routes ───

app.post('/api/auth/admin', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Nom d\'utilisateur et mot de passe requis' });
  try {
    const result = await loginViaApi(username, password);
    if (!result.ok) return res.status(401).json({ ok: false, error: result.error || 'Identifiants incorrects' });
    return res.json({ ok: true, permissions: result.permissions || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erreur de connexion à l\'API' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'testor-api', apiConnected: isApiAvailable(), now: Date.now() });
});

// --- Organisateur : inscription (max 3/h) ---

const orgaRegisterLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: 'Trop de tentatives d\'inscription' } });

app.post('/api/auth/register', orgaRegisterLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Nom d\'utilisateur et mot de passe requis' });
  if (username.length < 3 || username.length > 30) return res.status(400).json({ ok: false, error: 'Nom d\'utilisateur entre 3 et 30 caractères' });
  if (password.length < 4) return res.status(400).json({ ok: false, error: 'Mot de passe trop court (4 caractères minimum)' });
  try {
    const result = await registerOrga(username, password);
    if (!result.ok) return res.status(429).json(result);
    await log('info', `Compte orga créé: ${username}`, { username });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

app.get('/api/auth/register-info', (_req, res) => {
  res.json({ ok: true, ...getOrgaRegistrationInfo() });
});

// --- Organisateur : connexion ---

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Nom d\'utilisateur et mot de passe requis' });
  try {
    const result = await loginOrga(username, password);
    if (!result.ok) return res.status(401).json(result);
    await log('info', `Orga connecté: ${username}`, { username });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// --- Organisateur : démarrer une course (chrono) ---

app.post('/api/orga/courses/:raceId/start', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  if (!raceId) return res.status(400).json({ ok: false, error: 'raceId requis' });
  try {
    const chrono = startRaceChrono(raceId);
    await insertRaceEvent(raceId, 'race_started', { startedAt: chrono.startedAt });
    await log('info', `Course ${raceId} démarrée par un orga`, { raceId });
    broadcast('race_started', { raceId, startedAt: chrono.startedAt });
    return res.json({ ok: true, chrono });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// --- Organisateur : pause chrono course ---

app.post('/api/orga/courses/:raceId/pause', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  if (!raceId) return res.status(400).json({ ok: false, error: 'raceId requis' });
  try {
    const chrono = pauseRaceChrono(raceId);
    if (!chrono) return res.status(404).json({ ok: false, error: 'Course non trouvée' });
    await insertRaceEvent(raceId, 'race_paused', { elapsed: chrono.elapsed });
    await log('info', `Course ${raceId} mise en pause`, { raceId });
    broadcast('race_paused', { raceId, elapsed: chrono.elapsed });
    return res.json({ ok: true, chrono });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// --- Organisateur : reprendre chrono course ---

app.post('/api/orga/courses/:raceId/resume', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  if (!raceId) return res.status(400).json({ ok: false, error: 'raceId requis' });
  try {
    const chrono = resumeRaceChrono(raceId);
    if (!chrono) return res.status(404).json({ ok: false, error: 'Course non trouvée ou pas en pause' });
    await insertRaceEvent(raceId, 'race_resumed', { elapsed: chrono.elapsed });
    await log('info', `Course ${raceId} reprise`, { raceId });
    broadcast('race_resumed', { raceId });
    return res.json({ ok: true, chrono });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// --- Organisateur : arrêter chrono course ---

app.post('/api/orga/courses/:raceId/stop', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  if (!raceId) return res.status(400).json({ ok: false, error: 'raceId requis' });
  try {
    const chrono = stopRaceChrono(raceId);
    if (!chrono) return res.status(404).json({ ok: false, error: 'Course non trouvée' });
    await insertRaceEvent(raceId, 'race_stopped', { elapsed: chrono.elapsed });
    await log('info', `Course ${raceId} arrêtée`, { raceId, elapsed: chrono.elapsed });
    broadcast('race_stopped', { raceId, elapsed: chrono.elapsed });
    return res.json({ ok: true, chrono });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Erreur serveur' });
  }
});

// --- Organisateur : pause/resume/stop chrono d'une équipe ---

app.post('/api/orga/courses/:raceId/teams/:teamCode/pause', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  const teamCode = String(req.params.teamCode || '').trim().toUpperCase();
  const tc = pauseTeamChrono(raceId, teamCode);
  if (!tc) return res.status(404).json({ ok: false, error: 'Équipe ou course non trouvée' });
  await insertRaceEvent(raceId, 'team_paused', { teamCode, elapsed: tc.elapsed });
  broadcast('team_paused', { raceId, teamCode });
  return res.json({ ok: true, teamChrono: tc });
});

app.post('/api/orga/courses/:raceId/teams/:teamCode/resume', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  const teamCode = String(req.params.teamCode || '').trim().toUpperCase();
  const tc = resumeTeamChrono(raceId, teamCode);
  if (!tc) return res.status(404).json({ ok: false, error: 'Équipe non en pause ou course non en cours' });
  await insertRaceEvent(raceId, 'team_resumed', { teamCode });
  broadcast('team_resumed', { raceId, teamCode });
  return res.json({ ok: true, teamChrono: tc });
});

app.post('/api/orga/courses/:raceId/teams/:teamCode/stop', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  const teamCode = String(req.params.teamCode || '').trim().toUpperCase();
  const tc = stopTeamChrono(raceId, teamCode);
  if (!tc) return res.status(404).json({ ok: false, error: 'Équipe ou course non trouvée' });
  await insertRaceEvent(raceId, 'team_stopped', { teamCode, elapsed: tc.elapsed });
  broadcast('team_stopped', { raceId, teamCode, elapsed: tc.elapsed });
  return res.json({ ok: true, teamChrono: tc });
});

// --- Organisateur : état du chrono d'une course ---

app.get('/api/orga/courses/:raceId/chrono', (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  if (!raceId) return res.status(400).json({ ok: false, error: 'raceId requis' });
  const chrono = getRaceChrono(raceId);
  return res.json({ ok: true, chrono });
});

// --- Organisateur : enregistrer passage d'une équipe à une balise ---

app.post('/api/orga/courses/:raceId/teams/:teamCode/checkpoint', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  const teamCode = String(req.params.teamCode || '').trim().toUpperCase();
  const { checkpointIndex } = req.body || {};
  if (!raceId || !teamCode || checkpointIndex == null) return res.status(400).json({ ok: false, error: 'raceId, teamCode et checkpointIndex requis' });
  const tc = recordTeamCheckpoint(raceId, teamCode, Number(checkpointIndex));
  if (!tc) return res.status(404).json({ ok: false, error: 'Course non démarrée' });
  await insertRaceEvent(raceId, 'checkpoint_reached', { teamCode, checkpointIndex, elapsed: tc.checkpoints.at(-1)?.elapsed });
  broadcast('checkpoint_reached', { raceId, teamCode, checkpointIndex, elapsed: tc.checkpoints.at(-1)?.elapsed });
  return res.json({ ok: true, teamChrono: tc });
});

// --- Organisateur : tous les chronos ---

app.get('/api/orga/chronos', (_req, res) => {
  res.json({ ok: true, chronos: getAllRaceChronos() });
});

// --- Logs (vrais logs stockés en BDD) ---

app.get('/api/logs', async (req, res) => {
  const limit = clamp(toNum(req.query.limit, 80), 1, 500);
  const items = await getServerLogs(limit);
  res.json({ ok: true, items, count: items.length });
});

// --- Beacon pings ---

app.post('/api/beacons/ping', async (req, res) => {
  const body = req.body || {};
  const raceId = String(body.raceId || '').trim();
  const teamCode = String(body.teamCode || '').trim().toUpperCase();
  const teamName = String(body.teamName || '').trim();

  if (!raceId || !teamCode || !teamName) {
    return res.status(400).json({ ok: false, error: 'raceId, teamCode, teamName requis' });
  }

  const payload = {
    raceId, teamCode, teamName,
    lat: clamp(toNum(body.lat), -90, 90),
    lng: clamp(toNum(body.lng), -180, 180),
    accuracy: clamp(toNum(body.accuracy, 7), 1, 100),
    speedKmh: clamp(toNum(body.speedKmh, 0), 0, 80),
    heading: clamp(toNum(body.heading, 0), 0, 360),
    battery: clamp(toNum(body.battery, 100), 1, 100),
    createdAt: Date.now(),
  };

  try {
    await insertBeaconPing(payload);
    await pruneBeacons(5000);
    await log('info', `Ping ${payload.teamCode} @ course ${payload.raceId}`, { teamCode: payload.teamCode, raceId: payload.raceId, speedKmh: payload.speedKmh, battery: payload.battery });
    broadcast('beacon_ping', payload);
  } catch (err) {
    await log('error', 'Erreur insertion ping', { error: String(err?.message || err) });
    return res.status(500).json({ ok: false, error: 'Erreur backend SQL' });
  }

  return res.status(201).json({ ok: true, ping: payload });
});

app.get('/api/races/:raceId/beacons', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  if (!raceId) return res.status(400).json({ ok: false, error: 'raceId requis' });
  const rows = (await getBeaconSnapshotByRace(raceId)).map(r => ({
    id: r.id, raceId: r.race_id, teamCode: r.team_code, teamName: r.team_name,
    lat: r.lat, lng: r.lng, accuracy: r.accuracy, speedKmh: r.speed_kmh,
    heading: r.heading, battery: r.battery, updatedAt: r.created_at,
  }));
  res.json({ ok: true, items: rows, count: rows.length });
});

app.get('/api/beacons/events', async (req, res) => {
  const limit = clamp(toNum(req.query.limit, 20), 1, 200);
  const rows = (await getRecentBeaconEvents(limit)).map(r => ({
    id: r.id, raceId: r.race_id, teamCode: r.team_code, teamName: r.team_name,
    lat: r.lat, lng: r.lng, accuracy: r.accuracy, speedKmh: r.speed_kmh,
    heading: r.heading, battery: r.battery, updatedAt: r.created_at,
  }));
  res.json({ ok: true, items: rows, count: rows.length });
});

// --- Race events (historique des courses) ---

app.post('/api/races/:raceId/events', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  const body = req.body || {};
  const eventType = String(body.eventType || '').trim();
  if (!raceId || !eventType) return res.status(400).json({ ok: false, error: 'raceId et eventType requis' });
  try {
    const entry = await insertRaceEvent(raceId, eventType, body.payload || null);
    await log('info', `Event course ${raceId}: ${eventType}`, { raceId, eventType });
    broadcast('race_event', entry);
    return res.status(201).json({ ok: true, event: entry });
  } catch (err) {
    await log('error', 'Erreur insertion event course', { error: String(err?.message || err) });
    return res.status(500).json({ ok: false, error: 'Erreur backend SQL' });
  }
});

app.get('/api/races/:raceId/history', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  const limit = clamp(toNum(req.query.limit, 50), 1, 200);
  const items = await getRaceHistory(raceId || null, limit);
  res.json({ ok: true, items, count: items.length });
});

app.get('/api/history', async (req, res) => {
  const limit = clamp(toNum(req.query.limit, 50), 1, 200);
  const items = await getRaceHistory(null, limit);
  res.json({ ok: true, items, count: items.length });
});

// --- Courses (lecture seule depuis PostgreSQL) ---

app.get('/api/courses', async (_req, res) => {
  if (!isApiAvailable()) return res.json({ ok: true, items: [], count: 0 });
  try {
    const items = await getCoursesApi();
    res.json({ ok: true, items, count: items.length });
  } catch (err) {
    await log('error', 'Erreur lecture courses API', { error: String(err?.message || err) });
    res.status(500).json({ ok: false, error: 'Erreur lecture API externe' });
  }
});

app.get('/api/teams/code/:code', async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ ok: false, error: 'Code requis' });
  if (!isApiAvailable()) return res.status(503).json({ ok: false, error: 'API externe non configurée' });
  try {
    const result = await getTeamByCodeApi(code);
    if (!result) return res.status(404).json({ ok: false, error: 'Code introuvable ou course inactive' });
    res.json({ ok: true, ...result });
  } catch (err) {
    await log('error', 'Erreur recherche équipe API', { error: String(err?.message || err) });
    res.status(500).json({ ok: false, error: 'Erreur lecture API externe' });
  }
});

// ─── serve frontend (production / Docker) ───

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname2, '..', 'dist');

// Serve built assets (JS, CSS, images…)
app.use(express.static(distDir));

// SPA fallback: any non-API GET → index.html
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

// ─── start ───

(async () => {
  try { await initApi(); } catch (err) { console.warn('API externe non disponible:', err.message); }
  await log('info', 'Backend démarré (mémoire + API externe)');
  httpServer.listen(PORT, () => {
    console.log(`Backend prêt      → http://localhost:${PORT}`);
    console.log(`API externe       → ${process.env.API_URL ? '✅ ' + process.env.API_URL : '❌ non configurée (API_URL vide)'}`);
    console.log(`Clé API           → ${process.env.API_KEY ? '✅ configurée' : '❌ manquante'}`);
    console.log(`WebSocket         → ws://localhost:${PORT}/ws`);
  });
})().catch(err => {
  console.error('ERREUR démarrage:', err);
  process.exit(1);
});
