// ─── Stockage en mémoire (logs, pings, events) ───────────────
// Pas de BDD locale — tout passe par l'API externe pour les courses.
// Les logs / pings / events sont éphémères et stockés en RAM.

const MAX_PINGS = 5000;
const MAX_LOGS = 1000;
const MAX_EVENTS = 500;

let pings = [];
let logs = [];
let events = [];
let idCounter = 1;

function nextId() { return idCounter++; }

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

export async function initApi() {
  const url = (process.env.API_URL || '').trim();
  if (!url) {
    console.log('API_URL non défini — lecture API externe désactivée');
    return;
  }
  apiUrl = url.replace(/\/+$/, '');
  // Vérifier la connexion avec la clé API
  try {
    const res = await fetch(`${apiUrl}/api/courses`, {
      headers: { 'Authorization': `ApiKey ${process.env.API_KEY || ''}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      console.log(`API externe configurée → ${apiUrl} ✅ (clé API valide)`);
    } else {
      console.warn(`API externe configurée → ${apiUrl} ⚠️ (réponse ${res.status})`);
    }
  } catch (err) {
    console.warn(`API externe configurée → ${apiUrl} ⚠️ (${err.message})`);
  }
}

export function isApiAvailable() { return !!apiUrl && !!process.env.API_KEY; }

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

// ─── Courses ───

export async function getCoursesApi() {
  if (!isApiAvailable()) return [];
  const data = await apiFetch('/api/courses');
  const courses = Array.isArray(data) ? data : (data.data || data.value || data.courses || []);
  if (!Array.isArray(courses)) return [];
  const result = [];

  // Charger toutes les équipes et balises en une fois
  let allEquipes = [];
  try {
    const eData = await apiFetch('/api/equipes');
    allEquipes = Array.isArray(eData) ? eData : (eData.data || eData.value || []);
  } catch {}

  let allBalises = [];
  try {
    const bData = await apiFetch('/api/balises');
    allBalises = Array.isArray(bData) ? bData : (bData.data || bData.value || []);
  } catch {}

  for (const course of courses) {
    // Récupérer les balises ordonnées pour cette course
    let ordreBalises = [];
    try {
      const obData = await apiFetch(`/api/ordre-balises/course/${course.id}`);
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
        const found = allBalises.find(b => b.id === bId);
        if (found) checkpoints.push({ lat: Number(found.latitude), lng: Number(found.longitude) });
      }
    }

    // Équipes liées à cette course
    const equipes = allEquipes.filter(eq =>
      eq.id_course_actuelle === course.id || eq.course_id === course.id || eq.id_course === course.id
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

export async function getTeamByCodeApi(code) {
  if (!isApiAvailable()) return null;
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return null;

  // Chercher le code dans /api/codes (champs: id_code, nomcode, valeur_code, id_course, id_equipe, nom_course, nom_equipe)
  let codeEntry = null;
  try {
    const codesData = await apiFetch('/api/codes');
    const codes = Array.isArray(codesData) ? codesData : (codesData.data || codesData.value || []);
    // Si l'API renvoie un objet unique au lieu d'un tableau
    const codeList = Array.isArray(codes) ? codes : [codesData];

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
  const courseId = codeEntry.id_course;
  const equipeId = codeEntry.id_equipe;

  if (!courseId) {
    console.warn('Code trouvé mais pas de course associée');
    return null;
  }

  // Récupérer les détails de la course
  let course = null;
  try {
    const cData = await apiFetch('/api/courses');
    const courses = Array.isArray(cData) ? cData : (cData.data || cData.value || []);
    const courseList = Array.isArray(courses) ? courses : [cData];
    course = courseList.find(c => c.id === courseId);
  } catch {}
  if (!course) {
    console.warn(`Course ${courseId} introuvable`);
    return null;
  }

  // Récupérer les balises ordonnées + toutes les balises
  let checkpoints = [];
  try {
    const obData = await apiFetch(`/api/ordre-balises/course/${course.id}`);
    const ordreBalises = Array.isArray(obData) ? obData : (obData.data || obData.value || []);
    const obList = Array.isArray(ordreBalises) ? ordreBalises : [];

    let allBalises = [];
    try {
      const bData = await apiFetch('/api/balises');
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
        const found = allBalises.find(b => b.id === bId);
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
      id: course.id,
      name: codeEntry.nom_course || course.nom_course || course.nom || `Course ${course.id}`,
      start: { lat: Number(startLat), lng: Number(startLng) },
      checkpoints,
    },
  };
}

// ─── Login admin via l'API externe ───

export async function loginViaApi(username, password) {
  if (!apiUrl) return { ok: false, error: 'API externe non configurée (API_URL manquant)' };
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
    console.log(`Admin connecté via API → ${username} ✅`);
    return { ok: true, permissions: data.permissions || data.role || { admin: true } };
  } catch (err) {
    console.warn(`Échec login admin: ${err.message}`);
    return { ok: false, error: 'Erreur de connexion à l\'API' };
  }
}
