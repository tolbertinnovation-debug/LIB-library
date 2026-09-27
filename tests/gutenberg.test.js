import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startLibrary } from './helpers.js';

const calls = [];
const chapters = Array.from({ length: 4 }, (_, i) => `CHAPTER ${i + 1}\n\n${'It is a truth universally acknowledged. '.repeat(40)}`).join('\n\n');
const PG_TEXT = `The Project Gutenberg eBook\n*** START OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***\n\n${chapters}\n\n*** END OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***\nlicence`;

async function fakeFetch(url) {
  calls.push(String(url));
  const u = new URL(url);
  if (u.hostname === 'www.gutenberg.org' && u.pathname === '/cache/epub/1342/pg1342.txt') {
    return new Response(PG_TEXT, { status: 200 });
  }
  if (u.hostname === 'gutendex.com' && u.pathname === '/books') {
    return Response.json({
      count: 1,
      next: null,
      results: [
        { id: 1342, title: 'Pride and Prejudice', authors: [{ name: 'Austen, Jane', birth_year: 1775 }], subjects: ['Courtship -- Fiction'], bookshelves: [], languages: ['en'], download_count: 50000, formats: {} },
        { id: 99999, title: 'A New Find', authors: [{ name: 'Writer, Some' }], subjects: [], bookshelves: ['Browsing: Poetry'], languages: ['en'], download_count: 10, formats: { 'image/jpeg': 'https://www.gutenberg.org/cover.jpg' } },
      ],
    });
  }
  if (u.hostname === 'gutendex.com' && u.pathname === '/books/99999') {
    return Response.json({ id: 99999, title: 'A New Find', authors: [{ name: 'Writer, Some' }], subjects: ['Poetry'], bookshelves: [], languages: ['en'], formats: {} });
  }
  return new Response('nope', { status: 404 });
}

let lib;
before(async () => {
  lib = await startLibrary({ demo: false, fetchImpl: fakeFetch });
});
after(() => lib.close());

test('Gutenberg titles are fetched on first open, then served from the database', async () => {
  const a = lib.agent();
  const toc = (await a.get('/api/books/pride-and-prejudice/toc')).body;
  assert.equal(toc.sections.length, 4);
  const sec = (await a.get('/api/books/pride-and-prejudice/sections/0')).body;
  assert.equal(sec.title, 'Chapter 1');
  assert.doesNotMatch(sec.body, /licence|START OF/);
  const before = calls.length;
  await a.get('/api/books/pride-and-prejudice/sections/2');
  assert.equal(calls.length, before, 'no second download');
  assert.ok((await a.get('/api/books/pride-and-prejudice')).body.book.hasText);
});

test('unreachable Gutenberg gives a friendly 502', async () => {
  const res = await lib.agent().get('/api/books/frankenstein/sections/0');
  assert.equal(res.status, 502);
  assert.match(res.body.error, /Project Gutenberg/);
});

test('search Gutenberg and add a title to the catalog', async () => {
  const a = lib.agent();
  const results = (await a.get('/api/gutenberg/search?q=austen')).body.results;
  assert.equal(results[0].author, 'Jane Austen');
  assert.equal(results[0].slug, 'pride-and-prejudice', 'already in the catalog');
  assert.equal(results[1].slug, null);
  assert.deepEqual(results[1].subjects, ['Poetry']);

  assert.equal((await a.post('/api/gutenberg/99999/add')).status, 401);
  await a.register('Adder', 'adder@example.com');
  const added = await a.post('/api/gutenberg/99999/add');
  assert.equal(added.status, 201);
  assert.equal(added.body.slug, 'a-new-find');
  const again = await a.post('/api/gutenberg/99999/add');
  assert.equal(again.body.created, false);
  const book = (await a.get('/api/books/a-new-find')).body.book;
  assert.equal(book.author, 'Some Writer');
  assert.equal(book.copies, 0);
  assert.ok(book.readable);
});
