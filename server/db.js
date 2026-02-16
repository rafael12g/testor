import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const provider = (process.env.DB_PROVIDER || 'sqlite').toLowerCase();
let mysqlPool = null;
let sqlitePath = null;
let sqlite = null;

function mapRow(row) {
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

async function initMySql() {
  mysqlPool = mysql.createPool({
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
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      race_id VARCHAR(80) NOT NULL,
      team_code VARCHAR(80) NOT NULL,
      team_name VARCHAR(120) NOT NULL,
      lat DOUBLE NOT NULL,
      lng DOUBLE NOT NULL,
      accuracy DOUBLE NOT NULL,
      speed_kmh DOUBLE NOT NULL,
      heading DOUBLE NOT NULL,
      battery DOUBLE NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_beacon_pings_race_time (race_id, created_at DESC),
      INDEX idx_beacon_pings_team_time (team_code, created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function initSqlite() {
  const dataDir = path.resolve(process.cwd(), 'server', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  sqlitePath = path.join(dataDir, 'sim.db');
  sqlite = new Database(sqlitePath);
  sqlite.pragma('journal_mode = WAL');

  sqlite.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_beacon_pings_race_time
      ON beacon_pings(race_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_beacon_pings_team_time
      ON beacon_pings(team_code, created_at DESC);
  `);
}

export async function initDb() {
  if (provider === 'mysql') {
    await initMySql();
    return;
  }
  initSqlite();
}

export async function insertBeaconPing(ping) {
  if (provider === 'mysql') {
    await mysqlPool.query(
      `
      INSERT INTO beacon_pings (
        race_id, team_code, team_name, lat, lng, accuracy, speed_kmh, heading, battery, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ping.raceId,
        ping.teamCode,
        ping.teamName,
        ping.lat,
        ping.lng,
        ping.accuracy,
        ping.speedKmh,
        ping.heading,
        ping.battery,
        ping.createdAt,
      ]
    );
    return;
  }

  sqlite.prepare(`
    INSERT INTO beacon_pings (
      race_id, team_code, team_name, lat, lng, accuracy, speed_kmh, heading, battery, created_at
    ) VALUES (
      @raceId, @teamCode, @teamName, @lat, @lng, @accuracy, @speedKmh, @heading, @battery, @createdAt
    )
  `).run(ping);
}

export async function getBeaconSnapshotByRace(raceId) {
  const id = String(raceId);
  if (provider === 'mysql') {
    const [rows] = await mysqlPool.query(
      `
      SELECT p.*
      FROM beacon_pings p
      INNER JOIN (
        SELECT team_code, MAX(created_at) AS max_created
        FROM beacon_pings
        WHERE race_id = ?
        GROUP BY team_code
      ) latest ON latest.team_code = p.team_code AND latest.max_created = p.created_at
      WHERE p.race_id = ?
      ORDER BY p.created_at DESC
      `,
      [id, id]
    );
    return rows.map(mapRow);
  }

  const rows = sqlite.prepare(`
    SELECT p.*
    FROM beacon_pings p
    INNER JOIN (
      SELECT team_code, MAX(created_at) AS max_created
      FROM beacon_pings
      WHERE race_id = ?
      GROUP BY team_code
    ) latest ON latest.team_code = p.team_code AND latest.max_created = p.created_at
    WHERE p.race_id = ?
    ORDER BY p.created_at DESC
  `).all(id, id);
  return rows.map(mapRow);
}

export async function getRecentBeaconEvents(limit = 25) {
  const safeLimit = Math.max(1, Number(limit) || 25);
  if (provider === 'mysql') {
    const [rows] = await mysqlPool.query(
      `SELECT * FROM beacon_pings ORDER BY created_at DESC LIMIT ?`,
      [safeLimit]
    );
    return rows.map(mapRow);
  }
  const rows = sqlite.prepare(`SELECT * FROM beacon_pings ORDER BY created_at DESC LIMIT ?`).all(safeLimit);
  return rows.map(mapRow);
}

export async function pruneHistory(maxRows = 4000) {
  const safeMax = Math.max(100, Number(maxRows) || 4000);
  if (provider === 'mysql') {
    await mysqlPool.query(
      `
      DELETE FROM beacon_pings
      WHERE id NOT IN (
        SELECT keep.id FROM (
          SELECT id FROM beacon_pings ORDER BY created_at DESC LIMIT ?
        ) AS keep
      )
      `,
      [safeMax]
    );
    return;
  }
  sqlite.prepare(`
    DELETE FROM beacon_pings
    WHERE id NOT IN (
      SELECT id FROM beacon_pings ORDER BY created_at DESC LIMIT ?
    )
  `).run(safeMax);
}

export function getDbPath() {
  if (provider === 'mysql') {
    const host = process.env.DB_HOST || '127.0.0.1';
    const port = Number(process.env.DB_PORT || 3306);
    const dbName = process.env.DB_NAME || 'orienteering';
    return `mysql://${host}:${port}/${dbName}`;
  }
  return sqlitePath;
}

export function getDbProvider() {
  return provider;
}
