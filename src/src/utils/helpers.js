export const DEFAULT_START = { lat: 44.837789, lng: -0.57918 };

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const sanitizeText = (value, maxLength = 40) =>
  String(value || '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);

export const normalizeCode = (value) => sanitizeText(value, 12).replace(/[^A-Z0-9]/gi, '').toUpperCase();
