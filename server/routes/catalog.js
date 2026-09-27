import { Router } from 'express';
import { BOOK_COLUMNS, ftsQuery, getBookRow, listBooks, serializeBook } from '../lib/books.js';
import { bookStatusFor, borrow, placeHold } from '../lib/circulation.js';
import { getGutenbergBook, searchGutenberg } from '../lib/gutenberg.js';
import { requireUser } from '../lib/guards.js';
import { HttpError, clampInt, dayKey, iso, str } from '../lib/util.js';
import { insertBook } from '../seed/seed.js';

// Subjects too broad to say two books are alike.
const GENERIC_SUBJECTS = new Set(['Fiction', 'Classics', 'Nonfiction']);

const SORTS = {
  title: 'b.title COLLATE NOCASE',
  author: 'b.author COLLATE NOCASE, b.title COLLATE NOCASE',
  oldest: 'b.year IS NULL, b.year, b.title COLLATE NOCASE',
  newest: 'b.year IS NULL, b.year DESC, b.title COLLATE NOCASE',
  added: 'b.created_at DESC, b.id DESC',
  popular: 'times_borrowed DESC, rating_count DESC, b.title COLLATE NOCASE',
  rating: 'rating IS NULL, rating DESC, rating_count DESC, b.title COLLATE NOCASE',
};

export function findBook(db, slug) {
  const row = getBookRow(db, String(slug));
  if (!row) throw new HttpError(404, 'We couldn’t find that book in the catalog.');
  return row;
}

function reviewerName(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)[0]}.` : parts[0];
}

export default function catalogRoutes({ db, now, fetchImpl }) {
  const r = Router();

  // ── Home ────────────────────────────────────────────────────────────────
  r.get('/home', (req, res) => {
    const featured = listBooks(db, 'b.featured = 1', [], { order: 'b.id', limit: 12 });
    const collections = db
      .prepare('SELECT * FROM collections ORDER BY position')
      .all()
      .map((c) => ({
        slug: c.slug,
        title: c.title,
        description: c.description,
        books: listBooks(
          db,
          'b.id IN (SELECT book_id FROM collection_books WHERE collection_id = ?)',
          [c.id],
          { order: '(SELECT position FROM collection_books WHERE collection_id = ' + Number(c.id) + ' AND book_id = b.id)', limit: 14 },
        ),
      }));
    const popular = listBooks(db, '1', [], { order: SORTS.popular, limit: 12 });
    const added = listBooks(db, '1', [], { order: SORTS.added, limit: 12 });

    // Book of the day: rotate through the titles that open in the reader.
    const readable = db.prepare('SELECT id FROM books WHERE has_text = 1 ORDER BY id').all();
    let bookOfTheDay = null;
    if (readable.length) {
      const dayNumber = Math.floor(Date.parse(dayKey(now())) / 86400000);
      const pick = readable[dayNumber % readable.length].id;
      const first = db
        .prepare(`SELECT body FROM sections WHERE book_id = ? AND length(body) > 800 ORDER BY idx LIMIT 1`)
        .get(pick);
      const excerpt = first
        ? first.body
            .split(/\n\s*\n/)
            .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
            .filter((p) => p.length > 80)
            .slice(0, 1)
            .join('')
            .slice(0, 700)
        : '';
      bookOfTheDay = { book: serializeBook(getBookRow(db, pick)), excerpt };
    }

    const stats = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM books) AS books,
                (SELECT COUNT(*) FROM books WHERE has_text = 1 OR gutenberg_id IS NOT NULL) AS readable,
                (SELECT COALESCE(SUM(copies), 0) FROM books) AS copies,
                (SELECT COALESCE(SUM(word_count), 0) FROM books) AS words,
                (SELECT COUNT(*) FROM users) AS members,
                (SELECT COUNT(*) FROM loans) AS loans`,
      )
      .get();

    let continueReading = [];
    if (req.user) {
      continueReading = db
        .prepare(
          `SELECT ${BOOK_COLUMNS}, p.percent AS p_percent, p.section_idx AS p_section
           FROM progress p JOIN books b ON b.id = p.book_id
           WHERE p.user_id = ? AND p.percent < 99.5
           ORDER BY p.updated_at DESC LIMIT 6`,
        )
        .all(req.user.id)
        .map((row) => ({ ...serializeBook(row), progress: { percent: row.p_percent, sectionIdx: row.p_section } }));
    }

    res.json({ featured, collections, popular, added, bookOfTheDay, stats, continueReading });
  });

  // ── Browse & search ───────────────────────────────────────────────────────
  r.get('/books', (req, res) => {
    const where = [];
    const params = [];
    let order = SORTS[req.query.sort] || null;

    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    if (q.trim()) {
      const match = ftsQuery(q);
      if (!match) return res.json({ total: 0, page: 1, pages: 0, books: [] });
      const ranked = db
        .prepare(
          `SELECT rowid AS id FROM books_fts WHERE books_fts MATCH ?
           ORDER BY bm25(books_fts, 10.0, 8.0, 1.0, 3.0) LIMIT 1000`,
        )
        .all(match)
        .map((x) => x.id);
      const json = JSON.stringify(ranked);
      where.push('b.id IN (SELECT value FROM json_each(?))');
      params.push(json);
      if (!order) {
        order = `(SELECT key FROM json_each('${json.replace(/'/g, "''")}') WHERE value = b.id)`;
      }
    }
    if (typeof req.query.subject === 'string' && req.query.subject) {
      where.push(`EXISTS (SELECT 1 FROM json_each(b.subjects) s WHERE s.value = ? COLLATE NOCASE)`);
      params.push(req.query.subject);
    }
    if (typeof req.query.author === 'string' && req.query.author) {
      where.push('b.author = ? COLLATE NOCASE');
      params.push(req.query.author);
    }
    if (req.query.available === '1') {
      where.push(
        `b.copies > (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL)
                  + (SELECT COUNT(*) FROM holds h WHERE h.book_id = b.id AND h.status = 'ready')`,
      );
    }
    if (req.query.readable === '1') where.push('(b.has_text = 1 OR b.gutenberg_id IS NOT NULL)');
    if (req.query.era) {
      const eras = { ancient: [-5000, 1499], early: [1500, 1799], c19: [1800, 1899], c20: [1900, 1999], c21: [2000, 3000] };
      const range = eras[req.query.era];
      if (range) {
        where.push('b.year BETWEEN ? AND ?');
        params.push(...range);
      }
    }

    const whereSql = where.length ? where.join(' AND ') : '1';
    const limit = clampInt(req.query.limit, 1, 60, 24);
    const page = clampInt(req.query.page, 1, 10_000, 1);
    const { total } = db.prepare(`SELECT COUNT(*) AS total FROM books b WHERE ${whereSql}`).get(...params);
    const books = listBooks(db, whereSql, params, {
      order: order || SORTS.title,
      limit,
      offset: (page - 1) * limit,
    });
    res.json({ total, page, pages: Math.ceil(total / limit), books });
  });

  r.get('/subjects', (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.value AS name, COUNT(*) AS count FROM books b, json_each(b.subjects) s
         GROUP BY s.value ORDER BY count DESC, name LIMIT 60`,
      )
      .all();
    res.json({ subjects: rows });
  });

  r.get('/authors', (req, res) => {
    const rows = db
      .prepare(
        `SELECT author AS name, COUNT(*) AS count, MIN(year) AS first_year FROM books
         GROUP BY author ORDER BY author COLLATE NOCASE`,
      )
      .all();
    res.json({ authors: rows.map((a) => ({ name: a.name, count: a.count, firstYear: a.first_year })) });
  });

  r.get('/collections/:slug', (req, res) => {
    const c = db.prepare('SELECT * FROM collections WHERE slug = ?').get(req.params.slug);
    if (!c) throw new HttpError(404, 'Collection not found');
    const books = listBooks(db, 'b.id IN (SELECT book_id FROM collection_books WHERE collection_id = ?)', [c.id], {
      order: 'b.title COLLATE NOCASE',
      limit: 500,
    });
    res.json({ collection: { slug: c.slug, title: c.title, description: c.description }, books });
  });

  // ── A single book ─────────────────────────────────────────────────────────
  r.get('/books/:slug', (req, res) => {
    const row = findBook(db, req.params.slug);
    const book = serializeBook(row);
    const userId = req.user?.id;

    const reviews = db
      .prepare(
        `SELECT r.id, r.rating, r.body, r.created_at, r.updated_at, r.user_id, u.name
         FROM reviews r JOIN users u ON u.id = r.user_id
         WHERE r.book_id = ? ORDER BY (r.user_id = ?) DESC, r.updated_at DESC LIMIT 100`,
      )
      .all(row.id, userId ?? -1)
      .map((x) => ({
        id: x.id,
        rating: x.rating,
        body: x.body,
        createdAt: x.created_at,
        updatedAt: x.updated_at,
        reviewer: reviewerName(x.name),
        mine: x.user_id === userId,
      }));
    const distribution = [1, 2, 3, 4, 5].map(
      (n) => db.prepare('SELECT COUNT(*) AS c FROM reviews WHERE book_id = ? AND rating = ?').get(row.id, n).c,
    );

    const toc = db
      .prepare('SELECT idx, title, words FROM sections WHERE book_id = ? ORDER BY idx')
      .all(row.id);

    const subjects = book.subjects.filter((s) => !GENERIC_SUBJECTS.has(s));
    const similar = db
      .prepare(
        `SELECT ${BOOK_COLUMNS},
           (SELECT COUNT(*) FROM json_each(b.subjects) t WHERE t.value IN (SELECT value FROM json_each(?)))
             + (b.author = ?) * 2 AS score
         FROM books b WHERE b.id != ? AND score > 0
         ORDER BY score DESC, rating_count DESC, b.id LIMIT 8`,
      )
      .all(JSON.stringify(subjects), row.author, row.id)
      .map(serializeBook);

    const collections = db
      .prepare(
        `SELECT c.slug, c.title FROM collections c JOIN collection_books cb ON cb.collection_id = c.id
         WHERE cb.book_id = ? ORDER BY c.position`,
      )
      .all(row.id);

    let shelf = null;
    let progress = null;
    if (userId) {
      const s = db.prepare('SELECT * FROM shelves WHERE user_id = ? AND book_id = ?').get(userId, row.id);
      if (s) shelf = { status: s.status, favorite: Boolean(s.favorite), finishedAt: s.finished_at };
      const p = db.prepare('SELECT * FROM progress WHERE user_id = ? AND book_id = ?').get(userId, row.id);
      if (p) progress = { sectionIdx: p.section_idx, position: p.position, percent: p.percent, updatedAt: p.updated_at };
    }

    res.json({
      book,
      circulation: circulationView(bookStatusFor(db, row.id, userId)),
      shelf,
      progress,
      reviews,
      distribution,
      toc,
      similar,
      collections,
    });
  });

  // ── Lending ───────────────────────────────────────────────────────────────
  r.post('/books/:slug/borrow', (req, res) => {
    const user = requireUser(req);
    const row = findBook(db, req.params.slug);
    const loan = borrow(db, user.id, row.id, now());
    res.status(201).json({ loan, circulation: circulationView(bookStatusFor(db, row.id, user.id)) });
  });

  r.post('/books/:slug/hold', (req, res) => {
    const user = requireUser(req);
    const row = findBook(db, req.params.slug);
    const hold = placeHold(db, user.id, row.id, now());
    res.status(201).json({ hold, circulation: circulationView(bookStatusFor(db, row.id, user.id)) });
  });

  // ── Shelves & reviews ─────────────────────────────────────────────────────
  r.put('/books/:slug/shelf', (req, res) => {
    const user = requireUser(req);
    const row = findBook(db, req.params.slug);
    const existing = db.prepare('SELECT * FROM shelves WHERE user_id = ? AND book_id = ?').get(user.id, row.id);
    let status = existing?.status ?? null;
    if ('status' in (req.body || {})) {
      status = req.body.status;
      if (status !== null && !['want', 'reading', 'finished'].includes(status)) {
        throw new HttpError(400, 'Shelf must be want, reading, finished or null.');
      }
    }
    const favorite = 'favorite' in (req.body || {}) ? (req.body.favorite ? 1 : 0) : (existing?.favorite ?? 0);
    const t = iso(now());
    if (!status && !favorite) {
      db.prepare('DELETE FROM shelves WHERE user_id = ? AND book_id = ?').run(user.id, row.id);
      return res.json({ shelf: null });
    }
    const finishedAt = status === 'finished' ? (existing?.status === 'finished' ? existing.finished_at : t) : null;
    db.prepare(
      `INSERT INTO shelves (user_id, book_id, status, favorite, updated_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, book_id) DO UPDATE SET status = excluded.status, favorite = excluded.favorite,
         updated_at = excluded.updated_at, finished_at = excluded.finished_at`,
    ).run(user.id, row.id, status, favorite, t, finishedAt);
    res.json({ shelf: { status, favorite: Boolean(favorite), finishedAt } });
  });

  r.put('/books/:slug/review', (req, res) => {
    const user = requireUser(req);
    const row = findBook(db, req.params.slug);
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Rating must be 1 to 5 stars.');
    const body = str(req.body?.body, { max: 4000, name: 'Review' });
    const t = iso(now());
    db.prepare(
      `INSERT INTO reviews (user_id, book_id, rating, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, book_id) DO UPDATE SET rating = excluded.rating, body = excluded.body,
         updated_at = excluded.updated_at`,
    ).run(user.id, row.id, rating, body, t, t);
    res.json({ ok: true });
  });

  r.delete('/books/:slug/review', (req, res) => {
    const user = requireUser(req);
    const row = findBook(db, req.params.slug);
    db.prepare('DELETE FROM reviews WHERE user_id = ? AND book_id = ?').run(user.id, row.id);
    res.json({ ok: true });
  });

  // ── Purchase suggestions ──────────────────────────────────────────────────
  r.post('/suggestions', (req, res) => {
    const user = requireUser(req);
    const title = str(req.body?.title, { required: true, max: 300, name: 'Title' });
    const author = str(req.body?.author, { max: 200, name: 'Author' });
    const note = str(req.body?.note, { max: 1000, name: 'Note' });
    const sourceKey = str(req.body?.sourceKey, { max: 100, name: 'Source' }) || null;
    const dup = db
      .prepare(`SELECT 1 FROM suggestions WHERE user_id = ? AND title = ? COLLATE NOCASE AND status = 'open'`)
      .get(user.id, title);
    if (dup) throw new HttpError(409, 'You’ve already suggested this title — our librarians have it.');
    db.prepare(
      'INSERT INTO suggestions (user_id, title, author, source_key, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(user.id, title, author, sourceKey, note, iso(now()));
    res.status(201).json({ ok: true });
  });

  // ── Project Gutenberg ─────────────────────────────────────────────────────
  r.get('/gutenberg/search', async (req, res) => {
    const q = str(req.query.q, { max: 200, name: 'Search' });
    if (!q) return res.json({ count: 0, next: false, results: [] });
    const data = await searchGutenberg(q, { page: clampInt(req.query.page, 1, 500, 1), fetchImpl });
    const inCatalog = db.prepare('SELECT slug FROM books WHERE gutenberg_id = ?');
    data.results = data.results.map((b) => ({ ...b, slug: inCatalog.get(b.gutenbergId)?.slug ?? null }));
    res.json(data);
  });

  r.post('/gutenberg/:id/add', async (req, res) => {
    requireUser(req);
    const id = clampInt(req.params.id, 1, 10_000_000, 0);
    if (!id) throw new HttpError(400, 'Invalid Project Gutenberg number.');
    const existing = db.prepare('SELECT slug FROM books WHERE gutenberg_id = ?').get(id);
    if (existing) return res.json({ slug: existing.slug, created: false });
    const meta = await getGutenbergBook(id, { fetchImpl });
    const bookId = insertBook(
      db,
      {
        title: meta.title,
        author: meta.author,
        subjects: meta.subjects,
        language: meta.languages[0] || 'en',
        description: '',
        gutenbergId: id,
        copies: 0,
      },
      now(),
    );
    const { slug } = db.prepare('SELECT slug FROM books WHERE id = ?').get(bookId);
    res.status(201).json({ slug, created: true });
  });

  return r;
}

export function circulationView(s) {
  return {
    copies: s.copies,
    available: s.available,
    onLoan: s.onLoan,
    waiting: s.waiting,
    loan: s.loan
      ? { id: s.loan.id, borrowedAt: s.loan.borrowed_at, dueAt: s.loan.due_at, renewals: s.loan.renewals }
      : null,
    hold: s.hold
      ? { id: s.hold.id, status: s.hold.status, position: s.hold.position, createdAt: s.hold.created_at, expiresAt: s.hold.expires_at }
      : null,
  };
}
