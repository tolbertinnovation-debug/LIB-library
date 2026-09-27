import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { startLibrary } from './helpers.js';

let lib;
beforeEach(async () => {
  lib = await startLibrary({ demo: false });
});
afterEach(() => lib.close());

async function makeLibrarian() {
  const a = lib.agent();
  const u = await a.register('Desk', 'desk@example.com');
  lib.db.prepare(`UPDATE users SET role = 'librarian' WHERE id = ?`).run(u.id);
  return a;
}

test('borrow until copies run out, then hold; a return hands the copy to the first in line', async () => {
  // "Nervous Conditions" has a single copy.
  const [ama, ben, cat] = [lib.agent(), lib.agent(), lib.agent()];
  await ama.register('Ama', 'ama@example.com');
  await ben.register('Ben', 'ben@example.com');
  await cat.register('Cat', 'cat@example.com');

  const loan = (await ama.post('/api/books/nervous-conditions/borrow')).body.loan;
  assert.ok(loan.id);
  assert.equal((await ama.post('/api/books/nervous-conditions/borrow')).status, 409, 'no double loans');
  assert.equal((await ben.post('/api/books/nervous-conditions/borrow')).status, 409, 'no copies left');

  const benHold = (await ben.post('/api/books/nervous-conditions/hold')).body;
  assert.equal(benHold.hold.position, 1);
  const catHold = (await cat.post('/api/books/nervous-conditions/hold')).body;
  assert.equal(catHold.hold.position, 2);
  assert.equal((await cat.post('/api/books/nervous-conditions/hold')).status, 409, 'no duplicate holds');

  // Renewal is blocked while others wait.
  assert.equal((await ama.post(`/api/loans/${loan.id}/renew`)).status, 409);

  await ama.post(`/api/loans/${loan.id}/return`);
  const benView = (await ben.get('/api/books/nervous-conditions')).body.circulation;
  assert.equal(benView.hold.status, 'ready');
  assert.equal(benView.available, 0, 'the copy is reserved for Ben');
  assert.equal((await cat.post('/api/books/nervous-conditions/borrow')).status, 409, 'Cat cannot jump the queue');
  assert.equal((await cat.get('/api/books/nervous-conditions')).body.circulation.hold.position, 1);

  const benLoan = await ben.post('/api/books/nervous-conditions/borrow');
  assert.equal(benLoan.status, 201);
  const dash = (await ben.get('/api/me/dashboard')).body;
  assert.equal(dash.holds.length, 0, 'the hold was fulfilled');
  assert.equal(dash.loans.length, 1);
});

test('ready holds expire after three days and pass to the next member', async () => {
  const [ama, ben, cat] = [lib.agent(), lib.agent(), lib.agent()];
  await ama.register('Ama', 'ama@example.com');
  await ben.register('Ben', 'ben@example.com');
  await cat.register('Cat', 'cat@example.com');
  const loan = (await ama.post('/api/books/nervous-conditions/borrow')).body.loan;
  await ben.post('/api/books/nervous-conditions/hold');
  await cat.post('/api/books/nervous-conditions/hold');
  await ama.post(`/api/loans/${loan.id}/return`);

  lib.advanceDays(3.1);
  const catView = (await cat.get('/api/books/nervous-conditions')).body.circulation;
  assert.equal(catView.hold.status, 'ready');
  assert.equal((await ben.get('/api/books/nervous-conditions')).body.circulation.hold, null);
});

test('renewals extend the due date up to the limit; loan limit is enforced', async () => {
  const a = lib.agent();
  await a.register('Ama', 'ama@example.com');
  const loan = (await a.post('/api/books/dune/borrow')).body.loan;
  const due0 = Date.parse(loan.dueAt);
  const r1 = (await a.post(`/api/loans/${loan.id}/renew`)).body.loan;
  assert.equal(Date.parse(r1.dueAt) - due0, 14 * 86400000);
  await a.post(`/api/loans/${loan.id}/renew`);
  assert.equal((await a.post(`/api/loans/${loan.id}/renew`)).status, 409);

  for (const slug of ['beloved', 'emma', 'hamlet', 'macbeth']) {
    assert.equal((await a.post(`/api/books/${slug}/borrow`)).status, 201);
  }
  assert.equal((await a.post('/api/books/persuasion/borrow')).status, 409, 'five-loan limit');

  const other = lib.agent();
  await other.register('Ben', 'ben@example.com');
  assert.equal((await other.post(`/api/loans/${loan.id}/return`)).status, 404, 'cannot return someone else’s loan');
});

test('cannot hold a book that is on the shelf; cancelling a hold', async () => {
  const [a, b] = [lib.agent(), lib.agent()];
  await a.register('Ama', 'ama@example.com');
  await b.register('Ben', 'ben@example.com');
  assert.equal((await a.post('/api/books/emma/hold')).status, 409);
  await a.post('/api/books/nervous-conditions/borrow');
  const hold = (await b.post('/api/books/nervous-conditions/hold')).body.hold;
  assert.equal((await a.del(`/api/holds/${hold.id}`)).status, 404);
  assert.equal((await b.del(`/api/holds/${hold.id}`)).status, 200);
  assert.equal((await b.del(`/api/holds/${hold.id}`)).status, 409);
});

test('librarian desk: overview, checkout by card, check-in, catalog edits', async () => {
  const desk = await makeLibrarian();
  const member = lib.agent();
  const m = await member.register('Ama', 'ama@example.com');

  assert.equal((await member.get('/api/admin/overview')).status, 403);
  assert.equal((await lib.agent().get('/api/admin/overview')).status, 401);

  const out = await desk.post('/api/admin/checkout', { cardNumber: m.cardNumber.replace(/-/g, ''), slug: 'dune' });
  assert.equal(out.status, 201);
  assert.equal((await desk.post('/api/admin/checkout', { cardNumber: '0000-0000-0000', slug: 'dune' })).status, 404);

  const overview = (await desk.get('/api/admin/overview')).body;
  assert.equal(overview.counts.activeLoans, 1);
  assert.equal(overview.checkouts.length, 30);

  lib.advanceDays(20);
  const overdue = (await desk.get('/api/admin/loans?status=overdue')).body.loans;
  assert.equal(overdue.length, 1);
  assert.equal((await desk.post(`/api/admin/loans/${overdue[0].id}/checkin`)).status, 200);

  const created = await desk.post('/api/admin/books', {
    title: 'The Mask of Anarchy',
    author: 'Stephen Ellis',
    year: 1999,
    copies: 2,
    subjects: 'History, Liberia',
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.book.subjects, ['History', 'Liberia']);
  const slug = created.body.book.slug;
  assert.equal((await lib.agent().get(`/api/books?q=anarchy`)).body.books[0].slug, slug);

  const edited = await desk.patch(`/api/admin/books/${slug}`, { copies: 5, title: 'The Mask of Anarchy (Updated Edition)' });
  assert.equal(edited.body.book.copies, 5);
  assert.equal((await lib.agent().get(`/api/books?q=updated`)).body.books[0].slug, slug, 'search index follows edits');

  const text = 'CHAPTER 1\n\n' + 'Monrovia at dawn. '.repeat(80) + '\n\nCHAPTER 2\n\n' + 'The river. '.repeat(80) + '\n\nCHAPTER 3\n\n' + 'Home. '.repeat(100);
  const up = await desk.put(`/api/admin/books/${slug}/text`, { text });
  assert.equal(up.body.sections, 3);
  assert.equal((await member.get(`/api/books/${slug}/sections/1`)).body.title, 'Chapter 2');

  assert.equal((await desk.del(`/api/admin/books/${slug}`)).status, 200);
  assert.ok(!(await lib.agent().get(`/api/books?q=anarchy`)).body.books.some((b) => b.slug === slug));

  const members = (await desk.get('/api/admin/members?q=ama')).body.members;
  assert.equal(members.length, 1);
  const promoted = await desk.patch(`/api/admin/members/${members[0].id}`, { role: 'librarian' });
  assert.equal(promoted.body.member.role, 'librarian');
});

test('suggestions flow from members to the desk', async () => {
  const desk = await makeLibrarian();
  const a = lib.agent();
  await a.register('Ama', 'ama@example.com');
  assert.equal((await a.post('/api/suggestions', { title: 'Kintu', author: 'Jennifer Nansubuga Makumbi' })).status, 201);
  assert.equal((await a.post('/api/suggestions', { title: 'kintu' })).status, 409);
  const list = (await desk.get('/api/admin/suggestions')).body.suggestions;
  assert.equal(list[0].title, 'Kintu');
  await desk.patch(`/api/admin/suggestions/${list[0].id}`, { status: 'acquired' });
  assert.equal((await a.get('/api/me/dashboard')).body.suggestions[0].status, 'acquired');
});

test('account export and deletion', async () => {
  const a = lib.agent();
  await a.register('Ama', 'ama@example.com', 'a-long-password');
  await a.put('/api/books/emma/review', { rating: 4, body: 'Nice' });
  const exp = await a.get('/api/me/export');
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  assert.equal(exp.body.reviews.length, 1);
  const loan = (await a.post('/api/books/dune/borrow')).body.loan;
  assert.equal((await a.del('/api/me', { password: 'a-long-password' })).status, 409, 'must return books first');
  await a.post(`/api/loans/${loan.id}/return`);
  assert.equal((await a.del('/api/me', { password: 'wrong' })).status, 400);
  assert.equal((await a.del('/api/me', { password: 'a-long-password' })).status, 200);
  assert.equal((await a.get('/api/auth/me')).body.user, null);
});
