import { Router } from 'express';
import { hashPassword, hashToken, parseCookies, SESSION_COOKIE, verifyPassword } from '../lib/auth.js';
import { BOOK_COLUMNS, serializeBook, serializeUser } from '../lib/books.js';
import { RULES, cancelHold, holdPosition, processBook, renew, returnLoan } from '../lib/circulation.js';
import { requireUser } from '../lib/guards.js';
import { DAY, HttpError, clampInt, dayKey, str } from '../lib/util.js';
import { validatePassword } from './auth.js';
import { serializeBookmark } from './reader.js';

const GENERIC = ['Fiction', 'Classics', 'Nonfiction'];

export function loansFor(db, userId, { active = true, limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT ${BOOK_COLUMNS}, l.id AS loan_id, l.borrowed_at, l.due_at, l.returned_at, l.renewals
       FROM loans l JOIN books b ON b.id = l.book_id
       WHERE l.user_id = ? AND (l.returned_at IS NULL) = ?
       ORDER BY ${active ? 'l.due_at' : 'l.returned_at DESC'} LIMIT ?`,
    )
    .all(userId, active ? 1 : 0, limit)
    .map((row) => ({
      id: row.loan_id,
      borrowedAt: row.borrowed_at,
      dueAt: row.due_at,
      returnedAt: row.returned_at,
      renewals: row.renewals,
      renewalsLeft: RULES.maxRenewals - row.renewals,
      othersWaiting: row.holds_waiting,
      book: serializeBook(row),
    }));
}

export function holdsFor(db, userId) {
  return db
    .prepare(
      `SELECT ${BOOK_COLUMNS}, h.id AS hold_id, h.status AS hold_status, h.created_at AS hold_created,
              h.ready_at, h.expires_at, h.book_id
       FROM holds h JOIN books b ON b.id = h.book_id
       WHERE h.user_id = ? AND h.status IN ('waiting', 'ready')
       ORDER BY h.status = 'ready' DESC, h.created_at`,
    )
    .all(userId)
    .map((row) => ({
      id: row.hold_id,
      status: row.hold_status,
      createdAt: row.hold_created,
      readyAt: row.ready_at,
      expiresAt: row.expires_at,
      position: holdPosition(db, {
        id: row.hold_id,
        book_id: row.book_id,
        status: row.hold_status,
        created_at: row.hold_created,
      }),
      book: serializeBook(row),
    }));
}

function readingStats(db, user, now) {
  const year = new Date(now).getUTCFullYear();
  const finishedThisYear = db
    .prepare(`SELECT COUNT(*) AS n FROM shelves WHERE user_id = ? AND status = 'finished' AND finished_at >= ?`)
    .get(user.id, `${year}-01-01`).n;
  const finishedAllTime = db
    .prepare(`SELECT COUNT(*) AS n FROM shelves WHERE user_id = ? AND status = 'finished'`)
    .get(user.id).n;

  const days = new Map(
    db
      .prepare('SELECT day, minutes FROM reading_days WHERE user_id = ? AND day >= ?')
      .all(user.id, dayKey(now - 400 * DAY))
      .map((d) => [d.day, d.minutes]),
  );
  const activity = [];
  for (let i = 83; i >= 0; i--) {
    const d = dayKey(now - i * DAY);
    activity.push({ day: d, minutes: Math.round(days.get(d) || 0) });
  }
  // A streak survives until the end of today even if you haven't read yet.
  let streak = 0;
  let cursor = days.get(dayKey(now)) ? 0 : 1;
  while (days.get(dayKey(now - cursor * DAY))) {
    streak++;
    cursor++;
  }
  const totalMinutes = Math.round(
    db.prepare('SELECT COALESCE(SUM(minutes), 0) AS m FROM reading_days WHERE user_id = ?').get(user.id).m,
  );
  const wordsRead = Math.round(
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN s.status = 'finished' THEN b.word_count ELSE b.word_count * p.percent / 100.0 END), 0) AS w
         FROM books b
         LEFT JOIN progress p ON p.book_id = b.id AND p.user_id = ?
         LEFT JOIN shelves s ON s.book_id = b.id AND s.user_id = ?
         WHERE p.user_id IS NOT NULL OR s.status = 'finished'`,
      )
      .get(user.id, user.id).w,
  );
  const topSubjects = db
    .prepare(
      `SELECT j.value AS name, COUNT(*) AS count FROM shelves s JOIN books b ON b.id = s.book_id, json_each(b.subjects) j
       WHERE s.user_id = ? AND s.status IN ('reading', 'finished') AND j.value NOT IN (${GENERIC.map(() => '?').join(',')})
       GROUP BY j.value ORDER BY count DESC, name LIMIT 6`,
    )
    .all(user.id, ...GENERIC);
  const totalBorrowed = db.prepare('SELECT COUNT(*) AS n FROM loans WHERE user_id = ?').get(user.id).n;

  return {
    year,
    goal: user.reading_goal,
    finishedThisYear,
    finishedAllTime,
    streak,
    totalMinutes,
    wordsRead,
    totalBorrowed,
    activity,
    topSubjects,
  };
}

function recommendations(db, userId, limit = 10) {
  const seeds = db
    .prepare(
      `SELECT b.subjects, b.author FROM shelves s JOIN books b ON b.id = s.book_id
       WHERE s.user_id = ? AND (s.status IN ('reading', 'finished') OR s.favorite = 1)`,
    )
    .all(userId);
  const weights = {};
  for (const s of seeds) {
    for (const subj of JSON.parse(s.subjects)) if (!GENERIC.includes(subj)) weights[subj] = (weights[subj] || 0) + 1;
  }
  const liked = JSON.stringify(Object.entries(weights).map(([k, v]) => ({ k, v })));
  const authors = JSON.stringify([...new Set(seeds.map((s) => s.author))]);
  return db
    .prepare(
      `SELECT ${BOOK_COLUMNS},
         (SELECT COALESCE(SUM(json_extract(w.value, '$.v')), 0)
            FROM json_each(?) w, json_each(b.subjects) t WHERE t.value = json_extract(w.value, '$.k'))
         + 2 * (b.author IN (SELECT value FROM json_each(?))) AS score
       FROM books b
       WHERE b.id NOT IN (SELECT book_id FROM shelves WHERE user_id = ?)
         AND b.id NOT IN (SELECT book_id FROM loans WHERE user_id = ?)
       ORDER BY score DESC, rating_count DESC, times_borrowed DESC, b.id LIMIT ?`,
    )
    .all(liked, authors, userId, userId, limit)
    .map(serializeBook);
}

export default function meRoutes({ db, now }) {
  const r = Router();

  r.get('/me/dashboard', (req, res) => {
    const user = requireUser(req);
    const t = now();
    const shelves = db
      .prepare(
        `SELECT ${BOOK_COLUMNS}, s.status AS shelf_status, s.favorite AS shelf_favorite, s.finished_at,
                p.percent AS p_percent, p.section_idx AS p_section
         FROM shelves s JOIN books b ON b.id = s.book_id
         LEFT JOIN progress p ON p.book_id = b.id AND p.user_id = s.user_id
         WHERE s.user_id = ? ORDER BY s.updated_at DESC`,
      )
      .all(user.id)
      .map((row) => ({
        status: row.shelf_status,
        favorite: Boolean(row.shelf_favorite),
        finishedAt: row.finished_at,
        progress: row.p_percent != null ? { percent: row.p_percent, sectionIdx: row.p_section } : null,
        book: serializeBook(row),
      }));
    const bookmarks = db
      .prepare(
        `SELECT bm.*, s.title AS section_title, b.slug AS book_slug, b.title AS book_title, b.author AS book_author
         FROM bookmarks bm JOIN books b ON b.id = bm.book_id
         LEFT JOIN sections s ON s.book_id = bm.book_id AND s.idx = bm.section_idx
         WHERE bm.user_id = ? ORDER BY bm.created_at DESC LIMIT 200`,
      )
      .all(user.id)
      .map((bm) => ({
        ...serializeBookmark(bm),
        book: { slug: bm.book_slug, title: bm.book_title, author: bm.book_author },
      }));
    const suggestions = db
      .prepare('SELECT id, title, author, note, status, created_at FROM suggestions WHERE user_id = ? ORDER BY created_at DESC')
      .all(user.id)
      .map((s) => ({ id: s.id, title: s.title, author: s.author, note: s.note, status: s.status, createdAt: s.created_at }));

    res.json({
      user: serializeUser(user),
      rules: RULES,
      loans: loansFor(db, user.id),
      history: loansFor(db, user.id, { active: false, limit: 50 }),
      holds: holdsFor(db, user.id),
      shelves,
      bookmarks,
      suggestions,
      stats: readingStats(db, user, t),
      recommendations: recommendations(db, user.id),
    });
  });

  r.post('/loans/:id/renew', (req, res) => {
    const user = requireUser(req);
    const loan = renew(db, user.id, clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0), now());
    res.json({ loan });
  });

  r.post('/loans/:id/return', (req, res) => {
    const user = requireUser(req);
    const loan = returnLoan(db, user.id, clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0), now());
    res.json({ loan });
  });

  r.delete('/holds/:id', (req, res) => {
    const user = requireUser(req);
    const hold = cancelHold(db, user.id, clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0), now());
    res.json({ hold });
  });

  r.patch('/me', (req, res) => {
    const user = requireUser(req);
    const name = 'name' in (req.body || {}) ? str(req.body.name, { required: true, max: 80, name: 'Name' }) : user.name;
    const goal = 'readingGoal' in (req.body || {}) ? clampInt(req.body.readingGoal, 1, 500, user.reading_goal) : user.reading_goal;
    db.prepare('UPDATE users SET name = ?, reading_goal = ? WHERE id = ?').run(name, goal, user.id);
    res.json({ user: serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
  });

  r.post('/me/password', (req, res) => {
    const user = requireUser(req);
    if (!verifyPassword(String(req.body?.current || ''), user.password_hash)) {
      throw new HttpError(400, 'Your current password is not right.');
    }
    const next = validatePassword(req.body?.next);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
    // Sign out every other device.
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, hashToken(token || ''));
    res.json({ ok: true });
  });

  // Everything we store about you, as a JSON download.
  r.get('/me/export', (req, res) => {
    const user = requireUser(req);
    const q = (sql) => db.prepare(sql).all(user.id);
    const data = {
      exportedAt: new Date(now()).toISOString(),
      account: serializeUser(user),
      loans: q(`SELECT l.*, b.title, b.author FROM loans l JOIN books b ON b.id = l.book_id WHERE l.user_id = ?`),
      holds: q(`SELECT h.*, b.title, b.author FROM holds h JOIN books b ON b.id = h.book_id WHERE h.user_id = ?`),
      shelves: q(`SELECT s.*, b.title, b.author FROM shelves s JOIN books b ON b.id = s.book_id WHERE s.user_id = ?`),
      reviews: q(`SELECT r.*, b.title, b.author FROM reviews r JOIN books b ON b.id = r.book_id WHERE r.user_id = ?`),
      progress: q(`SELECT p.*, b.title FROM progress p JOIN books b ON b.id = p.book_id WHERE p.user_id = ?`),
      bookmarks: q(`SELECT m.*, b.title FROM bookmarks m JOIN books b ON b.id = m.book_id WHERE m.user_id = ?`),
      readingDays: q(`SELECT day, minutes FROM reading_days WHERE user_id = ? ORDER BY day`),
      suggestions: q(`SELECT * FROM suggestions WHERE user_id = ?`),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="liberia-online-library-my-data.json"');
    res.json(data);
  });

  r.delete('/me', (req, res) => {
    const user = requireUser(req);
    if (!verifyPassword(String(req.body?.password || ''), user.password_hash)) {
      throw new HttpError(400, 'Please confirm with your current password.');
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM loans WHERE user_id = ? AND returned_at IS NULL').get(user.id);
    if (n > 0) throw new HttpError(409, 'Please return your borrowed books before closing your account.');
    const affected = db
      .prepare(`SELECT DISTINCT book_id FROM holds WHERE user_id = ? AND status IN ('waiting', 'ready')`)
      .all(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    // Pass on any copy that was being held for this member.
    for (const { book_id } of affected) processBook(db, book_id, now());
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  return r;
}
