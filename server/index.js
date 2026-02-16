import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import {
  getBeaconSnapshotByRace,
  getDbProvider,
  getDbPath,
  getRecentBeaconEvents,
  initDb,
  insertBeaconPing,
  pruneHistory,
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT) || 8787;
const MAX_LOGS = 500;
const serverLogs = [];

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function addLog(level, message, meta = null) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    message,
    meta,
    timestamp: Date.now(),
  };
  serverLogs.push(entry);
  if (serverLogs.length > MAX_LOGS) {
    serverLogs.splice(0, serverLogs.length - MAX_LOGS);
  }
  return entry;
}

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

wss.on('connection', ws => {
  const log = addLog('info', 'WebSocket client connecté');
  ws.send(JSON.stringify({ type: 'connected', payload: { ok: true }, timestamp: Date.now() }));
  ws.send(JSON.stringify({ type: 'log', payload: log, timestamp: Date.now() }));

  ws.on('close', () => {
    const closeLog = addLog('info', 'WebSocket client déconnecté');
    broadcast('log', closeLog);
  });
});

app.use(cors());
app.use(express.json());

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'fake-backend-sql',
    dbProvider: getDbProvider(),
    dbPath: getDbPath(),
    now: Date.now(),
  });
});

app.get('/api/logs', (req, res) => {
  const limit = clamp(toNumber(req.query.limit, 100), 1, 500);
  const items = [...serverLogs].slice(serverLogs.length - limit).reverse();
  res.json({ ok: true, items, count: items.length });
});

app.post('/api/beacons/ping', async (req, res) => {
  const body = req.body || {};

  const raceId = String(body.raceId || '').trim();
  const teamCode = String(body.teamCode || '').trim().toUpperCase();
  const teamName = String(body.teamName || '').trim();

  if (!raceId || !teamCode || !teamName) {
    return res.status(400).json({ ok: false, error: 'raceId, teamCode, teamName requis' });
  }

  const payload = {
    raceId,
    teamCode,
    teamName,
    lat: clamp(toNumber(body.lat), -90, 90),
    lng: clamp(toNumber(body.lng), -180, 180),
    accuracy: clamp(toNumber(body.accuracy, 7), 1, 100),
    speedKmh: clamp(toNumber(body.speedKmh, 0), 0, 80),
    heading: clamp(toNumber(body.heading, 0), 0, 360),
    battery: clamp(toNumber(body.battery, 100), 1, 100),
    createdAt: Date.now(),
  };

  try {
    await insertBeaconPing(payload);
    await pruneHistory(5000);

    const log = addLog('info', `Ping ${payload.teamCode} @ ${payload.raceId}`, {
      teamCode: payload.teamCode,
      raceId: payload.raceId,
      speedKmh: payload.speedKmh,
      battery: payload.battery,
    });
    broadcast('beacon_ping', payload);
    broadcast('log', log);
  } catch (error) {
    const log = addLog('error', 'Erreur insertion ping', { error: String(error?.message || error) });
    broadcast('log', log);
    return res.status(500).json({ ok: false, error: 'Erreur backend SQL' });
  }

  return res.status(201).json({ ok: true, ping: payload });
});

app.get('/api/races/:raceId/beacons', async (req, res) => {
  const raceId = String(req.params.raceId || '').trim();
  if (!raceId) {
    return res.status(400).json({ ok: false, error: 'raceId requis' });
  }

  const dbRows = await getBeaconSnapshotByRace(raceId);
  const rows = dbRows.map(row => ({
    id: row.id,
    raceId: row.race_id,
    teamCode: row.team_code,
    teamName: row.team_name,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    speedKmh: row.speed_kmh,
    heading: row.heading,
    battery: row.battery,
    updatedAt: row.created_at,
  }));

  return res.json({ ok: true, items: rows, count: rows.length });
});

app.get('/api/beacons/events', async (req, res) => {
  const limit = clamp(toNumber(req.query.limit, 20), 1, 200);

  const dbRows = await getRecentBeaconEvents(limit);
  const rows = dbRows.map(row => ({
    id: row.id,
    raceId: row.race_id,
    teamCode: row.team_code,
    teamName: row.team_name,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    speedKmh: row.speed_kmh,
    heading: row.heading,
    battery: row.battery,
    updatedAt: row.created_at,
  }));

  return res.json({ ok: true, items: rows, count: rows.length });
});

initDb()
  .then(() => {
    addLog('info', `Backend démarré (${getDbProvider()})`, { dbPath: getDbPath() });
    httpServer.listen(PORT, () => {
      console.log(`Backend SQL prêt sur http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Erreur init DB', error);
    process.exit(1);
  });
