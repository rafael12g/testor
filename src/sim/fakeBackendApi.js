const BASE_URL = '/api';

export async function sendBeaconPing(payload) {
  const response = await fetch(`${BASE_URL}/beacons/ping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Impossible d’enregistrer le ping balise');
  }

  return response.json();
}

export async function fetchBeaconSnapshot(raceId) {
  const response = await fetch(`${BASE_URL}/races/${raceId}/beacons`);
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchRecentBeaconEvents(limit = 12) {
  const response = await fetch(`${BASE_URL}/beacons/events?limit=${limit}`);
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchServerLogs(limit = 60) {
  const response = await fetch(`${BASE_URL}/logs?limit=${limit}`);
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function sendRaceEvent(raceId, eventType, payload = null) {
  const response = await fetch(`${BASE_URL}/races/${raceId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType, payload }),
  });
  if (!response.ok) return null;
  return response.json();
}

export async function fetchRaceHistory(raceId, limit = 40) {
  const url = raceId
    ? `${BASE_URL}/races/${raceId}/history?limit=${limit}`
    : `${BASE_URL}/history?limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.items) ? data.items : [];
}

export async function pingBackendHealth() {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) throw new Error('Backend indisponible');
  return response.json();
}
