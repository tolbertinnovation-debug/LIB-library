import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'librarian')),
  card_number   TEXT NOT NULL UNIQUE,
  reading_goal  INTEGER NOT NULL DEFAULT 12,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  year         INTEGER,
  language     TEXT NOT NULL DEFAULT 'en',
  description  TEXT NOT NULL DEFAULT '',
  subjects     TEXT NOT NULL DEFAULT '[]',
  copies       INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 0),
  gutenberg_id INTEGER,
  verse        INTEGER NOT NULL DEFAULT 0,
  has_text     INTEGER NOT NULL DEFAULT 0,
  word_count   INTEGER NOT NULL DEFAULT 0,
  featured     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  title, author, description, subjects,
  content='books', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
  INSERT INTO books_fts(rowid, title, author, description, subjects)
  VALUES (new.id, new.title, new.author, new.description, new.subjects);
END;
CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, author, description, subjects)
  VALUES ('delete', old.id, old.title, old.author, old.description, old.subjects);
END;
CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, author, description, subjects)
  VALUES ('delete', old.id, old.title, old.author, old.description, old.subjects);
  INSERT INTO books_fts(rowid, title, author, description, subjects)
  VALUES (new.id, new.title, new.author, new.description, new.subjects);
END;

CREATE TABLE IF NOT EXISTS sections (
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx     INTEGER NOT NULL,
  title   TEXT NOT NULL,
  body    TEXT NOT NULL,
  words   INTEGER NOT NULL,
  PRIMARY KEY (book_id, idx)
);

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_books (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  book_id       INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, book_id)
);

CREATE TABLE IF NOT EXISTS loans (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  borrowed_at TEXT NOT NULL,
  due_at      TEXT NOT NULL,
  returned_at TEXT,
  renewals    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS loans_active ON loans(book_id) WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS loans_user ON loans(user_id);

CREATE TABLE IF NOT EXISTS holds (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  ready_at   TEXT,
  expires_at TEXT,
  status     TEXT NOT NULL DEFAULT 'waiting'
             CHECK (status IN ('waiting', 'ready', 'fulfilled', 'cancelled', 'expired'))
);
CREATE INDEX IF NOT EXISTS holds_book ON holds(book_id, status);

CREATE TABLE IF NOT EXISTS shelves (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status      TEXT CHECK (status IN ('want', 'reading', 'finished')),
  favorite    INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  section_idx INTEGER NOT NULL,
  position    REAL NOT NULL DEFAULT 0,
  percent     REAL NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  section_idx INTEGER NOT NULL,
  position    REAL NOT NULL DEFAULT 0,
  excerpt     TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_days (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT NOT NULL,
  minutes REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS suggestions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT '',
  source_key TEXT,
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acquired', 'declined')),
  created_at TEXT NOT NULL
);
`;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back if it throws. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
