// Writes the catalog as static JSON so the read-only edition can run on
// GitHub Pages (no server). Run after `vite build` for the pages edition.
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { seed } from '../server/seed/seed.js';

const out = path.resolve(process.argv[2] || 'dist-pages', 'data');
const db = openDb(':memory:');
seed(db, { demo: true });
const app = createApp({ db, fetchImpl: () => Promise.reject(new Error('offline')) });
const server = await new Promise((r) => {
  const s = app.listen(0, () => r(s));
});
const base = `http://127.0.0.1:${server.address().port}/api`;
const get = async (p) => {
  const res = await fetch(base + p);
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json();
};

// Without a server only bundled texts can be read.
const onlyBundled = (b) => ({ ...b, readable: b.hasText });
const write = (file, data) => {
  const f = path.join(out, file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data));
};

const home = await get('/home');
for (const k of ['featured', 'popular', 'added']) home[k] = home[k].map(onlyBundled);
home.collections = home.collections.map((c) => ({ ...c, books: c.books.map(onlyBundled) }));
if (home.bookOfTheDay) home.bookOfTheDay.book = onlyBundled(home.bookOfTheDay.book);
home.stats.readable = db.prepare('SELECT COUNT(*) AS n FROM books WHERE has_text = 1').get().n;
write('home.json', home);

const all = await get('/books?limit=60&page=1');
let books = all.books;
for (let p = 2; p <= all.pages; p++) books = books.concat((await get(`/books?limit=60&page=${p}`)).books);
write('books.json', { books: books.map(onlyBundled) });
write('subjects.json', await get('/subjects'));
write('authors.json', await get('/authors'));

for (const { slug } of db.prepare('SELECT slug FROM collections').all()) {
  const c = await get(`/collections/${slug}`);
  write(`collections/${slug}.json`, { ...c, books: c.books.map(onlyBundled) });
}

let words = 0;
for (const b of books) {
  const d = await get(`/books/${b.slug}`);
  d.book = onlyBundled(d.book);
  d.similar = d.similar.map(onlyBundled);
  write(`books/${b.slug}.json`, d);
  if (b.hasText) {
    const sections = db
      .prepare('SELECT idx, title, body, words FROM sections WHERE book_id = ? ORDER BY idx')
      .all(b.id)
      .map((s) => ({ ...s }));
    words += b.wordCount;
    write(`text/${b.slug}.json`, { sections, totalWords: b.wordCount });
  }
}

server.close();
console.log(`Wrote ${books.length} books (${words.toLocaleString()} words of text) to ${out}`);
