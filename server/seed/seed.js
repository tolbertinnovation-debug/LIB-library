import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx } from '../db.js';
import { hashPassword, newCardNumber } from '../lib/auth.js';
import { splitSections, wordCount } from '../lib/text.js';
import { DAY, dayKey, iso, slugify } from '../lib/util.js';
import { BOOKS, COLLECTIONS } from './catalog.js';

const TEXT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/texts');

export function storeSections(db, bookId, sections) {
  db.prepare('DELETE FROM sections WHERE book_id = ?').run(bookId);
  const ins = db.prepare('INSERT INTO sections (book_id, idx, title, body, words) VALUES (?, ?, ?, ?, ?)');
  let total = 0;
  sections.forEach((s, i) => {
    const words = wordCount(s.body);
    total += words;
    ins.run(bookId, i, s.title, s.body, words);
  });
  db.prepare('UPDATE books SET has_text = 1, word_count = ? WHERE id = ?').run(total, bookId);
  return total;
}

export function uniqueSlug(db, title, author) {
  let slug = slugify(title);
  if (db.prepare('SELECT 1 FROM books WHERE slug = ?').get(slug)) slug = slugify(`${title} ${author}`);
  let n = 2;
  const base = slug;
  while (db.prepare('SELECT 1 FROM books WHERE slug = ?').get(slug)) slug = `${base}-${n++}`;
  return slug;
}

export function insertBook(db, book, now) {
  const slug = uniqueSlug(db, book.title, book.author);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO books (slug, title, author, year, language, description, subjects, copies,
                          gutenberg_id, verse, featured, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      slug,
      book.title,
      book.author,
      book.year ?? null,
      book.language || 'en',
      book.description || '',
      JSON.stringify(book.subjects || []),
      book.copies ?? 1,
      book.gutenbergId ?? null,
      book.text?.verse || book.verse ? 1 : 0,
      book.featured ? 1 : 0,
      iso(now),
    );
  return Number(lastInsertRowid);
}

function createUser(db, { email, name, password, role = 'member', goal = 12 }, now) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO users (email, name, password_hash, role, card_number, reading_goal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(email, name, hashPassword(password), role, newCardNumber(), goal, iso(now));
  return Number(lastInsertRowid);
}

export const DEMO_ACCOUNTS = [
  { email: 'reader@liberia.library', name: 'Musu Kollie', password: 'readmore', role: 'member', goal: 24 },
  { email: 'librarian@liberia.library', name: 'Josephine Kamara', password: 'librarian', role: 'librarian', goal: 30 },
];

/**
 * Load the founding catalog (and optionally demo members and activity)
 * into an empty database. Does nothing if books already exist.
 */
export function seed(db, { now = Date.now(), demo = true, log = () => {} } = {}) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM books').get();
  if (n > 0) return false;

  tx(db, () => {
    const collectionIds = {};
    COLLECTIONS.forEach((c, i) => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO collections (slug, title, description, position) VALUES (?, ?, ?, ?)')
        .run(c.slug, c.title, c.description, i);
      collectionIds[c.slug] = Number(lastInsertRowid);
    });

    const addToCollection = db.prepare(
      'INSERT OR IGNORE INTO collection_books (collection_id, book_id, position) VALUES (?, ?, ?)',
    );
    BOOKS.forEach((book, i) => {
      const id = insertBook(db, book, now - (BOOKS.length - i) * 3600_000);
      if (book.text) {
        const raw = fs.readFileSync(path.join(TEXT_DIR, book.text.file), 'utf8');
        const words = storeSections(db, id, splitSections(raw, book.text.split));
        log(`  ${book.title}: ${words.toLocaleString()} words`);
      }
      for (const c of book.collections || []) addToCollection.run(collectionIds[c], id, i);
    });

    if (demo) seedDemo(db, now);
  });
  return true;
}

function bookId(db, title) {
  const row = db.prepare('SELECT id FROM books WHERE title = ?').get(title);
  if (!row) throw new Error(`Seed refers to unknown book: ${title}`);
  return row.id;
}

function seedDemo(db, now) {
  const [readerId, librarianId] = DEMO_ACCOUNTS.map((a) => createUser(db, a, now - 200 * DAY));

  const neighbours = [
    ['Comfort Weah', 'comfort@example.org'],
    ['James Kpoto', 'james@example.org'],
    ['Fatu Sirleaf', 'fatu@example.org'],
    ['Emmanuel Tarpeh', 'emmanuel@example.org'],
    ['Grace Nyema', 'grace@example.org'],
  ].map(([name, email]) =>
    createUser(db, { name, email, password: 'readmore' }, now - 120 * DAY),
  );

  const loan = (userId, title, daysAgo, { returned = false, renewals = 0 } = {}) => {
    const borrowed = now - daysAgo * DAY;
    db.prepare(
      `INSERT INTO loans (user_id, book_id, borrowed_at, due_at, returned_at, renewals) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      bookId(db, title),
      iso(borrowed),
      iso(borrowed + 14 * DAY * (1 + renewals)),
      returned ? iso(borrowed + 9 * DAY) : null,
      renewals,
    );
  };
  // The demo member's current loans (one is overdue, one due soon).
  loan(readerId, 'Things Fall Apart', 4);
  loan(readerId, 'The House at Sugar Beach', 12);
  loan(readerId, 'Beloved', 17);
  loan(readerId, 'Their Eyes Were Watching God', 60, { returned: true });
  loan(readerId, 'Americanah', 90, { returned: true });
  // Neighbours keep the popular titles busy so holds make sense.
  loan(neighbours[0], 'Murder in the Cassava Patch', 3);
  loan(neighbours[1], 'Murder in the Cassava Patch', 6);
  loan(neighbours[2], 'Murder in the Cassava Patch', 8);
  loan(neighbours[3], 'Murder in the Cassava Patch', 2);
  loan(neighbours[4], 'Murder in the Cassava Patch', 10);
  loan(neighbours[0], 'Mighty Be Our Powers', 5);
  loan(neighbours[1], 'Mighty Be Our Powers', 9);
  loan(neighbours[2], 'Nervous Conditions', 7);
  loan(neighbours[3], 'She Would Be King', 1);
  loan(neighbours[4], 'She Would Be King', 11);
  loan(neighbours[0], 'Dune', 20);

  const hold = (userId, title, daysAgo) =>
    db
      .prepare('INSERT INTO holds (user_id, book_id, created_at) VALUES (?, ?, ?)')
      .run(userId, bookId(db, title), iso(now - daysAgo * DAY));
  hold(neighbours[3], 'Mighty Be Our Powers', 4);
  hold(readerId, 'Mighty Be Our Powers', 2);
  hold(neighbours[4], 'Nervous Conditions', 3);

  const shelf = (userId, title, status, { favorite = 0, finishedDaysAgo } = {}) =>
    db
      .prepare(
        `INSERT INTO shelves (user_id, book_id, status, favorite, updated_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        bookId(db, title),
        status,
        favorite,
        iso(now - (finishedDaysAgo ?? 1) * DAY),
        finishedDaysAgo != null ? iso(now - finishedDaysAgo * DAY) : null,
      );
  shelf(readerId, 'Alice’s Adventures in Wonderland', 'reading');
  shelf(readerId, 'The Man Who Was Thursday', 'reading');
  shelf(readerId, 'Things Fall Apart', 'reading');
  shelf(readerId, 'Persuasion', 'finished', { favorite: 1, finishedDaysAgo: 30 });
  shelf(readerId, 'Their Eyes Were Watching God', 'finished', { favorite: 1, finishedDaysAgo: 48 });
  shelf(readerId, 'Americanah', 'finished', { finishedDaysAgo: 75 });
  shelf(readerId, 'The Adventures of Buster Bear', 'finished', { finishedDaysAgo: 12 });
  shelf(readerId, 'Moby-Dick', 'want');
  shelf(readerId, 'Paradise Lost', 'want');
  shelf(readerId, 'Mighty Be Our Powers', 'want');

  const progress = (userId, title, sectionIdx, percent) =>
    db
      .prepare(
        `INSERT INTO progress (user_id, book_id, section_idx, position, percent, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(userId, bookId(db, title), sectionIdx, percent, iso(now - DAY));
  progress(readerId, 'Alice’s Adventures in Wonderland', 4, 38);
  progress(readerId, 'The Man Who Was Thursday', 2, 14);

  // Reading minutes for the last few weeks, for the streak and activity chart.
  const day = db.prepare('INSERT INTO reading_days (user_id, day, minutes) VALUES (?, ?, ?)');
  const pattern = [22, 35, 0, 18, 41, 27, 12, 0, 30, 25, 44, 16, 0, 9, 38, 20, 26, 31, 0, 15, 24];
  pattern.forEach((m, i) => {
    if (m) day.run(readerId, dayKey(now - (pattern.length - 1 - i) * DAY), m);
  });

  const review = (userId, title, rating, body, daysAgo) =>
    db
      .prepare(
        `INSERT INTO reviews (user_id, book_id, rating, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, bookId(db, title), rating, body, iso(now - daysAgo * DAY), iso(now - daysAgo * DAY));
  review(readerId, 'Persuasion', 5, 'Anne Elliot is the most patient heroine in English fiction, and the letter near the end undid me.', 29);
  review(readerId, 'Their Eyes Were Watching God', 5, 'The language sings. I read the hurricane chapters twice.', 47);
  review(neighbours[0], 'Murder in the Cassava Patch', 5, 'We read this in school and I still love it. Every Liberian should know this story.', 20);
  review(neighbours[1], 'Murder in the Cassava Patch', 4, 'Short, sharp and full of village life. Perfect for one evening.', 15);
  review(neighbours[2], 'Things Fall Apart', 5, 'Okonkwo stays with you long after the last page.', 33);
  review(neighbours[3], 'The House at Sugar Beach', 5, 'Honest and funny and heartbreaking about Monrovia before the war.', 12);
  review(neighbours[4], 'Alice’s Adventures in Wonderland', 4, 'Read it aloud to my niece — we both laughed at the Mad Tea-Party.', 8);
  review(neighbours[0], 'Moby-Dick', 4, 'Skip nothing. Even the whale chapters are worth it.', 60);
  review(neighbours[1], 'Mighty Be Our Powers', 5, 'The women in white. Required reading.', 25);
  review(neighbours[2], 'Hamlet', 4, 'The Folio spelling takes a few pages to get used to, then it feels alive.', 40);
  review(librarianId, 'Stories to Tell to Children', 5, 'Our story-hour favourite. Try “The Little Jackal and the Alligator.”', 70);

  db.prepare(
    `INSERT INTO suggestions (user_id, title, author, note, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(neighbours[2], 'The Mask of Anarchy', 'Stephen Ellis', 'Would love more Liberian history on the shelves.', iso(now - 6 * DAY));
}
