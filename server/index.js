import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBeaconSnapshotByRace,
  getDbProvider,
  getDbPath,
  getRecentBeaconEvents,
  getServerLogs,
  getRaceHistory,
  initDb,
  insertBeaconPing,
  insertServerLog,
  insertRaceEvent,
  pruneBeacons,
  pruneServerLogs,
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT) || 8787;
const ADMIN_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

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

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:3000').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('Origin non autorisée'));
  },
}));
app.use(express.json());

const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: 'Trop de tentatives' } });
app.use('/api', apiLimiter);

// ─── routes ───

app.post('/api/auth/admin', authLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ ok: false, error: 'Mot de passe requis' });
  const hash = createHash('sha256').update(String(password)).digest('hex');
  if (hash !== ADMIN_HASH) return res.status(401).json({ ok: false, error: 'Mot de passe incorrect' });
  return res.json({ ok: true });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'backend-sql', dbProvider: getDbProvider(), dbPath: getDbPath(), now: Date.now() });
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

initDb()
  .then(async () => {
    await log('info', `Backend démarré (${getDbProvider()})`, { dbPath: getDbPath() });
    await pruneServerLogs(1000);
    httpServer.listen(PORT, () => {
      console.log(`Backend SQL prêt → http://localhost:${PORT}  (${getDbProvider()})`);
      console.log(`WebSocket        → ws://localhost:${PORT}/ws`);
      console.log(`Logs API         → http://localhost:${PORT}/api/logs`);
      console.log(`Historique       → http://localhost:${PORT}/api/history`);
    });
  })
  .catch(err => {
    console.error('ERREUR init DB:', err);
    process.exit(1);
  });
