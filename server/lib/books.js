// Shared queries and serializers for catalog records.

// Columns for list views, including live availability and rating summary.
export const BOOK_COLUMNS = `
  b.id, b.slug, b.title, b.author, b.year, b.language, b.description, b.subjects, b.copies,
  b.gutenberg_id, b.verse, b.has_text, b.word_count, b.featured, b.created_at,
  (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id AND l.returned_at IS NULL) AS on_loan,
  (SELECT COUNT(*) FROM holds h WHERE h.book_id = b.id AND h.status = 'ready') AS holds_ready,
  (SELECT COUNT(*) FROM holds h WHERE h.book_id = b.id AND h.status = 'waiting') AS holds_waiting,
  (SELECT ROUND(AVG(r.rating), 2) FROM reviews r WHERE r.book_id = b.id) AS rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.book_id = b.id) AS rating_count,
  (SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id) AS times_borrowed
`;

/** Minutes to read `words` at an unhurried 230 words per minute. */
export function readingMinutes(words) {
  return Math.round(words / 230);
}

export function serializeBook(row) {
  if (!row) return null;
  const available = Math.max(0, row.copies - (row.on_loan ?? 0) - (row.holds_ready ?? 0));
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    author: row.author,
    year: row.year,
    language: row.language,
    description: row.description,
    subjects: JSON.parse(row.subjects || '[]'),
    copies: row.copies,
    available,
    onLoan: row.on_loan ?? 0,
    holdsWaiting: row.holds_waiting ?? 0,
    gutenbergId: row.gutenberg_id,
    verse: Boolean(row.verse),
    hasText: Boolean(row.has_text),
    readable: Boolean(row.has_text || row.gutenberg_id),
    wordCount: row.word_count,
    readingMinutes: readingMinutes(row.word_count),
    featured: Boolean(row.featured),
    rating: row.rating ?? null,
    ratingCount: row.rating_count ?? 0,
    timesBorrowed: row.times_borrowed ?? 0,
    createdAt: row.created_at,
  };
}

export function getBookRow(db, slugOrId) {
  const where = typeof slugOrId === 'number' ? 'b.id = ?' : 'b.slug = ?';
  return db.prepare(`SELECT ${BOOK_COLUMNS} FROM books b WHERE ${where}`).get(slugOrId);
}

export function listBooks(db, whereSql = '1', params = [], { order = 'b.title COLLATE NOCASE', limit = 24, offset = 0 } = {}) {
  return db
    .prepare(`SELECT ${BOOK_COLUMNS} FROM books b WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map(serializeBook);
}

/** Turn free text into a safe FTS5 prefix query: `moby dic` -> `"moby"* "dic"*`. */
export function ftsQuery(q) {
  const terms = String(q)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  if (!terms) return null;
  return terms.slice(0, 12).map((t) => `"${t}"*`).join(' ');
}

export function serializeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    cardNumber: u.card_number,
    readingGoal: u.reading_goal,
    createdAt: u.created_at,
  };
}
