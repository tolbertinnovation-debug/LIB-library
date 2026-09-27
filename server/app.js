import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESSION_COOKIE, hashToken, parseCookies } from './lib/auth.js';
import { sweep } from './lib/circulation.js';
import { HttpError } from './lib/util.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import meRoutes from './routes/me.js';
import readerRoutes from './routes/reader.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Build the Express app.
 * @param {object} opts
 * @param {import('node:sqlite').DatabaseSync} opts.db
 * @param {() => number} [opts.now]   clock, overridable in tests
 * @param {typeof fetch} [opts.fetchImpl]  used for Project Gutenberg
 * @param {boolean} [opts.serveClient]  serve the built SPA from dist/
 * @param {boolean} [opts.secureCookies]
 */
export function createApp({ db, now = () => Date.now(), fetchImpl = fetch, serveClient = false, secureCookies = false, adminEmails = [] }) {
  const app = express();
  const ctx = { db, now, fetchImpl, secureCookies, adminEmails: adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean) };

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data: https://covers.openlibrary.org https://www.gutenberg.org",
        "connect-src 'self' https://openlibrary.org",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "font-src 'self' data:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
    next();
  });

  app.use('/api', express.json({ limit: '4mb' }));

  // Cross-site request protection: state-changing API calls must be JSON,
  // which a plain HTML form on another site cannot send without CORS.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Requests must be sent as application/json.' });
    }
    next();
  });

  // Session → req.user
  app.use('/api', (req, res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const row = db
        .prepare(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?`,
        )
        .get(hashToken(token), new Date(now()).toISOString());
      if (row) req.user = row;
    }
    next();
  });

  // Keep the holds queue moving: hand out returned copies, expire stale holds.
  let lastSweep = 0;
  app.use('/api', (req, res, next) => {
    const t = now();
    if (t - lastSweep > 60_000) {
      lastSweep = t;
      sweep(db, t);
    }
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api', catalogRoutes(ctx));
  app.use('/api', readerRoutes(ctx));
  app.use('/api', meRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  if (serveClient) {
    const dist = path.join(ROOT, 'dist');
    const index = path.join(dist, 'index.html');
    if (fs.existsSync(index)) {
      app.use(
        express.static(dist, {
          index: false,
          setHeaders(res, file) {
            if (file.includes(`${path.sep}assets${path.sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
          },
        }),
      );
      app.get(/.*/, (req, res) => res.sendFile(index));
    }
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
