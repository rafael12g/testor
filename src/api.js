const BASE_URL = '/api';
let sessionToken = null;

export function setSessionToken(token) {
  const next = String(token || '').trim();
  sessionToken = next || null;
}

/** Helper : fetch with timeout + graceful network error handling */
async function safeFetch(url, options = {}, { timeout = 8000, fallback = null, skipAuth = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { ...(options.headers || {}) };
    if (!skipAuth && sessionToken && !headers.Authorization) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
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

export async function fetchCourses() {
  try {
    const res = await safeFetch(`${BASE_URL}/courses`, {}, { fallback: [] });
    if (!res || !res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

export async function fetchTeamByCode(code) {
  try {
    const normalized = encodeURIComponent(String(code || '').trim().toUpperCase());
    if (!normalized) return { ok: false, error: 'Code requis' };
    const res = await safeFetch(`${BASE_URL}/teams/code/${normalized}`, {}, { fallback: null });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Code introuvable ou course inactive.' };
    const payload = data?.data || data;
    if (payload?.ok === false) return payload;
    if (payload?.team && payload?.course) return { ok: true, ...payload };
    return { ok: false, error: payload?.error || 'Réponse invalide du serveur' };
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

export async function loginAdmin(username, password) {
  try {
    setSessionToken(null);
    const res = await safeFetch(`${BASE_URL}/auth/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }, { skipAuth: true });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Identifiants incorrects' };
    setSessionToken(data.token || data.accessToken || data.jwt || data.access_token || null);
    return data;
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

export async function loginAdminWithToken(token) {
  try {
    setSessionToken(null);
    const jwt = String(token || '').trim();
    if (!jwt) return { ok: false, error: 'Token JWT requis' };
    const res = await safeFetch(`${BASE_URL}/auth/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: jwt }),
    }, { skipAuth: true });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Token JWT invalide' };
    setSessionToken(data.token || jwt);
    return data;
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

// ─── Organisateur ───

export async function registerOrga(username, password) {
  try {
    const res = await safeFetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Erreur inscription' };
    return data;
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

export async function loginOrga(username, password) {
  try {
    setSessionToken(null);
    const res = await safeFetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }, { skipAuth: true });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Identifiants incorrects' };
    setSessionToken(data.token || data.accessToken || data.jwt || data.access_token || null);
    return data;
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

export async function loginOrgaWithToken(token) {
  try {
    setSessionToken(null);
    const jwt = String(token || '').trim();
    if (!jwt) return { ok: false, error: 'Token JWT requis' };
    const res = await safeFetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: jwt }),
    }, { skipAuth: true });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Token JWT invalide' };
    setSessionToken(data.token || jwt);
    return data;
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

export async function fetchOrgaRegisterInfo() {
  try {
    const res = await safeFetch(`${BASE_URL}/auth/register-info`, {}, { fallback: null });
    if (!res || !res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function fetchOrgaAccounts() {
  try {
    const res = await safeFetch(`${BASE_URL}/admin/organisateurs`, {}, { fallback: [] });
    if (!res || !res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch { return []; }
}

export async function deleteOrgaAccount(identifier) {
  try {
    const id = encodeURIComponent(String(identifier || '').trim());
    if (!id) return { ok: false, error: 'Identifiant manquant' };
    const res = await safeFetch(`${BASE_URL}/admin/organisateurs/${id}`, { method: 'DELETE' });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Suppression impossible' };
    return { ok: true };
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

export async function updateOrgaPassword(identifier, password) {
  try {
    const id = encodeURIComponent(String(identifier || '').trim());
    if (!id) return { ok: false, error: 'Identifiant manquant' };
    const res = await safeFetch(`${BASE_URL}/admin/organisateurs/${id}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res) return { ok: false, error: 'Backend indisponible' };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Modification impossible' };
    return { ok: true };
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

export async function startRace(raceId) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res || !res.ok) return { ok: false, error: 'Erreur démarrage course' };
    return res.json();
  } catch { return { ok: false, error: 'Erreur réseau' }; }
}

export async function pauseRace(raceId) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res || !res.ok) return { ok: false };
    return res.json();
  } catch { return { ok: false }; }
}

export async function resumeRace(raceId) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res || !res.ok) return { ok: false };
    return res.json();
  } catch { return { ok: false }; }
}

export async function stopRace(raceId) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res || !res.ok) return { ok: false };
    return res.json();
  } catch { return { ok: false }; }
}

export async function pauseTeam(raceId, teamCode) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/teams/${teamCode}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res || !res.ok) return { ok: false };
    return res.json();
  } catch { return { ok: false }; }
}

export async function resumeTeam(raceId, teamCode) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/teams/${teamCode}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res || !res.ok) return { ok: false };
    return res.json();
  } catch { return { ok: false }; }
}

export async function stopTeam(raceId, teamCode) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/teams/${teamCode}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res || !res.ok) return { ok: false };
    return res.json();
  } catch { return { ok: false }; }
}

export async function fetchRaceChrono(raceId) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/chrono`, {}, { fallback: null });
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data.chrono || null;
  } catch { return null; }
}

export async function recordCheckpoint(raceId, teamCode, checkpointIndex) {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/courses/${raceId}/teams/${teamCode}/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpointIndex }),
    });
    if (!res || !res.ok) return { ok: false };
    return res.json();
  } catch { return { ok: false }; }
}

export async function fetchAllChronos() {
  try {
    const res = await safeFetch(`${BASE_URL}/orga/chronos`, {}, { fallback: null });
    if (!res || !res.ok) return {};
    const data = await res.json();
    return data.chronos || {};
  } catch { return {}; }
}

export async function fetchWeatherForecast(lat, lng) {
  try {
    const safeLat = Number(lat);
    const safeLng = Number(lng);
    if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return null;

    const params = new URLSearchParams({
      latitude: String(safeLat),
      longitude: String(safeLng),
      timezone: 'auto',
      forecast_days: '3',
      current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
      hourly: 'temperature_2m,precipitation_probability,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

    const res = await safeFetch(url, {}, {
      fallback: null,
      timeout: 9000,
      skipAuth: true,
    });

    if (!res || !res.ok) {
      // Fallback frontend direct (sans AbortController) pour environnements restrictifs.
      const raw = await fetch(url, { method: 'GET', cache: 'no-store' }).catch(() => null);
      if (!raw || !raw.ok) return null;
      return await raw.json();
    }
    return await res.json();
  } catch {
    return null;
  }
}
