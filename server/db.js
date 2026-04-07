// ─── Stockage en mémoire (logs, pings, events, orga) ───────────────
// Pas de BDD locale — tout passe par l'API externe pour les courses.
// Les logs / pings / events sont éphémères et stockés en RAM.

const MAX_PINGS = 5000;
const MAX_LOGS = 1000;
const MAX_EVENTS = 500;

let pings = [];
let logs = [];
let events = [];
let idCounter = 1;
let adminAuthToken = null; // token admin API (récupéré au login) pour appels de gestion comptes

function nextId() { return idCounter++; }

// ─── Organisateurs (100% gérés par API externe) ───

let raceChronos = {};            // { [raceId]: { startedAt, teamChronos: { [teamCode]: { startedAt, checkpoints: [{index, time}] } } } }

export async function registerOrga(username, password, authToken = null) {
  if (!isApiAvailable()) return { ok: false, error: 'API externe non configurée ou indisponible' };
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    else if (process.env.API_KEY) headers['Authorization'] = `ApiKey ${process.env.API_KEY}`;

    const res = await fetch(`${apiUrl}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ username, password, role: 'organisateur' }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData.error || errData.message || (errData.errors && errData.errors.map(e => e.msg).join(', ')) || res.statusText;
      console.warn(`Register orga échoué: ${res.status} — ${errMsg}`);
      if (res.status === 409) return { ok: false, error: 'Ce nom d\'utilisateur est déjà pris.' };
      if (res.status === 429) return { ok: false, error: 'Trop de tentatives. Réessaie plus tard.' };
      return { ok: false, error: errMsg };
    }

    const data = await res.json();
    console.log(`Compte orga créé via API → ${username} ✅`);
    return { ok: true, account: data.account || data.user || { username } };
  } catch (err) {
    console.warn(`Erreur création compte orga: ${err.message}`);
    return { ok: false, error: 'Erreur de connexion à l\'API' };
  }
}

export async function loginOrga(username, password) {
  if (!isApiAvailable()) return { ok: false, error: 'API externe non configurée ou indisponible' };
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
      console.warn(`Login orga échoué: ${res.status} — ${errData.error || res.statusText}`);
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

    const account = data.account || data.user || data.utilisateur || null;
    const token = data?.token || data?.accessToken || data?.jwt || data?.access_token;
    const tokenPayload = decodeJwtPayload(token);

    const roleValues = [];
    const collectRoles = (value) => {
      if (value == null) return;
      if (Array.isArray(value)) return value.forEach(collectRoles);
      if (typeof value === 'object') {
        collectRoles(value.role);
        collectRoles(value.roles);
        collectRoles(value.name);
        collectRoles(value.code);
        collectRoles(value.label);
        collectRoles(value.authority);
        return;
      }
      if (typeof value === 'string') {
        const v = value.trim();
        if (!v) return;
        if (v.includes(',') || v.includes(' ')) {
          return v.split(/[\s,]+/).forEach(s => { if (s) roleValues.push(s.toLowerCase()); });
        }
        roleValues.push(v.toLowerCase());
      }
    };

    collectRoles(data?.role);
    collectRoles(data?.roles);
    collectRoles(account?.role);
    collectRoles(account?.roles);
    collectRoles(tokenPayload?.role);
    collectRoles(tokenPayload?.roles);
    collectRoles(tokenPayload?.authorities);
    collectRoles(tokenPayload?.scope);

    const orgaRoleSet = new Set(['organisateur', 'orga', 'organizer', 'role_organisateur', 'role_orga']);
    const isOrga = roleValues.some(r => orgaRoleSet.has(r));
    if (!isOrga) {
      console.warn(`Login orga refusé (non-organisateur): ${username} [roles=${roleValues.join(',') || 'inconnu'}]`);
      return { ok: false, error: 'Compte non autorisé pour l\'espace organisateur' };
    }

    console.log(`Orga connecté via API → ${username} ✅`);
    return { ok: true, role: 'orga', account: account || { username }, token: token || null, permissions: data.permissions || null };
  } catch (err) {
    console.warn(`Login orga échoué: ${err.message}`);
    return { ok: false, error: 'Erreur de connexion à l\'API' };
  }
}

export function getOrgaRegistrationInfo() {
  // Le rate-limiting est gérés par l'API externe
  return { managed_by: 'external-api', note: 'L\'API externe gère les règles d\'inscription' };
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

function parseAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const roles = [];
  collectRoleValues(raw.role, roles);
  collectRoleValues(raw.roles, roles);
  collectRoleValues(raw.profil, roles);
  collectRoleValues(raw.type, roles);

  const adminRoleSet = new Set(['admin', 'administrateur', 'role_admin', 'superadmin', 'super_admin']);
  const orgaRoleSet = new Set(['organisateur', 'orga', 'organizer', 'role_organisateur', 'role_orga']);

  const isAdmin = roles.some(r => adminRoleSet.has(r))
    || raw.admin === true
    || raw.isAdmin === true
    || raw.is_admin === true
    || raw.estAdmin === true
    || raw.est_admin === true;

  const isOrga = roles.some(r => orgaRoleSet.has(r));

  const id = raw.id ?? raw.user_id ?? raw.userId ?? raw.id_user ?? raw.id_utilisateur ?? raw.utilisateur_id ?? null;
  const username = raw.username || raw.nom_utilisateur || raw.login || raw.email || raw.nom || null;

  if (!username && id == null) return null;

  return {
    id,
    username,
    displayName: raw.nom_complet || raw.displayName || raw.fullName || username || `Utilisateur ${id}`,
    role: raw.role || roles[0] || null,
    roles,
    isAdmin,
    isOrga,
    raw,
  };
}

async function apiRawFetch(endpoint, { method = 'GET', body, authToken = null } = {}) {
  if (!apiUrl) throw new Error('API non configurée (API_URL manquant)');
  const authHeaders = [];
  if (authToken) authHeaders.push({ 'Authorization': `Bearer ${authToken}` });
  if (adminAuthToken) authHeaders.push({ 'Authorization': `Bearer ${adminAuthToken}` });
  if (process.env.API_KEY) authHeaders.push({ 'Authorization': `ApiKey ${process.env.API_KEY}` });
  if (authHeaders.length === 0) throw new Error('Aucun moyen d\'authentification API disponible');

  let last = null;
  for (const authHeader of authHeaders) {
    const headers = { 'Content-Type': 'application/json', ...authHeader };
    const res = await fetch(`${apiUrl}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });

    let data = null;
    try { data = await res.json(); } catch { data = null; }
    const result = { ok: res.ok, status: res.status, data };
    if (result.ok) return result;
    last = result;

    // Si auth refusée, essayer le prochain mode (Bearer -> ApiKey)
    if (res.status === 401 || res.status === 403) continue;
    return result;
  }

  return last || { ok: false, status: 500, data: null };
}

export async function listOrgaAccountsApi(authToken = null) {
  if (!isApiAvailable()) throw new Error('API externe non configurée ou indisponible');

  const endpoints = ['/api/utilisateurs', '/api/users', '/api/accounts', '/api/comptes'];
  let lastErr = null;

  for (const endpoint of endpoints) {
    try {
      const res = await apiRawFetch(endpoint, { method: 'GET', authToken });
      if (!res?.ok) {
        lastErr = new Error(`API ${res?.status || 500} sur ${endpoint}`);
        continue;
      }
      const payload = res.data;
      const list = normalizeUserListPayload(payload);
      if (!Array.isArray(list)) continue;

      const accounts = list
        .map(parseAccount)
        .filter(Boolean)
        .filter(acc => acc.isOrga && !acc.isAdmin)
        .map(acc => ({
          id: acc.id,
          username: acc.username,
          displayName: acc.displayName,
          role: acc.role,
          roles: acc.roles,
        }));

      return accounts;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Impossible de lire les comptes organisateurs');
}

export async function deleteOrgaAccountApi(identifier, authToken = null) {
  if (!isApiAvailable()) return { ok: false, error: 'API externe non configurée ou indisponible' };
  const target = String(identifier || '').trim();
  if (!target) return { ok: false, error: 'Identifiant organisateur manquant' };

  const orgaAccounts = await listOrgaAccountsApi(authToken).catch(() => []);
  const account = orgaAccounts.find(a => String(a.id) === target || String(a.username || '').toLowerCase() === target.toLowerCase());
  if (!account) return { ok: false, error: 'Compte organisateur introuvable' };

  const encodedId = encodeURIComponent(String(account.id ?? target));
  const encodedUsername = encodeURIComponent(String(account.username || ''));

  const attempts = [
    { method: 'DELETE', endpoint: `/api/utilisateurs/${encodedId}` },
    { method: 'DELETE', endpoint: `/api/users/${encodedId}` },
    { method: 'DELETE', endpoint: `/api/accounts/${encodedId}` },
    { method: 'DELETE', endpoint: `/api/comptes/${encodedId}` },
    { method: 'POST', endpoint: `/api/utilisateurs/${encodedId}/delete` },
    { method: 'POST', endpoint: `/api/users/${encodedId}/delete` },
    { method: 'DELETE', endpoint: `/api/utilisateurs?username=${encodedUsername}` },
    { method: 'DELETE', endpoint: `/api/users?username=${encodedUsername}` },
  ];

  for (const a of attempts) {
    const res = await apiRawFetch(a.endpoint, { method: a.method, authToken }).catch(() => null);
    if (res?.ok) return { ok: true };
  }

  return { ok: false, error: 'Suppression non supportée par l\'API externe' };
}

export async function updateOrgaPasswordApi(identifier, newPassword, authToken = null) {
  if (!isApiAvailable()) return { ok: false, error: 'API externe non configurée ou indisponible' };
  const target = String(identifier || '').trim();
  const password = String(newPassword || '');
  if (!target) return { ok: false, error: 'Identifiant organisateur manquant' };
  if (password.length < 4) return { ok: false, error: 'Mot de passe trop court (4 caractères min)' };

  const orgaAccounts = await listOrgaAccountsApi(authToken).catch(() => []);
  const account = orgaAccounts.find(a => String(a.id) === target || String(a.username || '').toLowerCase() === target.toLowerCase());
  if (!account) return { ok: false, error: 'Compte organisateur introuvable' };

  const encodedId = encodeURIComponent(String(account.id ?? target));
  const encodedUsername = encodeURIComponent(String(account.username || ''));

  const attempts = [
    { method: 'PATCH', endpoint: `/api/utilisateurs/${encodedId}/password`, body: { password } },
    { method: 'PUT', endpoint: `/api/utilisateurs/${encodedId}/password`, body: { password } },
    { method: 'PATCH', endpoint: `/api/users/${encodedId}/password`, body: { password } },
    { method: 'PUT', endpoint: `/api/users/${encodedId}/password`, body: { password } },
    { method: 'PATCH', endpoint: `/api/accounts/${encodedId}/password`, body: { password } },
    { method: 'PATCH', endpoint: `/api/utilisateurs/${encodedId}`, body: { password } },
    { method: 'PATCH', endpoint: `/api/users/${encodedId}`, body: { password } },
    { method: 'POST', endpoint: `/api/auth/reset-password`, body: { username: account.username, password, newPassword: password } },
    { method: 'POST', endpoint: `/api/auth/change-password`, body: { username: account.username, password } },
    { method: 'PATCH', endpoint: `/api/utilisateurs?username=${encodedUsername}`, body: { password } },
  ];

  for (const a of attempts) {
    const res = await apiRawFetch(a.endpoint, { method: a.method, body: a.body, authToken }).catch(() => null);
    if (res?.ok) return { ok: true };
  }

  return { ok: false, error: 'Modification du mot de passe non supportée par l\'API externe' };
}

// ─── Chrono des courses (en mémoire) ───
// Chrono = { startedAt, state: 'running'|'paused'|'stopped', elapsed: accumulé en ms, pausedAt, teamChronos }
// TeamChrono = { state: 'running'|'paused'|'stopped', elapsed: accumulé, pausedAt, checkpoints }

function getEffectiveRaceElapsed(chrono) {
  if (!chrono || !chrono.startedAt) return 0;
  if (chrono.state === 'stopped') return chrono.elapsed || 0;
  if (chrono.state === 'paused') return chrono.elapsed || 0;
  return (chrono.elapsed || 0) + (Date.now() - (chrono.resumedAt || chrono.startedAt));
}

function getEffectiveTeamElapsed(tc, chrono) {
  if (!tc) return 0;
  if (tc.state === 'stopped') return tc.elapsed || 0;
  if (tc.state === 'paused') return tc.elapsed || 0;
  // Si la course est en pause, l'équipe aussi
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
  // Pause toutes les équipes en cours
  for (const tc of Object.values(c.teamChronos)) {
    if (tc.state === 'running') {
      tc.elapsed = (tc.elapsed || 0) + (now - (tc.resumedAt || tc.startedAt || c.startedAt));
      tc.pausedAt = now;
      tc.state = 'paused';
    }
  }
  return c;
}

export function resumeRaceChrono(raceId) {
  const c = raceChronos[raceId];
  if (!c || c.state !== 'paused') return c || null;
  const now = Date.now();
  c.resumedAt = now;
  c.state = 'running';
  delete c.pausedAt;
  // Reprendre toutes les équipes en pause
  for (const tc of Object.values(c.teamChronos)) {
    if (tc.state === 'paused') {
      tc.resumedAt = now;
      tc.state = 'running';
      delete tc.pausedAt;
    }
  }
  return c;
}

export function stopRaceChrono(raceId) {
  const c = raceChronos[raceId];
  if (!c) return null;
  const now = Date.now();
  if (c.state === 'running') {
    c.elapsed = (c.elapsed || 0) + (now - (c.resumedAt || c.startedAt));
  }
  c.state = 'stopped';
  c.stoppedAt = now;
  // Stop toutes les équipes
  for (const tc of Object.values(c.teamChronos)) {
    if (tc.state === 'running') {
      tc.elapsed = (tc.elapsed || 0) + (now - (tc.resumedAt || tc.startedAt || c.startedAt));
    }
    tc.state = 'stopped';
    tc.stoppedAt = now;
  }
  return c;
}

// --- Pause/Resume/Stop par équipe ---

export function pauseTeamChrono(raceId, teamCode) {
  const c = raceChronos[raceId];
  if (!c) return null;
  const tc = c.teamChronos[teamCode];
  if (!tc || tc.state !== 'running') return tc || null;
  const now = Date.now();
  tc.elapsed = (tc.elapsed || 0) + (now - (tc.resumedAt || tc.startedAt || c.resumedAt || c.startedAt));
  tc.pausedAt = now;
  tc.state = 'paused';
  return tc;
}

export function resumeTeamChrono(raceId, teamCode) {
  const c = raceChronos[raceId];
  if (!c || c.state !== 'running') return null; // course doit tourner
  const tc = c.teamChronos[teamCode];
  if (!tc || tc.state !== 'paused') return tc || null;
  const now = Date.now();
  tc.resumedAt = now;
  tc.state = 'running';
  delete tc.pausedAt;
  return tc;
}

export function stopTeamChrono(raceId, teamCode) {
  const c = raceChronos[raceId];
  if (!c) return null;
  const tc = c.teamChronos[teamCode];
  if (!tc) return null;
  const now = Date.now();
  if (tc.state === 'running') {
    tc.elapsed = (tc.elapsed || 0) + (now - (tc.resumedAt || tc.startedAt || c.resumedAt || c.startedAt));
  }
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

function sameId(a, b) {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

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
    const headers = {};
    if (process.env.API_KEY) headers.Authorization = `ApiKey ${process.env.API_KEY}`;
    const res = await fetch(`${apiUrl}/api/courses`, { headers, signal: AbortSignal.timeout(5000) });
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

export function isApiAvailable() { return !!apiUrl && apiReady; }

export async function apiFetch(endpoint, options = {}, authToken = null) {
  if (!apiUrl) throw new Error('API non configurée (API_URL manquant)');
  if (!authToken && !process.env.API_KEY) throw new Error('Aucun moyen d\'authentification API disponible');

  const baseHeaders = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const attempts = [];
  if (baseHeaders.Authorization) {
    attempts.push(baseHeaders.Authorization);
  } else {
    if (authToken) attempts.push(`Bearer ${authToken}`);
    if (process.env.API_KEY) attempts.push(`ApiKey ${process.env.API_KEY}`);
  }

  let lastRes = null;
  for (const authorization of attempts) {
    const headers = { ...baseHeaders, Authorization: authorization };
    const res = await fetch(`${apiUrl}${endpoint}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
    if (res.ok) return res.json();
    lastRes = res;
    if (res.status === 401 || res.status === 403) continue;
    break;
  }

  throw new Error(`API ${lastRes?.status || 500}: ${lastRes?.statusText || 'Erreur'}`);
}

// ─── Courses ───

export async function getCoursesApi(authToken = null) {
  if (!isApiAvailable()) return [];
  const data = await apiFetch('/api/courses', {}, authToken);
  const courses = Array.isArray(data) ? data : (data.data || data.value || data.courses || []);
  if (!Array.isArray(courses)) return [];
  const result = [];

  // Charger toutes les équipes et balises en une fois
  let allEquipes = [];
  try {
    const eData = await apiFetch('/api/equipes', {}, authToken);
    allEquipes = Array.isArray(eData) ? eData : (eData.data || eData.value || []);
  } catch {}

  let allBalises = [];
  try {
    const bData = await apiFetch('/api/balises', {}, authToken);
    allBalises = Array.isArray(bData) ? bData : (bData.data || bData.value || []);
  } catch {}

  for (const course of courses) {
    // Récupérer les balises ordonnées pour cette course
    let ordreBalises = [];
    try {
      const obData = await apiFetch(`/api/ordre-balises/course/${course.id}`, {}, authToken);
      ordreBalises = Array.isArray(obData) ? obData : (obData.data || obData.value || []);
    } catch {}

    // Extraire les checkpoints depuis l'ordre des balises ou les balises globales
    const checkpoints = [];
    for (const ob of ordreBalises) {
      if (ob.balise && ob.balise.latitude != null) {
        checkpoints.push({ lat: Number(ob.balise.latitude), lng: Number(ob.balise.longitude) });
      } else if (ob.latitude != null) {
        checkpoints.push({ lat: Number(ob.latitude), lng: Number(ob.longitude) });
      } else {
        const bId = ob.id_balise || ob.balise_id;
        const found = allBalises.find(b => sameId(b.id, bId));
        if (found) checkpoints.push({ lat: Number(found.latitude), lng: Number(found.longitude) });
      }
    }

    // Équipes liées à cette course
    const equipes = allEquipes.filter(eq =>
      sameId(eq.id_course_actuelle, course.id) || sameId(eq.course_id, course.id) || sameId(eq.id_course, course.id)
    );

    const startLat = checkpoints[0]?.lat ?? 44.837789;
    const startLng = checkpoints[0]?.lng ?? -0.57918;

    result.push({
      id: course.id,
      name: course.nom_course || course.nom || course.name || `Course ${course.id}`,
      start: { lat: Number(startLat), lng: Number(startLng) },
      isActive: course.est_demarree === true && course.est_terminee === false,
      checkpoints,
      teams: equipes.map(eq => ({
        name: eq.nom_equipe || eq.nom || eq.name || `Équipe ${eq.id}`,
        code: eq.badge_tag || String(eq.id),
        order: checkpoints,
      })),
    });
  }
  return result;
}

// ─── Rejoindre par code ───

export async function getTeamByCodeApi(code, authToken = null) {
  if (!isApiAvailable()) return null;
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return null;
  const getEntityId = (obj) => obj?.id ?? obj?.id_course ?? obj?.course_id ?? obj?.idCourse ?? obj?.courseId ?? null;

  // Chercher le code dans /api/codes (champs: id_code, nomcode, valeur_code, id_course, id_equipe, nom_course, nom_equipe)
  let codeEntry = null;
  try {
    const codesData = await apiFetch('/api/codes', {}, authToken);
    const codes = Array.isArray(codesData) ? codesData : (codesData.data || codesData.value || []);
    // Si l'API renvoie un objet unique au lieu d'un tableau
    const codeList = Array.isArray(codes)
      ? codes
      : (codes && typeof codes === 'object')
        ? [codes]
        : [codesData].filter(Boolean);

    codeEntry = codeList.find(c => {
      const candidates = [
        c?.nomcode,
        c?.valeur_code,
        c?.code,
        c?.nom_code,
      ].map(v => String(v || '').trim().toUpperCase()).filter(Boolean);
      return candidates.includes(normalizedCode);
    });

    if (!codeEntry) {
      console.warn(`Code "${normalizedCode}" introuvable. Codes disponibles:`,
        codeList.map(c => c?.nomcode || c?.valeur_code || c?.code || '(vide)'));
      return null;
    }
    console.log(`Code trouvé: ${normalizedCode} → équipe "${codeEntry.nom_equipe}" (course: "${codeEntry.nom_course}")`);
  } catch (err) {
    console.warn(`Erreur lecture /api/codes: ${err.message}`);
    return null;
  }

  // On a directement id_course et id_equipe dans le code
  const courseId = codeEntry.id_course ?? codeEntry.course_id ?? codeEntry.idCourse ?? codeEntry.courseId;
  const equipeId = codeEntry.id_equipe ?? codeEntry.equipe_id ?? codeEntry.team_id ?? codeEntry.teamId;

  if (!courseId) {
    console.warn('Code trouvé mais pas de course associée');
    return null;
  }

  // Récupérer les détails de la course
  let course = null;
  try {
    const cData = await apiFetch('/api/courses', {}, authToken);
    const courses = Array.isArray(cData) ? cData : (cData.data || cData.value || []);
    const courseList = Array.isArray(courses)
      ? courses
      : (courses && typeof courses === 'object')
        ? [courses]
        : [cData].filter(Boolean);
    course = courseList.find(c => sameId(getEntityId(c), courseId));
  } catch {}
  if (!course) {
    // Fallback: certaines API exposent /api/courses/:id mais pas forcément la course dans /api/courses
    try {
      const cOne = await apiFetch(`/api/courses/${courseId}`, {}, authToken);
      course = cOne?.data && !Array.isArray(cOne.data) ? cOne.data : cOne;
    } catch {}
  }
  if (!course) {
    console.warn(`Course ${courseId} introuvable dans /api/courses, fallback sur les données du code`);
    course = { id: courseId, nom_course: codeEntry.nom_course || null };
  }

  // Récupérer les balises ordonnées + toutes les balises
  let checkpoints = [];
  try {
    const obData = await apiFetch(`/api/ordre-balises/course/${course.id}`, {}, authToken);
    const ordreBalises = Array.isArray(obData) ? obData : (obData.data || obData.value || []);
    const obList = Array.isArray(ordreBalises) ? ordreBalises : [];

    let allBalises = [];
    try {
      const bData = await apiFetch('/api/balises', {}, authToken);
      allBalises = Array.isArray(bData) ? bData : (bData.data || bData.value || []);
      if (!Array.isArray(allBalises)) allBalises = [];
    } catch {}

    for (const ob of obList) {
      if (ob.balise && ob.balise.latitude != null) {
        checkpoints.push({ lat: Number(ob.balise.latitude), lng: Number(ob.balise.longitude) });
      } else if (ob.latitude != null) {
        checkpoints.push({ lat: Number(ob.latitude), lng: Number(ob.longitude) });
      } else {
        const bId = ob.id_balise || ob.balise_id;
        const found = allBalises.find(b => sameId(b.id, bId));
        if (found) checkpoints.push({ lat: Number(found.latitude), lng: Number(found.longitude) });
      }
    }
  } catch {}

  const startLat = checkpoints[0]?.lat ?? 44.837789;
  const startLng = checkpoints[0]?.lng ?? -0.57918;

  return {
    team: {
      name: codeEntry.nom_equipe || `Équipe ${equipeId}`,
      code: normalizedCode,
    },
    course: {
      id: getEntityId(course) ?? courseId,
      name: codeEntry.nom_course || course.nom_course || course.nom || course.name || `Course ${getEntityId(course) ?? courseId}`,
      start: { lat: Number(startLat), lng: Number(startLng) },
      checkpoints,
    },
  };
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
    return { ok: true, permissions: data.permissions || { admin: true }, account, token: token || null };
  } catch (err) {
    console.warn(`Échec login admin: ${err.message}`);
    return { ok: false, error: 'Erreur de connexion à l\'API' };
  }
}

export async function loginViaToken(token, requiredRole = 'any') {
  if (!isApiAvailable()) {
    return { ok: false, error: 'API externe non configurée (API_URL manquant)' };
  }

  const jwt = String(token || '').trim();
  if (!jwt) return { ok: false, error: 'Token JWT requis' };

  const decodeJwtPayload = (rawToken) => {
    try {
      const parts = String(rawToken || '').split('.');
      if (parts.length < 2) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const json = Buffer.from(padded, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  };

  const tokenPayload = decodeJwtPayload(jwt);

  const pickAccountInPayload = (payload) => {
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

    return Array.isArray(list) && list.length > 0 ? list[0] : null;
  };

  const fetchAccountFromApi = async () => {
    const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };
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
        const res = await fetch(`${apiUrl}${endpoint}`, {
          method: 'GET',
          headers: authHeaders,
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        const account = pickAccountInPayload(data);
        if (account) return { account, data };
      } catch {
        // endpoint suivant
      }
    }

    return { account: null, data: null };
  };

  try {
    const { account: accountFromApi, data: meData } = await fetchAccountFromApi();
    const account = accountFromApi || { username: tokenPayload?.username || tokenPayload?.sub || 'Utilisateur' };

    const roleValues = [];
    collectRoleValues(meData?.role, roleValues);
    collectRoleValues(meData?.roles, roleValues);
    collectRoleValues(meData?.user?.role, roleValues);
    collectRoleValues(meData?.user?.roles, roleValues);
    collectRoleValues(meData?.account?.role, roleValues);
    collectRoleValues(meData?.account?.roles, roleValues);
    collectRoleValues(account?.role, roleValues);
    collectRoleValues(account?.roles, roleValues);
    collectRoleValues(account?.profil, roleValues);
    collectRoleValues(account?.type, roleValues);
    collectRoleValues(tokenPayload?.role, roleValues);
    collectRoleValues(tokenPayload?.roles, roleValues);
    collectRoleValues(tokenPayload?.authorities, roleValues);
    collectRoleValues(tokenPayload?.scope, roleValues);

    const adminRoleSet = new Set(['admin', 'administrateur', 'role_admin', 'superadmin', 'super_admin']);
    const orgaRoleSet = new Set(['organisateur', 'orga', 'organizer', 'role_organisateur', 'role_orga']);
    const isAdmin = roleValues.some(r => adminRoleSet.has(r));
    const isOrga = roleValues.some(r => orgaRoleSet.has(r));

    if (requiredRole === 'admin' && !isAdmin) {
      return { ok: false, error: 'Compte non autorisé pour l\'espace admin' };
    }
    if (requiredRole === 'orga' && !isOrga) {
      return { ok: false, error: 'Compte non autorisé pour l\'espace organisateur' };
    }

    if (isAdmin) adminAuthToken = jwt;

    const role = isAdmin ? 'admin' : (isOrga ? 'orga' : 'user');
    return {
      ok: true,
      role,
      account,
      permissions: meData?.permissions || (isAdmin ? { admin: true } : null),
      token: jwt,
    };
  } catch (err) {
    return { ok: false, error: err?.message || 'Token JWT invalide' };
  }
}
