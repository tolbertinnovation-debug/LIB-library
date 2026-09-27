import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkText } from '../client/src/speech.ts';

test('read-aloud text is split into short, complete pieces', () => {
  const para = 'Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen!';
  const pieces = chunkText(para);
  assert.equal(pieces[0], 'Call me Ishmael.');
  assert.ok(pieces.every((p) => p.length <= 221), 'no piece is too long to speak');
  assert.equal(pieces.join(' ').replace(/\s+/g, ' '), para.replace(/\s+/g, ' '), 'nothing is lost');
  assert.deepEqual(chunkText('  _Italic_\n  words  '), ['Italic words']);
  assert.deepEqual(chunkText('   '), []);
  const long = 'word '.repeat(200);
  assert.ok(chunkText(long).every((p) => p.length <= 221));
});
