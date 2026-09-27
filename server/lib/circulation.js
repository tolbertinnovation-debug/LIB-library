// Lending rules for the print collection: loans, renewals and the holds queue.
import { tx } from '../db.js';
import { DAY, HttpError, iso } from './util.js';

export const RULES = Object.freeze({
  loanDays: 14,
  maxLoans: 5,
  maxRenewals: 2,
  maxHolds: 5,
  holdReadyDays: 3,
});

export function availability(db, bookId) {
  const row = db
    .prepare(
      `SELECT b.copies,
        (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL) AS on_loan,
        (SELECT COUNT(*) FROM holds h WHERE h.book_id = b.id AND h.status = 'ready') AS ready,
        (SELECT COUNT(*) FROM holds h WHERE h.book_id = b.id AND h.status = 'waiting') AS waiting
       FROM books b WHERE b.id = ?`,
    )
    .get(bookId);
  if (!row) throw new HttpError(404, 'Book not found');
  const available = Math.max(0, row.copies - row.on_loan - row.ready);
  return { copies: row.copies, onLoan: row.on_loan, ready: row.ready, waiting: row.waiting, available };
}

/**
 * Expire stale "ready" holds and hand free copies to the next people waiting.
 * Safe to call at any time; it is idempotent for a given `now`.
 */
export function processBook(db, bookId, now) {
  const nowIso = iso(now);
  db.prepare(
    `UPDATE holds SET status = 'expired' WHERE book_id = ? AND status = 'ready' AND expires_at <= ?`,
  ).run(bookId, nowIso);

  let { available } = availability(db, bookId);
  const next = db.prepare(
    `SELECT id FROM holds WHERE book_id = ? AND status = 'waiting' ORDER BY created_at, id LIMIT 1`,
  );
  const promote = db.prepare(
    `UPDATE holds SET status = 'ready', ready_at = ?, expires_at = ? WHERE id = ?`,
  );
  while (available > 0) {
    const hold = next.get(bookId);
    if (!hold) break;
    promote.run(nowIso, iso(now + RULES.holdReadyDays * DAY), hold.id);
    available--;
  }
}

/** Run processBook for every title with an active hold. */
export function sweep(db, now) {
  const ids = db
    .prepare(`SELECT DISTINCT book_id FROM holds WHERE status IN ('waiting', 'ready')`)
    .all()
    .map((r) => r.book_id);
  for (const id of ids) processBook(db, id, now);
}

function activeLoan(db, userId, bookId) {
  return db
    .prepare(`SELECT * FROM loans WHERE user_id = ? AND book_id = ? AND returned_at IS NULL`)
    .get(userId, bookId);
}

function activeHold(db, userId, bookId) {
  return db
    .prepare(
      `SELECT * FROM holds WHERE user_id = ? AND book_id = ? AND status IN ('waiting', 'ready')`,
    )
    .get(userId, bookId);
}

export function borrow(db, userId, bookId, now) {
  return tx(db, () => {
    processBook(db, bookId, now);
    if (activeLoan(db, userId, bookId)) throw new HttpError(409, 'You already have this book on loan.');
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM loans WHERE user_id = ? AND returned_at IS NULL`)
      .get(userId);
    if (n >= RULES.maxLoans) {
      throw new HttpError(409, `You can borrow up to ${RULES.maxLoans} books at a time. Return one to make room.`);
    }

    const hold = activeHold(db, userId, bookId);
    if (hold?.status === 'ready') {
      db.prepare(`UPDATE holds SET status = 'fulfilled' WHERE id = ?`).run(hold.id);
    } else {
      const { available } = availability(db, bookId);
      if (available <= 0) {
        throw new HttpError(409, 'All copies are out right now. Place a hold and we will save the next one for you.');
      }
      if (hold) db.prepare(`UPDATE holds SET status = 'fulfilled' WHERE id = ?`).run(hold.id);
    }

    const { lastInsertRowid } = db
      .prepare(`INSERT INTO loans (user_id, book_id, borrowed_at, due_at) VALUES (?, ?, ?, ?)`)
      .run(userId, bookId, iso(now), iso(now + RULES.loanDays * DAY));
    return getLoan(db, Number(lastInsertRowid));
  });
}

export function renew(db, userId, loanId, now) {
  return tx(db, () => {
    const loan = db.prepare(`SELECT * FROM loans WHERE id = ?`).get(loanId);
    if (!loan || loan.user_id !== userId) throw new HttpError(404, 'Loan not found');
    if (loan.returned_at) throw new HttpError(409, 'This loan has already been returned.');
    if (loan.renewals >= RULES.maxRenewals) {
      throw new HttpError(409, `This loan has already been renewed ${RULES.maxRenewals} times.`);
    }
    const { waiting } = availability(db, loan.book_id);
    if (waiting > 0) throw new HttpError(409, 'Other members are waiting for this book, so it can’t be renewed.');
    const base = Math.max(now, Date.parse(loan.due_at));
    db.prepare(`UPDATE loans SET due_at = ?, renewals = renewals + 1 WHERE id = ?`).run(
      iso(base + RULES.loanDays * DAY),
      loanId,
    );
    return getLoan(db, loanId);
  });
}

/** Return a loan. Members may return their own; librarians (asLibrarian) any. */
export function returnLoan(db, userId, loanId, now, { asLibrarian = false } = {}) {
  return tx(db, () => {
    const loan = db.prepare(`SELECT * FROM loans WHERE id = ?`).get(loanId);
    if (!loan || (!asLibrarian && loan.user_id !== userId)) throw new HttpError(404, 'Loan not found');
    if (loan.returned_at) throw new HttpError(409, 'This loan has already been returned.');
    db.prepare(`UPDATE loans SET returned_at = ? WHERE id = ?`).run(iso(now), loanId);
    processBook(db, loan.book_id, now);
    return getLoan(db, loanId);
  });
}

export function placeHold(db, userId, bookId, now) {
  return tx(db, () => {
    processBook(db, bookId, now);
    if (activeLoan(db, userId, bookId)) throw new HttpError(409, 'You already have this book on loan.');
    if (activeHold(db, userId, bookId)) throw new HttpError(409, 'You already have a hold on this book.');
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM holds WHERE user_id = ? AND status IN ('waiting', 'ready')`)
      .get(userId);
    if (n >= RULES.maxHolds) throw new HttpError(409, `You can have up to ${RULES.maxHolds} holds at a time.`);
    const { available } = availability(db, bookId);
    if (available > 0) throw new HttpError(409, 'A copy is available right now — you can borrow it instead.');
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO holds (user_id, book_id, created_at) VALUES (?, ?, ?)`)
      .run(userId, bookId, iso(now));
    return getHold(db, Number(lastInsertRowid));
  });
}

export function cancelHold(db, userId, holdId, now) {
  return tx(db, () => {
    const hold = db.prepare(`SELECT * FROM holds WHERE id = ?`).get(holdId);
    if (!hold || hold.user_id !== userId) throw new HttpError(404, 'Hold not found');
    if (!['waiting', 'ready'].includes(hold.status)) throw new HttpError(409, 'This hold is no longer active.');
    db.prepare(`UPDATE holds SET status = 'cancelled' WHERE id = ?`).run(holdId);
    processBook(db, hold.book_id, now);
    return getHold(db, holdId);
  });
}

export function getLoan(db, id) {
  const l = db.prepare(`SELECT * FROM loans WHERE id = ?`).get(id);
  if (!l) return null;
  return {
    id: l.id,
    bookId: l.book_id,
    borrowedAt: l.borrowed_at,
    dueAt: l.due_at,
    returnedAt: l.returned_at,
    renewals: l.renewals,
  };
}

export function getHold(db, id) {
  const h = db.prepare(`SELECT * FROM holds WHERE id = ?`).get(id);
  if (!h) return null;
  return {
    id: h.id,
    bookId: h.book_id,
    status: h.status,
    createdAt: h.created_at,
    readyAt: h.ready_at,
    expiresAt: h.expires_at,
    position: holdPosition(db, h),
  };
}

export function holdPosition(db, hold) {
  if (hold.status !== 'waiting') return null;
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM holds
       WHERE book_id = ? AND status = 'waiting' AND (created_at < ? OR (created_at = ? AND id < ?))`,
    )
    .get(hold.book_id, hold.created_at, hold.created_at, hold.id);
  return n + 1;
}

/** Circulation status of one book for one (optional) member. */
export function bookStatusFor(db, bookId, userId) {
  const avail = availability(db, bookId);
  if (!userId) return { ...avail, loan: null, hold: null };
  const loan = activeLoan(db, userId, bookId) || null;
  const rawHold = activeHold(db, userId, bookId);
  const hold = rawHold ? { ...rawHold, position: holdPosition(db, rawHold) } : null;
  return { ...avail, loan, hold };
}
