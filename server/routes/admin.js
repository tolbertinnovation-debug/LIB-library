// The librarian's desk: circulation, catalog management, members, requests.
import { Router } from 'express';
import { tx } from '../db.js';
import { BOOK_COLUMNS, getBookRow, serializeBook, serializeUser } from '../lib/books.js';
import { borrow, processBook, returnLoan } from '../lib/circulation.js';
import { requireLibrarian } from '../lib/guards.js';
import { guessStrategy, splitSections, stripGutenbergBoilerplate } from '../lib/text.js';
import { DAY, HttpError, clampInt, dayKey, iso, str } from '../lib/util.js';
import { insertBook, storeSections } from '../seed/seed.js';

function bookInput(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => body && k in body;
  if (!partial || has('title')) out.title = str(body?.title, { required: true, max: 300, name: 'Title' });
  if (!partial || has('author')) out.author = str(body?.author, { required: true, max: 200, name: 'Author' });
  if (has('description')) out.description = str(body.description, { max: 5000, name: 'Description' });
  if (has('year')) {
    if (body.year === null || body.year === '') out.year = null;
    else {
      const y = Number(body.year);
      if (!Number.isInteger(y) || y < -3000 || y > 3000) throw new HttpError(400, 'Year must be a whole number.');
      out.year = y;
    }
  }
  if (has('copies')) {
    const c = Number(body.copies);
    if (!Number.isInteger(c) || c < 0 || c > 1000) throw new HttpError(400, 'Copies must be between 0 and 1000.');
    out.copies = c;
  }
  if (has('subjects')) {
    const list = Array.isArray(body.subjects) ? body.subjects : String(body.subjects || '').split(',');
    out.subjects = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].slice(0, 20);
    if (out.subjects.some((s) => s.length > 60)) throw new HttpError(400, 'Subjects must be 60 characters or fewer.');
  }
  if (has('gutenbergId')) {
    if (body.gutenbergId === null || body.gutenbergId === '') out.gutenbergId = null;
    else {
      const g = Number(body.gutenbergId);
      if (!Number.isInteger(g) || g < 1) throw new HttpError(400, 'Project Gutenberg number must be a positive whole number.');
      out.gutenbergId = g;
    }
  }
  if (has('language')) out.language = str(body.language, { max: 10, name: 'Language' }) || 'en';
  if (has('featured')) out.featured = Boolean(body.featured);
  if (has('verse')) out.verse = Boolean(body.verse);
  return out;
}

export default function adminRoutes({ db, now }) {
  const r = Router();
  r.use((req, res, next) => {
    requireLibrarian(req);
    next();
  });

  r.get('/overview', (req, res) => {
    const t = now();
    const nowIso = iso(t);
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const counts = {
      titles: one('SELECT COUNT(*) AS n FROM books').n,
      copies: one('SELECT COALESCE(SUM(copies), 0) AS n FROM books').n,
      readable: one('SELECT COUNT(*) AS n FROM books WHERE has_text = 1 OR gutenberg_id IS NOT NULL').n,
      members: one('SELECT COUNT(*) AS n FROM users').n,
      activeLoans: one('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL').n,
      overdue: one('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL AND due_at < ?', nowIso).n,
      dueSoon: one(
        'SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL AND due_at >= ? AND due_at < ?',
        nowIso,
        iso(t + 3 * DAY),
      ).n,
      holdsWaiting: one(`SELECT COUNT(*) AS n FROM holds WHERE status = 'waiting'`).n,
      holdsReady: one(`SELECT COUNT(*) AS n FROM holds WHERE status = 'ready'`).n,
      openSuggestions: one(`SELECT COUNT(*) AS n FROM suggestions WHERE status = 'open'`).n,
      newMembers30: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', iso(t - 30 * DAY)).n,
    };

    const perDay = new Map(
      db
        .prepare(`SELECT substr(borrowed_at, 1, 10) AS d, COUNT(*) AS n FROM loans WHERE borrowed_at >= ? GROUP BY d`)
        .all(iso(t - 30 * DAY))
        .map((x) => [x.d, x.n]),
    );
    const checkouts = [];
    for (let i = 29; i >= 0; i--) {
      const d = dayKey(t - i * DAY);
      checkouts.push({ day: d, count: perDay.get(d) || 0 });
    }

    const mostWanted = db
      .prepare(
        `SELECT ${BOOK_COLUMNS} FROM books b
         WHERE (SELECT COUNT(*) FROM holds h WHERE h.book_id = b.id AND h.status = 'waiting') > 0
         ORDER BY holds_waiting DESC, b.title LIMIT 8`,
      )
      .all()
      .map(serializeBook);
    const topBorrowed = db
      .prepare(`SELECT ${BOOK_COLUMNS} FROM books b WHERE times_borrowed > 0 ORDER BY times_borrowed DESC, b.title LIMIT 8`)
      .all()
      .map(serializeBook);

    res.json({ counts, checkouts, mostWanted, topBorrowed });
  });

  // ── Circulation desk ──────────────────────────────────────────────────────
  r.get('/loans', (req, res) => {
    const status = ['active', 'overdue', 'returned', 'all'].includes(req.query.status) ? req.query.status : 'active';
    const q = str(req.query.q, { max: 100 });
    const where = [];
    const params = [];
    if (status === 'active') where.push('l.returned_at IS NULL');
    if (status === 'overdue') {
      where.push('l.returned_at IS NULL AND l.due_at < ?');
      params.push(iso(now()));
    }
    if (status === 'returned') where.push('l.returned_at IS NOT NULL');
    if (q) {
      where.push(`(b.title LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.card_number LIKE ?)`);
      params.push(...Array(4).fill(`%${q}%`));
    }
    const rows = db
      .prepare(
        `SELECT l.*, b.slug, b.title, b.author, u.name, u.email, u.card_number
         FROM loans l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.user_id
         WHERE ${where.length ? where.join(' AND ') : '1'}
         ORDER BY l.returned_at IS NOT NULL, l.due_at LIMIT 300`,
      )
      .all(...params);
    res.json({
      loans: rows.map((l) => ({
        id: l.id,
        borrowedAt: l.borrowed_at,
        dueAt: l.due_at,
        returnedAt: l.returned_at,
        renewals: l.renewals,
        book: { slug: l.slug, title: l.title, author: l.author },
        member: { name: l.name, email: l.email, cardNumber: l.card_number },
      })),
    });
  });

  r.post('/loans/:id/checkin', (req, res) => {
    const loan = returnLoan(db, req.user.id, clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0), now(), {
      asLibrarian: true,
    });
    res.json({ loan });
  });

  // Check a book out to a member at the desk, by library card number.
  r.post('/checkout', (req, res) => {
    const card = str(req.body?.cardNumber, { required: true, max: 20, name: 'Card number' }).replace(/\s/g, '');
    const member = db.prepare(`SELECT * FROM users WHERE replace(card_number, '-', '') = replace(?, '-', '')`).get(card);
    if (!member) throw new HttpError(404, 'No member has that library card number.');
    const book = getBookRow(db, str(req.body?.slug, { required: true, max: 200, name: 'Book' }));
    if (!book) throw new HttpError(404, 'Book not found');
    const loan = borrow(db, member.id, book.id, now());
    res.status(201).json({ loan, member: serializeUser(member), book: serializeBook(getBookRow(db, book.id)) });
  });

  r.get('/holds', (req, res) => {
    const rows = db
      .prepare(
        `SELECT h.*, b.slug, b.title, b.author, u.name, u.card_number FROM holds h
         JOIN books b ON b.id = h.book_id JOIN users u ON u.id = h.user_id
         WHERE h.status IN ('waiting', 'ready') ORDER BY h.status = 'ready' DESC, b.title, h.created_at`,
      )
      .all();
    res.json({
      holds: rows.map((h) => ({
        id: h.id,
        status: h.status,
        createdAt: h.created_at,
        expiresAt: h.expires_at,
        book: { slug: h.slug, title: h.title, author: h.author },
        member: { name: h.name, cardNumber: h.card_number },
      })),
    });
  });

  // ── Catalog ───────────────────────────────────────────────────────────────
  r.post('/books', (req, res) => {
    const input = bookInput(req.body);
    const id = insertBook(db, { copies: 1, ...input, gutenbergId: input.gutenbergId ?? null }, now());
    res.status(201).json({ book: serializeBook(getBookRow(db, id)) });
  });

  r.patch('/books/:slug', (req, res) => {
    const row = getBookRow(db, req.params.slug);
    if (!row) throw new HttpError(404, 'Book not found');
    const input = bookInput(req.body, { partial: true });
    const cols = {
      title: 'title',
      author: 'author',
      description: 'description',
      year: 'year',
      copies: 'copies',
      language: 'language',
      gutenbergId: 'gutenberg_id',
      featured: 'featured',
      verse: 'verse',
    };
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(cols)) {
      if (k in input) {
        sets.push(`${col} = ?`);
        params.push(typeof input[k] === 'boolean' ? (input[k] ? 1 : 0) : input[k]);
      }
    }
    if ('subjects' in input) {
      sets.push('subjects = ?');
      params.push(JSON.stringify(input.subjects));
    }
    if (sets.length) {
      tx(db, () => {
        db.prepare(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`).run(...params, row.id);
        // More copies may satisfy people waiting.
        processBook(db, row.id, now());
      });
    }
    res.json({ book: serializeBook(getBookRow(db, row.id)) });
  });

  r.delete('/books/:slug', (req, res) => {
    const row = getBookRow(db, req.params.slug);
    if (!row) throw new HttpError(404, 'Book not found');
    if (row.on_loan > 0) throw new HttpError(409, 'This book still has copies out on loan. Check them in first.');
    db.prepare('DELETE FROM books WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  // Upload the full text of a book (plain text, e.g. from Project Gutenberg).
  r.put('/books/:slug/text', (req, res) => {
    const row = getBookRow(db, req.params.slug);
    if (!row) throw new HttpError(404, 'Book not found');
    const raw = typeof req.body?.text === 'string' ? req.body.text : '';
    if (raw.trim().length < 200) throw new HttpError(400, 'Please paste the full text (at least a few paragraphs).');
    const text = stripGutenbergBoilerplate(raw);
    const strategy = req.body?.split && req.body.split !== 'auto' ? req.body.split : guessStrategy(text);
    let sections;
    try {
      sections = splitSections(text, strategy);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const words = tx(db, () => storeSections(db, row.id, sections));
    res.json({ sections: sections.length, words, strategy });
  });

  r.delete('/books/:slug/text', (req, res) => {
    const row = getBookRow(db, req.params.slug);
    if (!row) throw new HttpError(404, 'Book not found');
    tx(db, () => {
      db.prepare('DELETE FROM sections WHERE book_id = ?').run(row.id);
      db.prepare('UPDATE books SET has_text = 0, word_count = 0 WHERE id = ?').run(row.id);
    });
    res.json({ ok: true });
  });

  // ── Members ───────────────────────────────────────────────────────────────
  r.get('/members', (req, res) => {
    const q = str(req.query.q, { max: 100 });
    const rows = db
      .prepare(
        `SELECT u.*,
           (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.returned_at IS NULL) AS active_loans,
           (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.returned_at IS NULL AND l.due_at < ?) AS overdue,
           (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id) AS total_loans,
           (SELECT COUNT(*) FROM holds h WHERE h.user_id = u.id AND h.status IN ('waiting', 'ready')) AS holds
         FROM users u
         WHERE (? = '' OR u.name LIKE ? OR u.email LIKE ? OR u.card_number LIKE ?)
         ORDER BY u.name COLLATE NOCASE LIMIT 300`,
      )
      .all(iso(now()), q, `%${q}%`, `%${q}%`, `%${q}%`);
    res.json({
      members: rows.map((u) => ({
        ...serializeUser(u),
        activeLoans: u.active_loans,
        overdue: u.overdue,
        totalLoans: u.total_loans,
        holds: u.holds,
      })),
    });
  });

  r.patch('/members/:id', (req, res) => {
    const id = clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0);
    const role = req.body?.role;
    if (!['member', 'librarian'].includes(role)) throw new HttpError(400, 'Role must be member or librarian.');
    if (id === req.user.id && role !== 'librarian') {
      throw new HttpError(409, 'You can’t remove your own librarian access.');
    }
    const { changes } = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (!changes) throw new HttpError(404, 'Member not found');
    res.json({ member: serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  });

  // ── Purchase suggestions ──────────────────────────────────────────────────
  r.get('/suggestions', (req, res) => {
    const rows = db
      .prepare(
        `SELECT s.*, u.name FROM suggestions s JOIN users u ON u.id = s.user_id
         ORDER BY s.status = 'open' DESC, s.created_at DESC LIMIT 300`,
      )
      .all();
    res.json({
      suggestions: rows.map((s) => ({
        id: s.id,
        title: s.title,
        author: s.author,
        note: s.note,
        sourceKey: s.source_key,
        status: s.status,
        createdAt: s.created_at,
        member: s.name,
      })),
    });
  });

  r.patch('/suggestions/:id', (req, res) => {
    const status = req.body?.status;
    if (!['open', 'acquired', 'declined'].includes(status)) throw new HttpError(400, 'Invalid status.');
    const { changes } = db
      .prepare('UPDATE suggestions SET status = ? WHERE id = ?')
      .run(status, clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0));
    if (!changes) throw new HttpError(404, 'Suggestion not found');
    res.json({ ok: true });
  });

  return r;
}
