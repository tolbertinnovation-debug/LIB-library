import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { BOOKS } from '../server/seed/catalog.js';
import { guessStrategy, splitSections, stripGutenbergBoilerplate } from '../server/lib/text.js';

test('every bundled text splits into sensible sections', () => {
  for (const book of BOOKS.filter((b) => b.text)) {
    const raw = fs.readFileSync(new URL(`../data/texts/${book.text.file}`, import.meta.url), 'utf8');
    const sections = splitSections(raw, book.text.split);
    assert.ok(sections.length >= 3, `${book.title} has ${sections.length} sections`);
    assert.ok(sections.every((s) => s.title && s.body.trim()), `${book.title} has an empty section`);
    assert.ok(sections.every((s) => s.body.length <= 60000), `${book.title} has an oversized section`);
    // Nothing is lost: all words survive the split.
    const before = raw.split(/\s+/).filter(Boolean).length;
    const after = sections.map((s) => s.body + ' ' + s.title).join(' ').split(/\s+/).filter(Boolean).length;
    assert.ok(after >= before * 0.97, `${book.title} lost words (${before} -> ${after})`);
  }
});

test('chapter titles are tidied', () => {
  const raw = fs.readFileSync(new URL('../data/texts/carroll-alice.txt', import.meta.url), 'utf8');
  const titles = splitSections(raw, 'chapter').map((s) => s.title);
  assert.equal(titles[0], 'Chapter I. Down the Rabbit-Hole');
  assert.equal(titles.at(-1), "Chapter XII. Alice's Evidence");
});

test('Gutenberg boilerplate is stripped and a strategy guessed', () => {
  const body = Array.from({ length: 6 }, (_, i) => `CHAPTER ${i + 1}\n\n${'Words and more words. '.repeat(60)}\n`).join('\n');
  const text = `Licence junk\n*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n${body}\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***\nMore licence`;
  const clean = stripGutenbergBoilerplate(text);
  assert.ok(!clean.includes('Licence'));
  assert.equal(guessStrategy(clean), 'chapter');
  assert.equal(splitSections(clean, 'chapter').length, 6);
});
