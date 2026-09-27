export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const DAY = 24 * 60 * 60 * 1000;

export function slugify(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function iso(date) {
  return new Date(date).toISOString();
}

/** Local calendar day (UTC) as YYYY-MM-DD. */
export function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function str(value, { max = 500, required = false, name = 'value' } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw new HttpError(400, `${name} is required`);
  if (s.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
  return s;
}
