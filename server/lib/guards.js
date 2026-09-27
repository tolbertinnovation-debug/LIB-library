import { HttpError } from './util.js';

export function requireUser(req) {
  if (!req.user) throw new HttpError(401, 'Please sign in with your library card first.');
  return req.user;
}

export function requireLibrarian(req) {
  const user = requireUser(req);
  if (user.role !== 'librarian') throw new HttpError(403, 'Only librarians can do that.');
  return user;
}

/** Tiny fixed-window rate limiter kept in memory. */
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
      }
      return true;
    }
    entry.count++;
    return entry.count <= max;
  };
}
