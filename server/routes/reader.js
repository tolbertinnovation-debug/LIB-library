import { Router } from 'express';
import { tx } from '../db.js';
import { fetchGutenbergSections } from '../lib/gutenberg.js';
import { requireUser } from '../lib/guards.js';
import { HttpError, clampInt, dayKey, iso, str } from '../lib/util.js';
import { storeSections } from '../seed/seed.js';
import { findBook } from './catalog.js';

// Fetches from Project Gutenberg that are already under way, keyed by book id,
// so a burst of readers opening the same new title triggers one download.
const inFlight = new Map();
// After a failed download, wait a minute before trying Project Gutenberg again
// so an outage doesn't make every page view wait on slow timeouts.
const recentFailures = new Map();
const RETRY_AFTER_MS = 60_000;

async function ensureText(db, row, fetchImpl) {
  if (row.has_text) return;
  if (!row.gutenberg_id) {
    throw new HttpError(404, 'This title is in our print collection only — borrow a copy to read it.');
  }
  const failed = recentFailures.get(row.id);
  if (failed && Date.now() - failed.at < RETRY_AFTER_MS) throw failed.error;
  if (!inFlight.has(row.id)) {
    const job = fetchGutenbergSections(row.gutenberg_id, { fetchImpl })
      .then((sections) => {
        if (!sections.length) throw new HttpError(502, 'That text came back empty from Project Gutenberg.');
        tx(db, () => storeSections(db, row.id, sections));
        recentFailures.delete(row.id);
      })
      .catch((error) => {
        recentFailures.set(row.id, { at: Date.now(), error });
        throw error;
      })
      .finally(() => inFlight.delete(row.id));
    inFlight.set(row.id, job);
  }
  await inFlight.get(row.id);
}

export default function readerRoutes({ db, now, fetchImpl }) {
  const r = Router();

  r.get('/books/:slug/toc', async (req, res) => {
    const row = findBook(db, req.params.slug);
    await ensureText(db, row, fetchImpl);
    const sections = db
      .prepare('SELECT idx, title, words FROM sections WHERE book_id = ? ORDER BY idx')
      .all(row.id);
    const total = sections.reduce((a, s) => a + s.words, 0);
    res.json({ sections, totalWords: total });
  });

  r.get('/books/:slug/sections/:idx', async (req, res) => {
    const row = findBook(db, req.params.slug);
    await ensureText(db, row, fetchImpl);
    const idx = clampInt(req.params.idx, 0, 100_000, 0);
    const section = db.prepare('SELECT idx, title, body, words FROM sections WHERE book_id = ? AND idx = ?').get(row.id, idx);
    if (!section) throw new HttpError(404, 'That part of the book doesn’t exist.');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM sections WHERE book_id = ?').get(row.id);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.json({ ...section, count: n });
  });

  // Find a phrase inside the book.
  r.get('/books/:slug/find', async (req, res) => {
    const row = findBook(db, req.params.slug);
    await ensureText(db, row, fetchImpl);
    const q = str(req.query.q, { max: 100, name: 'Search' });
    if (q.length < 2) return res.json({ results: [], total: 0 });
    // Words may be split across line breaks in the text, so match any whitespace.
    const pattern = new RegExp(
      q
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+'),
      'gi',
    );
    const results = [];
    let total = 0;
    const sections = db.prepare('SELECT idx, title, body FROM sections WHERE book_id = ? ORDER BY idx').all(row.id);
    for (const s of sections) {
      for (const m of s.body.matchAll(pattern)) {
        total++;
        if (results.length >= 100) continue;
        const at = m.index;
        const end = at + m[0].length;
        const from = Math.max(0, at - 70);
        const to = Math.min(s.body.length, end + 70);
        results.push({
          idx: s.idx,
          title: s.title,
          position: at / Math.max(1, s.body.length),
          before: (from > 0 ? '…' : '') + s.body.slice(from, at).replace(/\s+/g, ' '),
          match: m[0].replace(/\s+/g, ' '),
          after: s.body.slice(end, to).replace(/\s+/g, ' ') + (to < s.body.length ? '…' : ''),
        });
      }
    }
    res.json({ results, total });
  });

  // Save where the reader is, and how long they have been reading.
  r.put('/books/:slug/progress', (req, res) => {
    const user = requireUser(req);
    const row = findBook(db, req.params.slug);
    const sectionIdx = clampInt(req.body?.sectionIdx, 0, 100_000, 0);
    const position = Math.min(1, Math.max(0, Number(req.body?.position) || 0));
    const percent = Math.min(100, Math.max(0, Number(req.body?.percent) || 0));
    // Minutes since the last save; capped so an idle open tab can't inflate stats.
    const minutes = Math.min(5, Math.max(0, Number(req.body?.minutes) || 0));
    const t = now();
    tx(db, () => {
      db.prepare(
        `INSERT INTO progress (user_id, book_id, section_idx, position, percent, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, book_id) DO UPDATE SET section_idx = excluded.section_idx,
           position = excluded.position, percent = excluded.percent, updated_at = excluded.updated_at`,
      ).run(user.id, row.id, sectionIdx, position, percent, iso(t));
      if (minutes > 0) {
        db.prepare(
          `INSERT INTO reading_days (user_id, day, minutes) VALUES (?, ?, ?)
           ON CONFLICT (user_id, day) DO UPDATE SET minutes = minutes + excluded.minutes`,
        ).run(user.id, dayKey(t), minutes);
      }
      // Opening a book moves it to "Currently reading" (unless already finished).
      const shelf = db.prepare('SELECT status FROM shelves WHERE user_id = ? AND book_id = ?').get(user.id, row.id);
      if (!shelf) {
        db.prepare(
          `INSERT INTO shelves (user_id, book_id, status, favorite, updated_at) VALUES (?, ?, 'reading', 0, ?)`,
        ).run(user.id, row.id, iso(t));
      } else if (shelf.status === 'want' || shelf.status === null) {
        db.prepare(`UPDATE shelves SET status = 'reading', updated_at = ? WHERE user_id = ? AND book_id = ?`).run(
          iso(t),
          user.id,
          row.id,
        );
      }
    });
    res.json({ ok: true });
  });

  // ── Bookmarks & notes ─────────────────────────────────────────────────────
  r.get('/books/:slug/bookmarks', (req, res) => {
    const user = requireUser(req);
    const row = findBook(db, req.params.slug);
    const bookmarks = db
      .prepare(
        `SELECT bm.*, s.title AS section_title FROM bookmarks bm
         LEFT JOIN sections s ON s.book_id = bm.book_id AND s.idx = bm.section_idx
         WHERE bm.user_id = ? AND bm.book_id = ? ORDER BY bm.section_idx, bm.position`,
      )
      .all(user.id, row.id)
      .map(serializeBookmark);
    res.json({ bookmarks });
  });

  r.post('/books/:slug/bookmarks', (req, res) => {
    const user = requireUser(req);
    const row = findBook(db, req.params.slug);
    const sectionIdx = clampInt(req.body?.sectionIdx, 0, 100_000, 0);
    const position = Math.min(1, Math.max(0, Number(req.body?.position) || 0));
    const excerpt = str(req.body?.excerpt, { max: 600, name: 'Excerpt' });
    const note = str(req.body?.note, { max: 2000, name: 'Note' });
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM bookmarks WHERE user_id = ?').get(user.id);
    if (n >= 5000) throw new HttpError(409, 'You’ve reached the bookmark limit. Remove a few to add more.');
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO bookmarks (user_id, book_id, section_idx, position, excerpt, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(user.id, row.id, sectionIdx, position, excerpt, note, iso(now()));
    const bm = db
      .prepare(
        `SELECT bm.*, s.title AS section_title FROM bookmarks bm
         LEFT JOIN sections s ON s.book_id = bm.book_id AND s.idx = bm.section_idx WHERE bm.id = ?`,
      )
      .get(lastInsertRowid);
    res.status(201).json({ bookmark: serializeBookmark(bm) });
  });

  r.patch('/bookmarks/:id', (req, res) => {
    const user = requireUser(req);
    const note = str(req.body?.note, { max: 2000, name: 'Note' });
    const { changes } = db
      .prepare('UPDATE bookmarks SET note = ? WHERE id = ? AND user_id = ?')
      .run(note, clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0), user.id);
    if (!changes) throw new HttpError(404, 'Bookmark not found');
    res.json({ ok: true });
  });

  r.delete('/bookmarks/:id', (req, res) => {
    const user = requireUser(req);
    const { changes } = db
      .prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?')
      .run(clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0), user.id);
    if (!changes) throw new HttpError(404, 'Bookmark not found');
    res.json({ ok: true });
  });

  return r;
}

export function serializeBookmark(bm) {
  return {
    id: bm.id,
    bookId: bm.book_id,
    sectionIdx: bm.section_idx,
    sectionTitle: bm.section_title ?? null,
    position: bm.position,
    excerpt: bm.excerpt,
    note: bm.note,
    createdAt: bm.created_at,
  };
}
