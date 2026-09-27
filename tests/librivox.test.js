import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRecording, pickRecording, tracksFromMetadata } from '../client/src/librivox.ts';

const docs = [
  { identifier: 'alice_short_works', title: "Short Works Collection featuring Alice's Adventures in Wonderland", creator: 'Various', downloads: 900000 },
  { identifier: 'alices_adventures_1003', title: "Alice's Adventures in Wonderland", creator: 'Carroll, Lewis', downloads: 400000 },
  { identifier: 'alice_dramatic', title: "Alice's Adventures in Wonderland (Dramatic Reading)", creator: 'Carroll, Lewis', downloads: 500000 },
  { identifier: 'emma_solo', title: 'Emma', creator: 'Austen, Jane', downloads: 100 },
];

test('picks the plain recording by the right author', () => {
  assert.equal(pickRecording(docs, 'Alice’s Adventures in Wonderland', 'Lewis Carroll').identifier, 'alices_adventures_1003');
  assert.equal(pickRecording(docs, 'Emma', 'Jane Austen').identifier, 'emma_solo');
  assert.equal(pickRecording(docs, 'Emma', 'Somebody Else'), null, 'wrong author is rejected');
  assert.equal(pickRecording(docs, 'Moby-Dick', 'Herman Melville'), null);
});

test('lists chapters in order, preferring 64kbps MP3s', () => {
  const files = [
    { name: 'alice_02_carroll_64kb.mp3', format: '64Kbps MP3', title: 'Chapter 02 - The Pool of Tears', track: '2', length: '14:05' },
    { name: 'alice_01_carroll_64kb.mp3', format: '64Kbps MP3', title: 'Chapter 01 - Down the Rabbit-Hole', track: '1/12', length: '812.5' },
    { name: 'alice_01_carroll.mp3', format: '128Kbps MP3', track: '1' },
    { name: 'cover.jpg', format: 'JPEG' },
  ];
  const tracks = tracksFromMetadata('alices_adventures_1003', files);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].title, 'Chapter 01 - Down the Rabbit-Hole');
  assert.equal(tracks[0].seconds, 812.5);
  assert.equal(tracks[1].seconds, 845);
  assert.equal(tracks[0].url, 'https://archive.org/download/alices_adventures_1003/alice_01_carroll_64kb.mp3');
});

test('findRecording searches, then reads the file list', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes('advancedsearch')) return Response.json({ response: { docs } });
    return Response.json({ files: [{ name: 'a_01_64kb.mp3', format: '64Kbps MP3', title: 'Chapter 1', track: '1' }] });
  };
  const rec = await findRecording('Alice’s Adventures in Wonderland', 'Lewis Carroll', fake);
  assert.equal(rec.identifier, 'alices_adventures_1003');
  assert.equal(rec.tracks.length, 1);
  assert.match(decodeURIComponent(calls[0]).replace(/\+/g, ' '), /collection:\(librivoxaudio\) AND title:\(alice AND adventures AND wonderland\)/);
  assert.equal(await findRecording('Unknown Book', 'Nobody', async () => Response.json({ response: { docs: [] } })), null);
});
