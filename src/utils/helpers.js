export const DEFAULT_START = { lat: 44.837789, lng: -0.57918 };

export const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

export const shuffleArray = (array) => [...array].sort(() => Math.random() - 0.5);

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const createSeries = (count, min, max) =>
  Array.from({ length: count }, () => Number((min + Math.random() * (max - min)).toFixed(2)));

export const pushSeries = (series, value, maxPoints = 24) => {
  const next = [...series, value];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
};

export const sanitizeText = (value, maxLength = 40) =>
  String(value || '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);

export const normalizeCode = (value) => sanitizeText(value, 12).replace(/[^A-Z0-9]/gi, '').toUpperCase();

export const hashPassword = async (value) => {
  const data = new TextEncoder().encode(String(value || ''));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};
