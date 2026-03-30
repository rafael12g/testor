const BASE_URL = '/api';

async function safeFetch(url, options = {}, { timeout = 8000, fallback = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return clearTimeout(timer), res;
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[api] ${err.name === 'AbortError' ? 'Timeout' : 'Network error'} — ${url}`);
    if (fallback !== null) return null;
    throw err;
  }
}

const jsonFetch = async (method, url, data = null, fallback = null) => {
  try {
    const res = await safeFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }, { fallback });
    if (!res || !res.ok) return fallback !== null ? fallback : { ok: false, error: res ? await res.json().then(d => d.error).catch(() => 'Error') : 'Backend unavailable' };
    return await res.json();
  } catch { return fallback !== null ? fallback : { ok: false, error: 'Network error' }; }
};

const apiGet = (url, fallback = null) => jsonFetch('GET', url, null, fallback);
const apiPost = (url, data, fallback = null) => jsonFetch('POST', url, data, fallback);
const apiPatch = (url, data) => jsonFetch('PATCH', url, data, { ok: false });
const apiDelete = (url) => jsonFetch('DELETE', url, null, { ok: false });

export const sendBeaconPing = data => jsonFetch('POST', `${BASE_URL}/beacons/ping`, data, { ok: false });
export const fetchBeaconSnapshot = raceId => apiGet(`${BASE_URL}/races/${raceId}/beacons`, []).then(d => Array.isArray(d.items) ? d.items : []);
export const fetchRecentBeaconEvents = limit => apiGet(`${BASE_URL}/beacons/events?limit=${limit}`, []).then(d => Array.isArray(d.items) ? d.items : []);
export const fetchServerLogs = limit => apiGet(`${BASE_URL}/logs?limit=${limit}`, []).then(d => Array.isArray(d.items) ? d.items : []);
export const sendRaceEvent = (raceId, eventType, payload) => jsonFetch('POST', `${BASE_URL}/races/${raceId}/events`, { eventType, payload }, null);
export const fetchRaceHistory = (raceId, limit = 40) => apiGet(raceId ? `${BASE_URL}/races/${raceId}/history?limit=${limit}` : `${BASE_URL}/history?limit=${limit}`, []).then(d => Array.isArray(d.items) ? d.items : []);
export const pingBackendHealth = async () => { const r = await apiGet(`${BASE_URL}/health`); if (!r.ok) throw new Error('Backend unavailable'); return r; };
export const loginAdmin = (u, p) => jsonFetch('POST', `${BASE_URL}/auth/admin`, { username: u, password: p });
export const loginOrga = (u, p) => jsonFetch('POST', `${BASE_URL}/auth/login`, { username: u, password: p });
export const registerOrga = (u, p) => jsonFetch('POST', `${BASE_URL}/auth/register`, { username: u, password: p });
export const fetchOrgaRegisterInfo = () => apiGet(`${BASE_URL}/auth/register-info`, null);
export const fetchOrgaAccounts = () => apiGet(`${BASE_URL}/admin/organisateurs`, []).then(d => Array.isArray(d.items) ? d.items : []);
export const deleteOrgaAccount = id => apiDelete(`${BASE_URL}/admin/organisateurs/${encodeURIComponent(String(id || '').trim())}`);
export const updateOrgaPassword = (id, pwd) => apiPatch(`${BASE_URL}/admin/organisateurs/${encodeURIComponent(String(id || '').trim())}`, { password: pwd });

const postRace = (endpoint, raceId) => jsonFetch('POST', `${BASE_URL}/orga/courses/${raceId}/${endpoint}`, {});
export const startRace = raceId => postRace('start', raceId);
export const pauseRace = raceId => postRace('pause', raceId);
export const resumeRace = raceId => postRace('resume', raceId);
export const stopRace = raceId => postRace('stop', raceId);

const postTeam = (endpoint, raceId, teamCode) => jsonFetch('POST', `${BASE_URL}/orga/courses/${raceId}/teams/${teamCode}/${endpoint}`, {});
export const pauseTeam = (raceId, teamCode) => postTeam('pause', raceId, teamCode);
export const resumeTeam = (raceId, teamCode) => postTeam('resume', raceId, teamCode);
export const stopTeam = (raceId, teamCode) => postTeam('stop', raceId, teamCode);

export const fetchRaceChrono = raceId => apiGet(`${BASE_URL}/orga/courses/${raceId}/chrono`, null).then(d => d?.chrono || null);
export const recordCheckpoint = (raceId, teamCode, checkpointIndex) => jsonFetch('POST', `${BASE_URL}/orga/courses/${raceId}/teams/${teamCode}/checkpoint`, { checkpointIndex }, { ok: false });
export const fetchAllChronos = () => apiGet(`${BASE_URL}/orga/chronos`, null).then(d => d?.chronos || {});

