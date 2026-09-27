// Finds a human-narrated LibriVox recording of a public-domain book on the
// Internet Archive, and lists its chapter files. Both archive.org APIs used
// here allow cross-origin requests, so this runs in the browser.

export interface Track {
  title: string;
  url: string;
  seconds: number | null;
}

export interface Recording {
  identifier: string;
  title: string;
  tracks: Track[];
  page: string;
}

interface SearchDoc {
  identifier: string;
  title?: string;
  creator?: string | string[];
  downloads?: number;
}

interface MetaFile {
  name: string;
  format?: string;
  title?: string;
  track?: string;
  length?: string;
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'to', 'or', 'by', 'version', 'dramatic', 'abridged']);

function words(s: string) {
  // Drop possessives on both sides so "Alice's" and "Alices" both become "alice".
  return (s.replace(/[’']s\b/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w));
}

/** Pick the best-matching LibriVox recording from search results. */
export function pickRecording(docs: SearchDoc[], title: string, author: string): SearchDoc | null {
  const want = words(title);
  const surname = words(author).at(-1) ?? '';
  let best: { doc: SearchDoc; score: number } | null = null;
  for (const doc of docs) {
    const have = new Set(words(doc.title ?? ''));
    const matched = want.filter((w) => have.has(w)).length;
    if (!want.length || matched < Math.ceil(want.length * 0.75)) continue;
    const creators = words([doc.creator ?? ''].flat().join(' '));
    if (surname && creators.length && !creators.includes(surname)) continue;
    // Prefer exact titles over collections ("Short Works of…") and popular solo readings.
    const extra = have.size - matched;
    const lower = (doc.title ?? '').toLowerCase();
    let score = matched * 10 - extra * 3 + Math.log10((doc.downloads ?? 0) + 1);
    if (/dramatic reading|dramatized|version 2|abridged|collection|selections|excerpts/i.test(lower)) score -= 6;
    if (!best || score > best.score) best = { doc, score };
  }
  return best?.doc ?? null;
}

function parseLength(len?: string): number | null {
  if (!len) return null;
  if (/^\d+(\.\d+)?$/.test(len)) return Number(len);
  const parts = len.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

/** Turn an archive.org metadata listing into an ordered chapter list. */
export function tracksFromMetadata(identifier: string, files: MetaFile[]): Track[] {
  const mp3 = files.filter((f) => /\.mp3$/i.test(f.name));
  // 64 kbps keeps data use low on mobile networks; fall back to whatever MP3s exist.
  const pickFormat = ['64Kbps MP3', '128Kbps MP3', 'VBR MP3'].find((fmt) => mp3.some((f) => f.format === fmt));
  const chosen = pickFormat ? mp3.filter((f) => f.format === pickFormat) : mp3;
  const trackNo = (f: MetaFile) => {
    const n = Number.parseInt(f.track ?? '', 10);
    if (!Number.isNaN(n)) return n;
    const m = f.name.match(/_(\d{1,3})_/);
    return m ? Number(m[1]) : 9999;
  };
  return chosen
    .slice()
    .sort((a, b) => trackNo(a) - trackNo(b) || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => ({
      title: (f.title || f.name.replace(/_64kb\.mp3$|\.mp3$/i, '').replace(/_/g, ' ')).trim(),
      url: `https://archive.org/download/${encodeURIComponent(identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      seconds: parseLength(f.length),
    }));
}

const CACHE_KEY = 'lol-librivox:';

export async function findRecording(title: string, author: string, fetchImpl: typeof fetch = fetch): Promise<Recording | null> {
  const key = CACHE_KEY + title + '|' + author;
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as { at: number; rec: Recording | null };
      if (Date.now() - parsed.at < 7 * 86400000) return parsed.rec;
    }
  } catch {
    /* storage unavailable */
  }

  const titleWords = words(title).slice(0, 6);
  if (!titleWords.length) return null;
  const q = `collection:(librivoxaudio) AND title:(${titleWords.join(' AND ')})`;
  const params = new URLSearchParams({ q, rows: '25', output: 'json' });
  for (const f of ['identifier', 'title', 'creator', 'downloads']) params.append('fl[]', f);
  params.append('sort[]', 'downloads desc');
  const res = await fetchImpl(`https://archive.org/advancedsearch.php?${params}`);
  if (!res.ok) throw new Error('search failed');
  const docs = ((await res.json()) as { response?: { docs?: SearchDoc[] } }).response?.docs ?? [];
  const doc = pickRecording(docs, title, author);

  let rec: Recording | null = null;
  if (doc) {
    const meta = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`);
    if (!meta.ok) throw new Error('metadata failed');
    const files = ((await meta.json()) as { files?: MetaFile[] }).files ?? [];
    const tracks = tracksFromMetadata(doc.identifier, files);
    if (tracks.length) {
      rec = { identifier: doc.identifier, title: doc.title ?? title, tracks, page: `https://archive.org/details/${doc.identifier}` };
    }
  }
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), rec }));
  } catch {
    /* ignore */
  }
  return rec;
}
