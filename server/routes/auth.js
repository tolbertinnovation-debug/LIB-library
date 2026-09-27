import { Router } from 'express';
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  hashPassword,
  hashToken,
  newCardNumber,
  newToken,
  parseCookies,
  sessionCookie,
  verifyPassword,
} from '../lib/auth.js';
import { serializeUser } from '../lib/books.js';
import { rateLimiter } from '../lib/guards.js';
import { DAY, HttpError, iso, str } from '../lib/util.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Passwords need at least 8 characters.');
  }
  if (password.length > 200) throw new HttpError(400, 'That password is too long.');
  return password;
}

export default function authRoutes({ db, now, secureCookies, adminEmails = [] }) {
  const r = Router();
  const loginLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

  function startSession(res, userId) {
    const token = newToken();
    const t = now();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      hashToken(token),
      userId,
      iso(t),
      iso(t + SESSION_DAYS * DAY),
    );
    // Opportunistically clean up expired sessions.
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso(t));
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: secureCookies, maxAgeSeconds: SESSION_DAYS * 86400 }));
  }

  r.get('/me', (req, res) => {
    res.json({ user: serializeUser(req.user) });
  });

  r.post('/register', (req, res) => {
    const name = str(req.body?.name, { required: true, max: 80, name: 'Name' });
    const email = str(req.body?.email, { required: true, max: 200, name: 'Email' }).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
    const password = validatePassword(req.body?.password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'An account with that email already exists. Try signing in.');
    }
    let card;
    do card = newCardNumber();
    while (db.prepare('SELECT 1 FROM users WHERE card_number = ?').get(card));
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO users (email, name, password_hash, role, card_number, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(email, name, hashPassword(password), adminEmails.includes(email) ? 'librarian' : 'member', card, iso(now()));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    startSession(res, user.id);
    res.status(201).json({ user: serializeUser(user) });
  });

  r.post('/login', (req, res) => {
    const email = str(req.body?.email, { required: true, max: 200, name: 'Email' }).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!loginLimiter(`${req.ip}|${email}`, now())) {
      throw new HttpError(429, 'Too many sign-in attempts. Please wait a few minutes and try again.');
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'That email and password don’t match our records.');
    }
    startSession(res, user.id);
    res.json({ user: serializeUser(user) });
  });

  r.post('/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    res.setHeader('Set-Cookie', sessionCookie('', { secure: secureCookies, maxAgeSeconds: 0 }));
    res.json({ ok: true });
  });

  return r;
}
