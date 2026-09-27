import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startLibrary } from './helpers.js';

let lib;
before(async () => {
  lib = await startLibrary();
});
after(() => lib.close());

describe('accounts', () => {
  test('register, who-am-I, logout', async () => {
    const a = lib.agent();
    const user = await a.register('Ada Freeman', 'ada@example.com');
    assert.equal(user.role, 'member');
    assert.match(user.cardNumber, /^\d{4}-\d{4}-\d{4}$/);
    assert.equal((await a.get('/api/auth/me')).body.user.email, 'ada@example.com');
    await a.post('/api/auth/logout');
    assert.equal((await a.get('/api/auth/me')).body.user, null);
  });

  test('rejects duplicate emails, weak passwords and wrong passwords', async () => {
    const a = lib.agent();
    assert.equal((await a.post('/api/auth/register', { name: 'X', email: 'reader@liberia.library', password: 'longenough' })).status, 409);
    assert.equal((await a.post('/api/auth/register', { name: 'X', email: 'x@example.com', password: 'short' })).status, 400);
    assert.equal((await a.post('/api/auth/login', { email: 'reader@liberia.library', password: 'nope-nope' })).status, 401);
  });

  test('emails listed in ADMIN_EMAILS register as librarians', async () => {
    const a = lib.agent();
    assert.equal((await a.register('Head Librarian', 'head@example.com')).role, 'librarian');
    assert.equal((await a.get('/api/admin/overview')).status, 200);
  });

  test('state-changing requests must be JSON', async () => {
    const res = await fetch(`${lib.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a&password=b',
    });
    assert.equal(res.status, 415);
  });

  test('change password signs out other sessions', async () => {
    const a = lib.agent();
    const b = lib.agent();
    await a.register('Pat', 'pat@example.com', 'first-password');
    await b.login('pat@example.com', 'first-password');
    assert.equal((await a.post('/api/me/password', { current: 'wrong', next: 'second-password' })).status, 400);
    assert.equal((await a.post('/api/me/password', { current: 'first-password', next: 'second-password' })).status, 200);
    assert.equal((await b.get('/api/auth/me')).body.user, null);
    assert.equal((await a.get('/api/auth/me')).body.user.name, 'Pat');
  });
});

describe('catalog', () => {
  test('home page data', async () => {
    const { body } = await lib.agent().get('/api/home');
    assert.ok(body.featured.length > 0);
    assert.ok(body.collections.find((c) => c.slug === 'liberian-african-voices').books.length >= 10);
    assert.ok(body.bookOfTheDay.excerpt.length > 50);
    assert.equal(body.stats.books, 84);
  });

  test('full-text search ranks title matches first and tolerates prefixes and accents', async () => {
    const a = lib.agent();
    let { body } = await a.get('/api/books?q=moby');
    assert.equal(body.books[0].slug, 'moby-dick');
    ({ body } = await a.get('/api/books?q=cassava%20pat'));
    assert.equal(body.books[0].title, 'Murder in the Cassava Patch');
    ({ body } = await a.get('/api/books?q=ngugi'));
    assert.equal(body.books[0].title, 'Weep Not, Child');
    ({ body } = await a.get('/api/books?q=%22%29%28*'));
    assert.equal(body.total, 0);
  });

  test('filters and sorting', async () => {
    const a = lib.agent();
    const readable = (await a.get('/api/books?readable=1&limit=60')).body;
    assert.ok(readable.books.every((b) => b.readable));
    const liberia = (await a.get('/api/books?subject=Liberia')).body;
    assert.ok(liberia.total >= 6);
    const oldest = (await a.get('/api/books?sort=oldest&limit=1')).body.books[0];
    assert.equal(oldest.title, 'The Odyssey');
    const avail = (await a.get('/api/books?available=1&limit=60&q=cassava')).body;
    assert.equal(avail.total, 0, 'every copy of Murder in the Cassava Patch is out');
    const page2 = (await a.get('/api/books?limit=10&page=2')).body;
    assert.equal(page2.page, 2);
    assert.equal(page2.books.length, 10);
  });

  test('book detail includes reviews, similar titles and table of contents', async () => {
    const { body } = await lib.agent().get('/api/books/alices-adventures-in-wonderland');
    assert.equal(body.book.author, 'Lewis Carroll');
    assert.equal(body.toc.length, 12);
    assert.ok(body.reviews.length >= 1);
    assert.ok(body.similar.length > 0);
    assert.equal((await lib.agent().get('/api/books/no-such-book')).status, 404);
  });
});

describe('reader', () => {
  test('sections, in-book search, progress and bookmarks', async () => {
    const a = lib.agent();
    await a.register('Reader Two', 'r2@example.com');
    const sec = (await a.get('/api/books/alices-adventures-in-wonderland/sections/0')).body;
    assert.match(sec.body, /Alice was beginning to get very tired/);
    assert.equal(sec.count, 12);

    const found = (await a.get('/api/books/alices-adventures-in-wonderland/find?q=march%20hare')).body;
    assert.ok(found.total >= 20);
    assert.equal(found.results[0].match.toLowerCase(), 'march hare');
    assert.equal((await a.get('/api/books/alices-adventures-in-wonderland/find?q=(%5B')).body.total, 0);

    assert.equal((await a.put('/api/books/alices-adventures-in-wonderland/progress', { sectionIdx: 3, position: 0.5, percent: 30, minutes: 99 })).status, 200);
    const detail = (await a.get('/api/books/alices-adventures-in-wonderland')).body;
    assert.equal(detail.progress.sectionIdx, 3);
    assert.equal(detail.shelf.status, 'reading', 'opening a book shelves it as reading');

    const bm = (await a.post('/api/books/alices-adventures-in-wonderland/bookmarks', { sectionIdx: 3, position: 0.5, excerpt: 'Who are you?', note: 'caterpillar' })).body.bookmark;
    assert.equal(bm.sectionTitle, 'Chapter IV. The Rabbit Sends in a Little Bill');
    assert.equal((await a.get('/api/books/alices-adventures-in-wonderland/bookmarks')).body.bookmarks.length, 1);
    assert.equal((await lib.agent().del(`/api/bookmarks/${bm.id}`)).status, 401);
    assert.equal((await a.del(`/api/bookmarks/${bm.id}`)).status, 200);

    const dash = (await a.get('/api/me/dashboard')).body;
    assert.equal(dash.stats.totalMinutes, 5, 'minutes per save are capped');
    assert.equal(dash.stats.streak, 1);
  });

  test('print-only titles cannot be opened in the reader', async () => {
    const res = await lib.agent().get('/api/books/things-fall-apart/sections/0');
    assert.equal(res.status, 404);
  });
});

describe('shelves & reviews', () => {
  test('shelve, favourite, review and see it in the dashboard', async () => {
    const a = lib.agent();
    await a.register('Shelver', 'shelf@example.com');
    await a.put('/api/books/dune/shelf', { status: 'want' });
    await a.put('/api/books/emma/shelf', { status: 'finished', favorite: true });
    assert.equal((await a.put('/api/books/emma/shelf', { status: 'bogus' })).status, 400);
    assert.equal((await a.put('/api/books/emma/review', { rating: 6 })).status, 400);
    await a.put('/api/books/emma/review', { rating: 5, body: 'Loved it' });
    const dash = (await a.get('/api/me/dashboard')).body;
    assert.equal(dash.shelves.length, 2);
    assert.equal(dash.stats.finishedThisYear, 1);
    assert.ok(dash.recommendations.length > 0);
    assert.ok(!dash.recommendations.some((b) => b.slug === 'emma'));
    const detail = (await a.get('/api/books/emma')).body;
    assert.ok(detail.reviews[0].mine);
    await a.put('/api/books/emma/shelf', { status: null, favorite: false });
    assert.equal((await a.get('/api/me/dashboard')).body.shelves.length, 1);
  });
});
