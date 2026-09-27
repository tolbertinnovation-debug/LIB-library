// The read-only "Pages edition": answers API calls from static JSON files
// generated at build time (scripts/build-pages-data.js), with no server.
import type { Book } from './types';

export const IS_STATIC = import.meta.env.VITE_STATIC === '1';
export const NO_SERVER_MESSAGE =
  'This is the free reading edition of Liberia Online Library. Accounts, borrowing and holds are available on the full library.';

const files = new Map<string, Promise<unknown>>();
function load<T>(file: string): Promise<T> {
  if (!files.has(file)) {
    const p = fetch(`${import.meta.env.BASE_URL}data/${file}`).then((r) => {
      if (!r.ok) throw Object.assign(new Error('We couldn’t find that in the catalog.'), { status: 404 });
      return r.json();
    });
    p.catch(() => files.delete(file));
    files.set(file, p);
  }
  return files.get(file) as Promise<T>;
}

interface TextFile {
  sections: { idx: number; title: string; body: string; words: number }[];
  totalWords: number;
}

const ERAS: Record<string, [number, number]> = { ancient: [-5000, 1499], early: [1500, 1799], c19: [1800, 1899], c20: [1900, 1999], c21: [2000, 3000] };

function fold(s: string) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function score(b: Book, terms: string[]) {
  const fields: [string, number][] = [
    [fold(b.title), 10],
    [fold(b.author), 8],
    [fold(b.subjects.join(' ')), 3],
    [fold(b.description), 1],
  ];
  let total = 0;
  for (const t of terms) {
    let best = 0;
    for (const [text, weight] of fields) {
      if (new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) best = Math.max(best, weight);
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

const SORTS: Record<string, (a: Book, b: Book) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  author: (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title),
  oldest: (a, b) => (a.year ?? 1e9) - (b.year ?? 1e9),
  newest: (a, b) => (b.year ?? -1e9) - (a.year ?? -1e9),
  added: (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id,
  popular: (a, b) => b.timesBorrowed - a.timesBorrowed || b.ratingCount - a.ratingCount,
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.ratingCount - a.ratingCount,
};

async function searchBooks(params: URLSearchParams) {
  let { books } = await load<{ books: Book[] }>('books.json');
  const q = params.get('q')?.trim();
  let ranked = new Map<number, number>();
  if (q) {
    const terms = fold(q).match(/[a-z0-9]+/g) ?? [];
    books = books.filter((b) => {
      const s = score(b, terms);
      if (s) ranked.set(b.id, s);
      return s > 0;
    });
  }
  const subject = params.get('subject');
  if (subject) books = books.filter((b) => b.subjects.some((s) => s.toLowerCase() === subject.toLowerCase()));
  const author = params.get('author');
  if (author) books = books.filter((b) => b.author.toLowerCase() === author.toLowerCase());
  if (params.get('available') === '1') books = books.filter((b) => b.available > 0);
  if (params.get('readable') === '1') books = books.filter((b) => b.readable);
  const era = ERAS[params.get('era') ?? ''];
  if (era) books = books.filter((b) => b.year != null && b.year >= era[0] && b.year <= era[1]);

  const sort = SORTS[params.get('sort') ?? ''];
  books = [...books].sort(sort ?? (q ? (a, b) => ranked.get(b.id)! - ranked.get(a.id)! : SORTS.title));
  const limit = Math.min(60, Math.max(1, Number(params.get('limit')) || 24));
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { total: books.length, page, pages: Math.ceil(books.length / limit), books: books.slice((page - 1) * limit, page * limit) };
}

async function findInBook(slug: string, q: string) {
  const text = await load<TextFile>(`text/${slug}.json`);
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (q.trim().length < 2) return { results: [], total: 0 };
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'gi');
  const results = [];
  let total = 0;
  for (const s of text.sections) {
    for (const m of s.body.matchAll(pattern)) {
      total++;
      if (results.length >= 100) continue;
      const at = m.index!;
      const end = at + m[0].length;
      const from = Math.max(0, at - 70);
      const to = Math.min(s.body.length, end + 70);
      results.push({
        idx: s.idx,
        title: s.title,
        position: at / Math.max(1, s.body.length),
        before: (from > 0 ? '…' : '') + s.body.slice(from, at).replace(/\s+/g, ' '),
        match: m[0].replace(/\s+/g, ' '),
        after: s.body.slice(end, to).replace(/\s+/g, ' ') + (to < s.body.length ? '…' : ''),
      });
    }
  }
  return { results, total };
}

/** Answer a GET request from static data, or throw for anything that needs a server. */
export async function staticGet(path: string): Promise<unknown> {
  const url = new URL(path, 'http://x');
  const p = url.pathname;
  let m: RegExpMatchArray | null;
  if (p === '/auth/me') return { user: null };
  if (p === '/home') return load('home.json');
  if (p === '/books') return searchBooks(url.searchParams);
  if (p === '/subjects') return load('subjects.json');
  if (p === '/authors') return load('authors.json');
  if ((m = p.match(/^\/collections\/([\w-]+)$/))) return load(`collections/${m[1]}.json`);
  if ((m = p.match(/^\/books\/([\w-]+)\/toc$/))) {
    const t = await load<TextFile>(`text/${m[1]}.json`).catch(() => {
      throw new Error('This title is in our print collection only.');
    });
    return { sections: t.sections.map(({ idx, title, words }) => ({ idx, title, words })), totalWords: t.totalWords };
  }
  if ((m = p.match(/^\/books\/([\w-]+)\/sections\/(\d+)$/))) {
    const t = await load<TextFile>(`text/${m[1]}.json`);
    const s = t.sections[Number(m[2])];
    if (!s) throw new Error('That part of the book doesn’t exist.');
    return { ...s, count: t.sections.length };
  }
  if ((m = p.match(/^\/books\/([\w-]+)\/find$/))) return findInBook(m[1]!, url.searchParams.get('q') ?? '');
  if ((m = p.match(/^\/books\/([\w-]+)$/))) return load(`books/${m[1]}.json`);
  throw new Error(NO_SERVER_MESSAGE);
}
