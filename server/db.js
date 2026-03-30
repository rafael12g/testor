// ─── Storage & State ───
const MAX_PINGS = 5000, MAX_LOGS = 1000, MAX_EVENTS = 500;
let pings = [], logs = [], events = [], idCounter = 1;
let adminAuthToken = null, raceChronos = {};
const nextId = () => idCounter++;

// ─── Utilities ───
const decodeJwt = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch { return null; }
};

const collectRoles = (value, into = []) => {
  if (!value) return into;
  if (Array.isArray(value)) return value.forEach(v => collectRoles(v, into)), into;
  if (typeof value === 'object') {
    ['role', 'roles', 'name', 'code', 'label', 'authority', 'type'].forEach(k => collectRoles(value[k], into));
    return into;
  }
  if (typeof value === 'string') {
    value.trim().split(/[\s,]+/).filter(Boolean).forEach(s => into.push(s.toLowerCase()));
  }
  return into;
};

const normalizeArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const k of ['items', 'data', 'users', 'utilisateurs', 'accounts', 'comptes', 'results'])
    if (Array.isArray(payload[k])) return payload[k];
  return [];
};

const parseAccount = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const roles = [];
  collectRoles(raw.role, roles);
  collectRoles(raw.roles, roles);
  collectRoles(raw.profil, roles);
  collectRoles(raw.type, roles);
  const adminSet = new Set(['admin', 'administrateur', 'role_admin', 'superadmin', 'super_admin']);
  const orgaSet = new Set(['organisateur', 'orga', 'organizer', 'role_organisateur', 'role_orga']);
  const isAdmin = roles.some(r => adminSet.has(r)) || [raw.admin, raw.isAdmin, raw.is_admin, raw.estAdmin, raw.est_admin].some(v => v === true);
  const id = raw.id ?? raw.user_id ?? raw.userId ?? raw.id_user ?? raw.id_utilisateur ?? null;
  const username = raw.username || raw.nom_utilisateur || raw.login || raw.email || null;
  if (!username && id == null) return null;
  return { id, username, displayName: raw.nom_complet || raw.displayName || raw.fullName || username, role: roles[0] || null, roles, isAdmin, isOrga: roles.some(r => orgaSet.has(r)), raw };
};

export function getOrgaRegistrationInfo() {
  return { managed_by: 'external-api', note: 'API externe gère l\'inscription' };
}

function collectRoleValues(value, into) {
  if (value == null) return;
  if (Array.isArray(value)) return value.forEach(v => collectRoleValues(v, into));
  if (typeof value === 'object') {
    collectRoleValues(value.role, into);
    collectRoleValues(value.roles, into);
    collectRoleValues(value.name, into);
    collectRoleValues(value.code, into);
    collectRoleValues(value.label, into);
    collectRoleValues(value.authority, into);
    collectRoleValues(value.type, into);
    return;
  }
  if (typeof value === 'string') {
    const v = value.trim();
    if (!v) return;
    if (v.includes(',') || v.includes(' ')) {
      v.split(/[\s,]+/).forEach(s => { if (s) into.push(s.toLowerCase()); });
      return;
    }
    into.push(v.toLowerCase());
  }
}

function normalizeUserListPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.items,
    payload.data,
    payload.users,
    payload.utilisateurs,
    payload.accounts,
    payload.comptes,
    payload.results,
  ];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

async function apiRawFetch(endpoint, { method = 'GET', body } = {}) {
  if (!apiUrl) throw new Error('API non configurée');
  const authHeaders = [];
  if (adminAuthToken) authHeaders.push({ 'Authorization': `Bearer ${adminAuthToken}` });
  if (process.env.API_KEY) authHeaders.push({ 'Authorization': `ApiKey ${process.env.API_KEY}` });
  if (!authHeaders.length) throw new Error('Aucune authentification');

  let last = null;
  for (const authHeader of authHeaders) {
    const headers = { 'Content-Type': 'application/json', ...authHeader };
    try {
      const res = await fetch(`${apiUrl}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
      const data = await res.json().catch(() => null);
      const result = { ok: res.ok, status: res.status, data };
      if (result.ok) return result;
      last = result;
      if (res.status !== 401 && res.status !== 403) return result;
    } catch (err) { last = { ok: false, status: 500, data: null }; }
  }
  return last || { ok: false, status: 500, data: null };
}

export async function listOrgaAccountsApi() {
  if (!isApiAvailable()) throw new Error('API non configurée');
  const endpoints = ['/api/utilisateurs', '/api/users', '/api/accounts', '/api/comptes'];
  for (const endpoint of endpoints) {
    try {
      const res = await apiRawFetch(endpoint);
      if (!res?.ok) continue;
      const list = normalizeArray(res.data);
      const accounts = list.map(parseAccount).filter(Boolean).filter(a => a.isOrga && !a.isAdmin).map(a => ({ id: a.id, username: a.username, displayName: a.displayName, role: a.role, roles: a.roles }));
      return accounts;
    } catch { }
  }
  throw new Error('Impossible de lire les comptes');
}

export async function deleteOrgaAccountApi(identifier) {
  if (!isApiAvailable()) return { ok: false, error: 'API non configurée' };
  const target = String(identifier || '').trim();
  if (!target) return { ok: false, error: 'Identifiant manquant' };
  try {
    const accounts = await listOrgaAccountsApi().catch(() => []);
    const account = accounts.find(a => String(a.id) === target || String(a.username || '').toLowerCase() === target.toLowerCase());
    if (!account) return { ok: false, error: 'Compte introuvable' };
    const attempts = [
      { method: 'DELETE', endpoint: `/api/utilisateurs/${account.id}` },
      { method: 'DELETE', endpoint: `/api/users/${account.id}` },
      { method: 'DELETE', endpoint: `/api/accounts/${account.id}` },
      { method: 'DELETE', endpoint: `/api/comptes/${account.id}` },
      { method: 'POST', endpoint: `/api/utilisateurs/${account.id}/delete` },
      { method: 'POST', endpoint: `/api/users/${account.id}/delete` },
      { method: 'DELETE', endpoint: `/api/utilisateurs?username=${encodeURIComponent(account.username)}` },
      { method: 'DELETE', endpoint: `/api/users?username=${encodeURIComponent(account.username)}` },
    ];
    for (const a of attempts) {
      const res = await apiRawFetch(a.endpoint, { method: a.method }).catch(() => null);
      if (res?.ok) return { ok: true };
    }
    return { ok: false, error: 'Suppression non supportée' };
  } catch (err) { return { ok: false, error: err.message }; }
}

export async function updateOrgaPasswordApi(identifier, newPassword) {
  if (!isApiAvailable()) return { ok: false, error: 'API non configurée' };
  const target = String(identifier || '').trim();
  const password = String(newPassword || '');
  if (!target) return { ok: false, error: 'Identifiant manquant' };
  if (password.length < 4) return { ok: false, error: 'Mot de passe trop court' };
  try {
    const accounts = await listOrgaAccountsApi().catch(() => []);
    const account = accounts.find(a => String(a.id) === target || String(a.username || '').toLowerCase() === target.toLowerCase());
    if (!account) return { ok: false, error: 'Compte introuvable' };
    const attempts = [
      { method: 'PATCH', endpoint: `/api/utilisateurs/${account.id}/password`, body: { password } },
      { method: 'PUT', endpoint: `/api/utilisateurs/${account.id}/password`, body: { password } },
      { method: 'PATCH', endpoint: `/api/users/${account.id}/password`, body: { password } },
      { method: 'PUT', endpoint: `/api/users/${account.id}/password`, body: { password } },
      { method: 'PATCH', endpoint: `/api/accounts/${account.id}/password`, body: { password } },
      { method: 'PATCH', endpoint: `/api/utilisateurs/${account.id}`, body: { password } },
      { method: 'PATCH', endpoint: `/api/users/${account.id}`, body: { password } },
      { method: 'POST', endpoint: `/api/auth/reset-password`, body: { username: account.username, password, newPassword: password } },
      { method: 'POST', endpoint: `/api/auth/change-password`, body: { username: account.username, password } },
      { method: 'PATCH', endpoint: `/api/utilisateurs?username=${encodeURIComponent(account.username)}`, body: { password } },
    ];
    for (const a of attempts) {
      const res = await apiRawFetch(a.endpoint, { method: a.method, body: a.body }).catch(() => null);
      if (res?.ok) return { ok: true };
    }
    return { ok: false, error: 'Modification non supportée' };
  } catch (err) { return { ok: false, error: err.message }; }
}

// ─── Chrono ───

function getEffectiveRaceElapsed(chrono) {
  if (!chrono?.startedAt) return 0;
  if (chrono.state === 'stopped' || chrono.state === 'paused') return chrono.elapsed || 0;
  return (chrono.elapsed || 0) + (Date.now() - (chrono.resumedAt || chrono.startedAt));
}

function getEffectiveTeamElapsed(tc, chrono) {
  if (!tc) return 0;
  if (tc.state === 'stopped' || tc.state === 'paused') return tc.elapsed || 0;
  if (chrono?.state === 'paused' || chrono?.state === 'stopped') return tc.elapsed || 0;
  return (tc.elapsed || 0) + (Date.now() - (tc.resumedAt || tc.startedAt || chrono?.resumedAt || chrono?.startedAt || Date.now()));
}

export function startRaceChrono(raceId) {
  const now = Date.now();
  raceChronos[raceId] = { startedAt: now, resumedAt: now, state: 'running', elapsed: 0, teamChronos: {} };
  return raceChronos[raceId];
}

export function pauseRaceChrono(raceId) {
  const c = raceChronos[raceId];
  if (!c || c.state !== 'running') return c || null;
  const now = Date.now();
  c.elapsed = (c.elapsed || 0) + (now - (c.resumedAt || c.startedAt));
  c.pausedAt = now;
  c.state = 'paused';
  Object.values(c.teamChronos).forEach(tc => {
    if (tc.state === 'running') {
      tc.elapsed = (tc.elapsed || 0) + (now - (tc.resumedAt || tc.startedAt || c.startedAt));
      tc.pausedAt = now;
      tc.state = 'paused';
    }
  });
  return c;
}

export function resumeRaceChrono(raceId) {
  const c = raceChronos[raceId];
  if (!c || c.state !== 'paused') return c || null;
  const now = Date.now();
  c.resumedAt = now;
  c.state = 'running';
  delete c.pausedAt;
  Object.values(c.teamChronos).forEach(tc => {
    if (tc.state === 'paused') {
      tc.resumedAt = now;
      tc.state = 'running';
      delete tc.pausedAt;
    }
  });
  return c;
}

export function stopRaceChrono(raceId) {
  const c = raceChronos[raceId];
  if (!c) return null;
  const now = Date.now();
  if (c.state === 'running') c.elapsed = (c.elapsed || 0) + (now - (c.resumedAt || c.startedAt));
  c.state = 'stopped';
  c.stoppedAt = now;
  Object.values(c.teamChronos).forEach(tc => {
    if (tc.state === 'running') tc.elapsed = (tc.elapsed || 0) + (now - (tc.resumedAt || tc.startedAt || c.startedAt));
    tc.state = 'stopped';
    tc.stoppedAt = now;
  });
  return c;
}

// --- Pause/Resume/Stop par équipe ---

export function pauseTeamChrono(raceId, teamCode) {
  const c = raceChronos[raceId], tc = c?.teamChronos[teamCode];
  if (!tc || tc.state !== 'running') return tc || null;
  const now = Date.now();
  tc.elapsed = (tc.elapsed || 0) + (now - (tc.resumedAt || tc.startedAt || c?.resumedAt || c?.startedAt));
  tc.pausedAt = now;
  tc.state = 'paused';
  return tc;
}

export function resumeTeamChrono(raceId, teamCode) {
  const c = raceChronos[raceId];
  if (!c || c.state !== 'running') return null;
  const tc = c.teamChronos[teamCode];
  if (!tc || tc.state !== 'paused') return tc || null;
  const now = Date.now();
  tc.resumedAt = now;
  tc.state = 'running';
  delete tc.pausedAt;
  return tc;
}

export function stopTeamChrono(raceId, teamCode) {
  const c = raceChronos[raceId], tc = c?.teamChronos[teamCode];
  if (!tc) return null;
  const now = Date.now();
  if (tc.state === 'running') tc.elapsed = (tc.elapsed || 0) + (now - (tc.resumedAt || tc.startedAt || c?.resumedAt || c?.startedAt));
  tc.state = 'stopped';
  tc.stoppedAt = now;
  return tc;
}

export function getRaceChrono(raceId) {
  return raceChronos[raceId] || null;
}

export function recordTeamCheckpoint(raceId, teamCode, checkpointIndex) {
  const c = raceChronos[raceId];
  if (!c || c.state === 'stopped') return null;
  if (!c.teamChronos[teamCode]) {
    c.teamChronos[teamCode] = { startedAt: c.startedAt, resumedAt: c.resumedAt, state: c.state, elapsed: c.elapsed || 0, checkpoints: [] };
  }
  const tc = c.teamChronos[teamCode];
  if (tc.state === 'stopped') return tc;
  const raceElapsed = getEffectiveRaceElapsed(c);
  // Éviter les doublons de checkpoint
  if (!tc.checkpoints.find(cp => cp.index === checkpointIndex)) {
    tc.checkpoints.push({ index: checkpointIndex, time: Date.now(), elapsed: raceElapsed });
  }
  return tc;
}

export function getAllRaceChronos() {
  return raceChronos;
}

// ─── beacon_pings (en mémoire) ───

export async function insertBeaconPing(p) {
  const entry = {
    id: nextId(),
    race_id: p.raceId,
    team_code: p.teamCode,
    team_name: p.teamName,
    lat: Number(p.lat),
    lng: Number(p.lng),
    accuracy: Number(p.accuracy),
    speed_kmh: Number(p.speedKmh),
    heading: Number(p.heading),
    battery: Number(p.battery),
    created_at: p.createdAt || Date.now(),
  };
  pings.push(entry);
  return entry;
}

export async function getBeaconSnapshotByRace(raceId) {
  const id = String(raceId);
  const byTeam = new Map();
  for (const p of pings) {
    if (p.race_id !== id) continue;
    const prev = byTeam.get(p.team_code);
    if (!prev || p.created_at > prev.created_at) byTeam.set(p.team_code, p);
  }
  return [...byTeam.values()].sort((a, b) => b.created_at - a.created_at);
}

export async function getRecentBeaconEvents(limit = 25) {
  const n = Math.max(1, Number(limit) || 25);
  return pings.slice(-n).reverse();
}

export async function pruneBeacons(max = MAX_PINGS) {
  if (pings.length > max) pings = pings.slice(-max);
}

// ─── server_logs (en mémoire) ───

export async function insertServerLog(level, message, meta = null) {
  const entry = { id: nextId(), level, message, meta, timestamp: Date.now() };
  logs.push(entry);
  return entry;
}

export async function getServerLogs(limit = 80) {
  const n = Math.max(1, Number(limit) || 80);
  return logs.slice(-n).reverse();
}

export async function pruneServerLogs(max = MAX_LOGS) {
  if (logs.length > max) logs = logs.slice(-max);
}

// ─── race_events (en mémoire) ───

export async function insertRaceEvent(raceId, eventType, payload = null) {
  const entry = { id: nextId(), race_id: String(raceId), event_type: eventType, payload, created_at: Date.now() };
  events.push(entry);
  return entry;
}

export async function getRaceHistory(raceId, limit = 50) {
  const n = Math.max(1, Number(limit) || 50);
  const filtered = raceId ? events.filter(e => e.race_id === String(raceId)) : events;
  return filtered.slice(-n).reverse();
}

// ─── API externe (lecture courses — JWT auth) ───

let apiUrl = null;
let apiReady = false; // vrai si le serveur API répond (même 401/403), faux uniquement si hors ligne

export async function initApi() {
  const url = (process.env.API_URL || '').trim();
  if (!url) {
    apiReady = false;
    console.log('API_URL non défini — lecture API externe désactivée');
    return;
  }
  apiUrl = url.replace(/\/+$/, '');
  // Vérifier que le serveur est joignable — toute réponse HTTP = serveur actif
  try {
    const res = await fetch(`${apiUrl}/api/courses`, {
      headers: { 'Authorization': `ApiKey ${process.env.API_KEY || ''}` },
      signal: AbortSignal.timeout(5000),
    });
    // Toute réponse HTTP (même 401/403) signifie que le serveur est joignable
    apiReady = true;
    if (res.ok) {
      console.log(`API externe configurée → ${apiUrl} ✅ (clé API valide)`);
    } else {
      console.warn(`API externe configurée → ${apiUrl} ⚠️ (réponse ${res.status}, serveur joignable)`);
    }
  } catch (err) {
    // Erreur réseau = serveur vraiment hors ligne
    apiReady = false;
    console.warn(`API externe configurée → ${apiUrl} ❌ hors ligne (${err.message})`);
  }
}

export function isApiAvailable() { return !!apiUrl && !!process.env.API_KEY && apiReady; }

export async function apiFetch(endpoint, options = {}) {
  if (!apiUrl) throw new Error('API non configurée (API_URL manquant)');
  if (!process.env.API_KEY) throw new Error('API_KEY manquante');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `ApiKey ${process.env.API_KEY}`,
    ...options.headers,
  };

  const res = await fetch(`${apiUrl}${endpoint}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── API externe (courses) ───

const parseCheckpoints = (ordreBalises, allBalises) => {
  const checkpoints = [];
  ordreBalises.forEach(ob => {
    if (ob.balise?.latitude != null) checkpoints.push({ lat: Number(ob.balise.latitude), lng: Number(ob.balise.longitude) });
    else if (ob.latitude != null) checkpoints.push({ lat: Number(ob.latitude), lng: Number(ob.longitude) });
    else {
      const found = allBalises.find(b => b.id === (ob.id_balise || ob.balise_id));
      if (found) checkpoints.push({ lat: Number(found.latitude), lng: Number(found.longitude) });
    }
  });
  return checkpoints;
};

export async function getCoursesApi() {
  if (!isApiAvailable()) return [];
  try {
    const data = await apiRawFetch('/api/courses');
    const courses = normalizeArray(data.data);
    const allEquipes = normalizeArray(await apiRawFetch('/api/equipes').then(r => r.data).catch(() => []));
    const allBalises = normalizeArray(await apiRawFetch('/api/balises').then(r => r.data).catch(() => []));
    const result = [];
    
    for (const course of courses) {
      const obData = await apiRawFetch(`/api/ordre-balises/course/${course.id}`).catch(() => ({ data: [] }));
      const checkpoints = parseCheckpoints(normalizeArray(obData.data), allBalises);
      const equipes = allEquipes.filter(eq => eq.id_course_actuelle === course.id || eq.course_id === course.id || eq.id_course === course.id);
      const startLat = checkpoints[0]?.lat ?? 44.837789, startLng = checkpoints[0]?.lng ?? -0.57918;
      result.push({
        id: course.id,
        name: course.nom_course || course.nom || course.name || `Course ${course.id}`,
        start: { lat: Number(startLat), lng: Number(startLng) },
        isActive: course.est_demarree === true && course.est_terminee === false,
        checkpoints,
        teams: equipes.map(eq => ({ name: eq.nom_equipe || eq.nom || eq.name || `Équipe ${eq.id}`, code: eq.badge_tag || String(eq.id), order: checkpoints })),
      });
    }
    return result;
  } catch { return []; }
}

// ─── Rejoindre par code ───

export async function getTeamByCodeApi(code) {
  if (!isApiAvailable()) return null;
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return null;
  try {
    const codesData = await apiRawFetch('/api/codes');
    const codeList = normalizeArray(codesData.data);
    const codeEntry = codeList.find(c => [c?.nomcode, c?.valeur_code, c?.code, c?.nom_code].map(v => String(v || '').trim().toUpperCase()).filter(Boolean).includes(normalizedCode));
    if (!codeEntry) return null;
    
    const courseId = codeEntry.id_course;
    if (!courseId) return null;
    
    const cData = await apiRawFetch('/api/courses');
    const courseList = normalizeArray(cData.data);
    const course = courseList.find(c => c.id === courseId);
    if (!course) return null;
    
    const obData = await apiRawFetch(`/api/ordre-balises/course/${course.id}`).catch(() => ({ data: [] }));
    const bData = await apiRawFetch('/api/balises').catch(() => ({ data: [] }));
    const checkpoints = parseCheckpoints(normalizeArray(obData.data), normalizeArray(bData.data));
    const startLat = checkpoints[0]?.lat ?? 44.837789, startLng = checkpoints[0]?.lng ?? -0.57918;
    
    return { team: { name: codeEntry.nom_equipe || `Équipe ${codeEntry.id_equipe}`, code: normalizedCode }, course: { id: course.id, name: codeEntry.nom_course || course.nom_course || course.nom || `Course ${course.id}`, start: { lat: Number(startLat), lng: Number(startLng) }, checkpoints } };
  } catch { return null; }
}

// ─── Login admin via l'API externe ───

export async function loginViaApi(username, password) {
  if (!isApiAvailable()) {
    return { ok: false, error: 'API externe non configurée (API_URL/API_KEY manquants)' };
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.API_KEY) headers['Authorization'] = `ApiKey ${process.env.API_KEY}`;

    const res = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.warn(`Login échoué: ${res.status} — ${errData.error || res.statusText}`);
      return { ok: false, error: errData.error || 'Identifiants incorrects' };
    }

    const data = await res.json();

    const decodeJwtPayload = (token) => {
      try {
        const parts = String(token || '').split('.');
        if (parts.length < 2) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const json = Buffer.from(padded, 'base64').toString('utf8');
        return JSON.parse(json);
      } catch {
        return null;
      }
    };

    const pickAccountInPayload = (payload, loginUsername) => {
      if (!payload || typeof payload !== 'object') return null;
      const direct = payload.account || payload.user || payload.utilisateur || payload.data;
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;

      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.users)
            ? payload.users
            : Array.isArray(payload.utilisateurs)
              ? payload.utilisateurs
              : Array.isArray(payload.data)
                ? payload.data
                : null;

      if (!list) return null;
      const target = String(loginUsername || '').trim().toLowerCase();
      return list.find((u) => {
        const candidate = String(u?.username || u?.nom_utilisateur || u?.login || u?.email || '').trim().toLowerCase();
        return candidate && candidate === target;
      }) || null;
    };

    const token = data?.token || data?.accessToken || data?.jwt || data?.access_token;
    adminAuthToken = token || adminAuthToken;
    const tokenPayload = decodeJwtPayload(token);

    const fetchAccountFromApi = async (loginUsername) => {
      if (!token) return null;
      const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

      const endpoints = [
        '/api/auth/me',
        '/api/users/me',
        '/api/utilisateurs/me',
        '/api/me',
        '/api/user',
        '/api/utilisateurs',
      ];

      for (const endpoint of endpoints) {
        try {
          const meRes = await fetch(`${apiUrl}${endpoint}`, {
            method: 'GET',
            headers: authHeaders,
            signal: AbortSignal.timeout(5000),
          });
          if (!meRes.ok) continue;
          const meData = await meRes.json().catch(() => null);
          const account = pickAccountInPayload(meData, loginUsername);
          if (account) return account;
        } catch {
          // on tente l'endpoint suivant
        }
      }

      return null;
    };

    const accountFromLogin = pickAccountInPayload(data, username);
    const accountFromApi = await fetchAccountFromApi(username);
    const account = accountFromApi || accountFromLogin || { username };

    const roleValues = [];
    const collectRoles = (value) => {
      if (value == null) return;
      if (Array.isArray(value)) {
        value.forEach(collectRoles);
        return;
      }
      if (typeof value === 'object') {
        collectRoles(value.role);
        collectRoles(value.roles);
        collectRoles(value.name);
        collectRoles(value.code);
        collectRoles(value.label);
        collectRoles(value.authority);
        collectRoles(value.type);
        return;
      }
      if (typeof value === 'string') {
        const v = value.trim();
        if (!v) return;
        if (v.includes(',') || v.includes(' ')) {
          v.split(/[\s,]+/).forEach(s => { if (s) roleValues.push(s.toLowerCase()); });
          return;
        }
        roleValues.push(v.toLowerCase());
      }
    };

    const hasAdminFlag = (obj) => !!obj && typeof obj === 'object' && (
      obj.admin === true
      || obj.isAdmin === true
      || obj.is_admin === true
      || obj.estAdmin === true
      || obj.est_admin === true
    );

    collectRoles(data?.role);
    collectRoles(data?.roles);
    collectRoles(data?.user?.role);
    collectRoles(data?.user?.roles);
    collectRoles(data?.account?.role);
    collectRoles(data?.account?.roles);
    collectRoles(data?.utilisateur?.role);
    collectRoles(data?.utilisateur?.roles);
    collectRoles(account?.role);
    collectRoles(account?.roles);
    collectRoles(account?.profil);
    collectRoles(account?.type);
    collectRoles(tokenPayload?.role);
    collectRoles(tokenPayload?.roles);
    collectRoles(tokenPayload?.authorities);
    collectRoles(tokenPayload?.scope);

    const adminRoleSet = new Set(['admin', 'administrateur', 'role_admin', 'superadmin', 'super_admin']);
    const isAdmin = roleValues.some(r => adminRoleSet.has(r))
      || hasAdminFlag(data)
      || hasAdminFlag(account)
      || hasAdminFlag(tokenPayload)
      || data?.permissions?.admin === true;

    const role = roleValues[0] || '';
    if (!isAdmin) {
      console.warn(`Login refusé (non-admin): ${username} [role=${role || 'inconnu'}]`);
      return { ok: false, error: 'Compte non autorisé pour l\'espace admin' };
    }

    console.log(`Admin connecté via API → ${username} ✅`);
    return { ok: true, permissions: data.permissions || { admin: true }, account };
  } catch (err) {
    console.warn(`Échec login admin: ${err.message}`);
    return { ok: false, error: 'Erreur de connexion à l\'API' };
  }
}
