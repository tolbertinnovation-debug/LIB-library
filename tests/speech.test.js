import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkText, pauseAfter, prepareForSpeech, romanToInt } from '../client/src/speech.ts';

test('read-aloud text is split into short, complete pieces', () => {
  const para = 'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen!';
  const pieces = chunkText(para);
  assert.equal(pieces[0], 'Call me Ishmael.');
  assert.ok(pieces.every((p) => p.length <= 221), 'no piece is too long to speak');
  assert.equal(pieces.join(' '), para, 'nothing is lost');
  assert.deepEqual(chunkText('  _Italic_\n  words  '), ['Italic words']);
  assert.deepEqual(chunkText('   '), []);
  assert.ok(chunkText('word '.repeat(200)).every((p) => p.length <= 221));
});

test('text is rewritten the way a narrator reads it', () => {
  assert.equal(prepareForSpeech('Mr. Darcy and Mrs. Bennet met Dr. Watson.'), 'Mister Darcy and Missus Bennet met Doctor Watson.');
  assert.deepEqual(chunkText('Mr. Knightley smiled. Emma did not.'), ['Mister Knightley smiled.', 'Emma did not.'], 'no false sentence break after Mr.');
  assert.equal(prepareForSpeech('I was--well--surprised'), 'I was, well, surprised');
  assert.equal(prepareForSpeech('Chapter IV. The Rabbit', { heading: true }), 'Chapter 4. The Rabbit.');
  assert.equal(prepareForSpeech('XII. The Fairy Tale of Father Brown', { heading: true }), 'Chapter 12. The Fairy Tale of Father Brown.');
  assert.equal(prepareForSpeech('Actus Primus. Scoena Prima', { heading: true }), 'Act 1. Scene 1.');
  assert.equal(prepareForSpeech('I think, therefore I am', { heading: false }), 'I think, therefore I am', 'a plain "I" is left alone');
  assert.equal(romanToInt('XLIV'), 44);
  assert.equal(romanToInt('HELLO'), null);
});

test('pauses follow punctuation', () => {
  assert.ok(pauseAfter('Chapter 1.', { heading: true }) > pauseAfter('End.', { endOfBlock: true }));
  assert.ok(pauseAfter('A sentence.') > pauseAfter('a clause,'));
});
