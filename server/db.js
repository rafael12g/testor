import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const provider = (process.env.DB_PROVIDER || 'sqlite').toLowerCase();

let mysqlPool = null;
let sqlitePath = null;
let db = null;

// ─── helpers ───

function mapBeaconRow(row) {
  return {
    id: row.id,
    race_id: row.race_id,
    team_code: row.team_code,
    team_name: row.team_name,
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy: Number(row.accuracy),
    speed_kmh: Number(row.speed_kmh),
    heading: Number(row.heading),
    battery: Number(row.battery),
    created_at: Number(row.created_at),
  };
}

function mapLogRow(row) {
  return {
    id: row.id,
    level: row.level,
    message: row.message,
    meta: row.meta ? tryJson(row.meta) : null,
    timestamp: Number(row.timestamp),
  };
}

function mapEventRow(row) {
  return {
    id: row.id,
    race_id: row.race_id,
    event_type: row.event_type,
    payload: row.payload ? tryJson(row.payload) : null,
    created_at: Number(row.created_at),
  };
}

function tryJson(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function sqliteAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function sqliteRun(sql, params = []) {
  db.run(sql, params);
}

function persist() {
  if (!db || !sqlitePath) return;
  const data = db.export();
  fs.writeFileSync(sqlitePath, Buffer.from(data));
}

// ─── init ───

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS beacon_pings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id TEXT NOT NULL,
    team_code TEXT NOT NULL,
    team_name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL NOT NULL,
    speed_kmh REAL NOT NULL,
    heading REAL NOT NULL,
    battery REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS server_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    meta TEXT,
    timestamp INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS race_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bp_race ON beacon_pings(race_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_bp_team ON beacon_pings(team_code, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_logs_ts ON server_logs(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_re_race ON race_events(race_id, created_at DESC);
`;

async function initMySql() {
  const mysql = await import('mysql2/promise');
  mysqlPool = mysql.default.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'orienteering',
    password: process.env.DB_PASSWORD || 'orienteering',
    database: process.env.DB_NAME || 'orienteering',
    waitForConnections: true,
    connectionLimit: 10,
  });
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS beacon_pings (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      race_id VARCHAR(80) NOT NULL, team_code VARCHAR(80) NOT NULL, team_name VARCHAR(120) NOT NULL,
      lat DOUBLE NOT NULL, lng DOUBLE NOT NULL, accuracy DOUBLE NOT NULL,
      speed_kmh DOUBLE NOT NULL, heading DOUBLE NOT NULL, battery DOUBLE NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_bp_race (race_id, created_at DESC), INDEX idx_bp_team (team_code, created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS server_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      level VARCHAR(20) NOT NULL DEFAULT 'info', message VARCHAR(500) NOT NULL,
      meta TEXT, timestamp BIGINT NOT NULL,
      INDEX idx_logs_ts (timestamp DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS race_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      race_id VARCHAR(80) NOT NULL, event_type VARCHAR(80) NOT NULL,
      payload TEXT, created_at BIGINT NOT NULL,
      INDEX idx_re_race (race_id, created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function initSqliteDb() {
  const dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  sqlitePath = path.join(dataDir, 'sim.db');

  const SQL = await initSqlJs();
  if (fs.existsSync(sqlitePath)) {
    db = new SQL.Database(fs.readFileSync(sqlitePath));
  } else {
    db = new SQL.Database();
  }
  db.run(SQLITE_SCHEMA);
  persist();
}

export async function initDb() {
  if (provider === 'mysql') await initMySql();
  else await initSqliteDb();
}

// ─── beacon_pings ───

export async function insertBeaconPing(p) {
  const sql = `INSERT INTO beacon_pings (race_id,team_code,team_name,lat,lng,accuracy,speed_kmh,heading,battery,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`;
  const v = [p.raceId, p.teamCode, p.teamName, p.lat, p.lng, p.accuracy, p.speedKmh, p.heading, p.battery, p.createdAt];
  if (provider === 'mysql') { await mysqlPool.query(sql, v); return; }
  sqliteRun(sql, v); persist();
}

export async function getBeaconSnapshotByRace(raceId) {
  const id = String(raceId);
  const sql = `SELECT p.* FROM beacon_pings p INNER JOIN (SELECT team_code, MAX(created_at) AS mc FROM beacon_pings WHERE race_id=? GROUP BY team_code) t ON t.team_code=p.team_code AND t.mc=p.created_at WHERE p.race_id=? ORDER BY p.created_at DESC`;
  if (provider === 'mysql') { const [r] = await mysqlPool.query(sql, [id, id]); return r.map(mapBeaconRow); }
  return sqliteAll(sql, [id, id]).map(mapBeaconRow);
}

export async function getRecentBeaconEvents(limit = 25) {
  const n = Math.max(1, Number(limit) || 25);
  const sql = `SELECT * FROM beacon_pings ORDER BY created_at DESC LIMIT ?`;
  if (provider === 'mysql') { const [r] = await mysqlPool.query(sql, [n]); return r.map(mapBeaconRow); }
  return sqliteAll(sql, [n]).map(mapBeaconRow);
}

export async function pruneBeacons(max = 4000) {
  const n = Math.max(100, Number(max) || 4000);
  if (provider === 'mysql') { await mysqlPool.query(`DELETE FROM beacon_pings WHERE id NOT IN (SELECT k.id FROM (SELECT id FROM beacon_pings ORDER BY created_at DESC LIMIT ?) AS k)`, [n]); return; }
  sqliteRun(`DELETE FROM beacon_pings WHERE id NOT IN (SELECT id FROM beacon_pings ORDER BY created_at DESC LIMIT ?)`, [n]); persist();
}

// ─── server_logs (vrais logs stockés en BDD) ───

export async function insertServerLog(level, message, meta = null) {
  const ts = Date.now();
  const mj = meta ? JSON.stringify(meta) : null;
  const sql = `INSERT INTO server_logs (level,message,meta,timestamp) VALUES (?,?,?,?)`;
  if (provider === 'mysql') { await mysqlPool.query(sql, [level, message, mj, ts]); }
  else { sqliteRun(sql, [level, message, mj, ts]); persist(); }
  return { id: ts, level, message, meta, timestamp: ts };
}

export async function getServerLogs(limit = 80) {
  const n = Math.max(1, Number(limit) || 80);
  const sql = `SELECT * FROM server_logs ORDER BY timestamp DESC LIMIT ?`;
  if (provider === 'mysql') { const [r] = await mysqlPool.query(sql, [n]); return r.map(mapLogRow); }
  return sqliteAll(sql, [n]).map(mapLogRow);
}

export async function pruneServerLogs(max = 1000) {
  const n = Math.max(50, Number(max) || 1000);
  if (provider === 'mysql') { await mysqlPool.query(`DELETE FROM server_logs WHERE id NOT IN (SELECT k.id FROM (SELECT id FROM server_logs ORDER BY timestamp DESC LIMIT ?) AS k)`, [n]); return; }
  sqliteRun(`DELETE FROM server_logs WHERE id NOT IN (SELECT id FROM server_logs ORDER BY timestamp DESC LIMIT ?)`, [n]); persist();
}

// ─── race_events (historique des courses) ───

export async function insertRaceEvent(raceId, eventType, payload = null) {
  const ts = Date.now();
  const pj = payload ? JSON.stringify(payload) : null;
  const sql = `INSERT INTO race_events (race_id,event_type,payload,created_at) VALUES (?,?,?,?)`;
  if (provider === 'mysql') { await mysqlPool.query(sql, [String(raceId), eventType, pj, ts]); }
  else { sqliteRun(sql, [String(raceId), eventType, pj, ts]); persist(); }
  return { id: ts, race_id: String(raceId), event_type: eventType, payload, created_at: ts };
}

export async function getRaceHistory(raceId, limit = 50) {
  const n = Math.max(1, Number(limit) || 50);
  if (raceId) {
    const sql = `SELECT * FROM race_events WHERE race_id=? ORDER BY created_at DESC LIMIT ?`;
    if (provider === 'mysql') { const [r] = await mysqlPool.query(sql, [String(raceId), n]); return r.map(mapEventRow); }
    return sqliteAll(sql, [String(raceId), n]).map(mapEventRow);
  }
  const sql = `SELECT * FROM race_events ORDER BY created_at DESC LIMIT ?`;
  if (provider === 'mysql') { const [r] = await mysqlPool.query(sql, [n]); return r.map(mapEventRow); }
  return sqliteAll(sql, [n]).map(mapEventRow);
}

// ─── meta ───

export function getDbPath() {
  if (provider === 'mysql') return `mysql://${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'orienteering'}`;
  return sqlitePath;
}

export function getDbProvider() { return provider; }
