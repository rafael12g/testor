const DB_KEY = 'orienteering_fake_backend_v1';
const HISTORY_LIMIT = 400;

const baseDb = {
  version: 1,
  races: {},
  history: [],
};

function safeRead() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return { ...baseDb };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...baseDb };
    return {
      version: 1,
      races: parsed.races || {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { ...baseDb };
  }
}

function safeWrite(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function pushBeaconPing(payload) {
  const now = Date.now();
  const db = safeRead();
  const raceId = String(payload.raceId);

  if (!db.races[raceId]) db.races[raceId] = { beacons: {} };

  const previous = db.races[raceId].beacons[payload.teamCode];
  const nextBattery = Math.max(5, Number((payload.battery ?? (previous?.battery ?? 100)).toFixed(1)));

  const beacon = {
    raceId,
    teamCode: payload.teamCode,
    teamName: payload.teamName,
    lat: payload.lat,
    lng: payload.lng,
    accuracy: payload.accuracy,
    speedKmh: payload.speedKmh,
    heading: payload.heading,
    battery: nextBattery,
    updatedAt: now,
  };

  db.races[raceId].beacons[payload.teamCode] = beacon;

  db.history.push({
    id: `${now}-${payload.teamCode}`,
    type: 'beacon_ping',
    ...beacon,
  });

  if (db.history.length > HISTORY_LIMIT) {
    db.history = db.history.slice(db.history.length - HISTORY_LIMIT);
  }

  safeWrite(db);
  return beacon;
}

export function getBeaconSnapshot(raceId) {
  const db = safeRead();
  const race = db.races[String(raceId)];
  if (!race?.beacons) return [];
  return Object.values(race.beacons)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(item => ({ ...item }));
}

export function getRecentBeaconEvents(limit = 30) {
  const db = safeRead();
  return [...db.history]
    .slice(-Math.max(1, limit))
    .reverse()
    .map(item => ({ ...item }));
}

export function clearBeaconDb() {
  safeWrite({ ...baseDb });
}
