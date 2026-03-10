const BASE_URL = '/api';

/** Helper : fetch with timeout + graceful network error handling */
async function safeFetch(url, options = {}, { timeout = 8000, fallback = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.warn(`[api] Timeout sur ${url}`);
    } else {
      console.warn(`[api] Réseau indisponible (${err.message}) — ${url}`);
    }
    if (fallback !== null) return null;   // caller handles null
    throw err;
  }
}

export async function sendBeaconPing(payload) {
  const response = await safeFetch(`${BASE_URL}/beacons/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response || !response.ok) {
    console.warn('[api] Impossible d\u2019enregistrer le ping balise');
    return { ok: false };
  }

  return response.json();
}

export async function fetchBeaconSnapshot(raceId) {
  try {
    const response = await safeFetch(`${BASE_URL}/races/${raceId}/beacons`, {}, { fallback: [] });
    if (!response || !response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

export async function fetchRecentBeaconEvents(limit = 12) {
  try {
    const response = await safeFetch(`${BASE_URL}/beacons/events?limit=${limit}`, {}, { fallback: [] });
    if (!response || !response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

export async function fetchServerLogs(limit = 60) {
  try {
    const response = await safeFetch(`${BASE_URL}/logs?limit=${limit}`, {}, { fallback: [] });
    if (!response || !response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

export async function sendRaceEvent(raceId, eventType, payload = null) {
  try {
    const response = await safeFetch(`${BASE_URL}/races/${raceId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, payload }),
    });
    if (!response || !response.ok) return null;
    return response.json();
  } catch { return null; }
}

export async function fetchRaceHistory(raceId, limit = 40) {
  try {
    const url = raceId
      ? `${BASE_URL}/races/${raceId}/history?limit=${limit}`
      : `${BASE_URL}/history?limit=${limit}`;
    const response = await safeFetch(url, {}, { fallback: [] });
    if (!response || !response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

export async function pingBackendHealth() {
  const response = await safeFetch(`${BASE_URL}/health`, {}, { timeout: 3000 });
  if (!response || !response.ok) throw new Error('Backend indisponible');
  return response.json();
}

export async function loginAdmin(username, password) {
  try {
    const res = await safeFetch(`${BASE_URL}/auth/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Identifiants incorrects' };
    return data;
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}
