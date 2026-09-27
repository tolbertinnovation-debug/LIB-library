// Project Gutenberg integration: search (via the Gutendex API), and fetching
// full texts on demand so any public-domain title can open in the reader.
import { guessStrategy, splitSections, stripGutenbergBoilerplate } from './text.js';
import { HttpError } from './util.js';

const GUTENDEX = 'https://gutendex.com/books';
const TEXT_URLS = (id) => [
  `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
  `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
  `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`,
];
const TIMEOUT_MS = 15000;

async function fetchWithTimeout(fetchImpl, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'LiberiaOnlineLibrary/1.0 (+https://github.com/)' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch and split a Gutenberg text. Throws HttpError(502) if unreachable. */
export async function fetchGutenbergSections(id, { fetchImpl = fetch } = {}) {
  let lastError;
  for (const url of TEXT_URLS(id)) {
    try {
      const res = await fetchWithTimeout(fetchImpl, url);
      if (!res.ok) {
        lastError = new Error(`${url} -> ${res.status}`);
        continue;
      }
      const text = stripGutenbergBoilerplate(await res.text());
      if (text.length < 500) {
        lastError = new Error(`${url} returned too little text`);
        continue;
      }
      return splitSections(text, guessStrategy(text));
    } catch (err) {
      lastError = err;
    }
  }
  throw new HttpError(
    502,
    'We couldn’t reach Project Gutenberg to fetch this book just now. Please try again in a moment.',
    { cause: String(lastError?.message || lastError) },
  );
}

const searchCache = new Map();

/** Search Project Gutenberg's catalog of 70,000+ public-domain books. */
export async function searchGutenberg(query, { page = 1, fetchImpl = fetch } = {}) {
  const key = `${query}::${page}`;
  const hit = searchCache.get(key);
  if (hit && hit.at > Date.now() - 10 * 60 * 1000) return hit.data;

  const url = `${GUTENDEX}?search=${encodeURIComponent(query)}&page=${page}`;
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, url);
  } catch {
    throw new HttpError(502, 'Project Gutenberg search is unreachable right now.');
  }
  if (!res.ok) throw new HttpError(502, 'Project Gutenberg search is unreachable right now.');
  const json = await res.json();
  const data = {
    count: json.count ?? 0,
    next: Boolean(json.next),
    results: (json.results || []).map(normalizeGutendex),
  };
  searchCache.set(key, { at: Date.now(), data });
  if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
  return data;
}

export async function getGutenbergBook(id, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${GUTENDEX}/${id}`);
  } catch {
    throw new HttpError(502, 'Project Gutenberg is unreachable right now.');
  }
  if (res.status === 404) throw new HttpError(404, 'No Project Gutenberg book with that number.');
  if (!res.ok) throw new HttpError(502, 'Project Gutenberg is unreachable right now.');
  return normalizeGutendex(await res.json());
}

function normalizeGutendex(b) {
  const author = (b.authors || [])
    .map((a) => {
      // Gutendex gives "Austen, Jane"; show "Jane Austen".
      const [last, first] = String(a.name || '').split(', ');
      return first ? `${first} ${last}` : last;
    })
    .join(' & ');
  const subjects = [...new Set([...(b.subjects || []), ...(b.bookshelves || [])])]
    .map((s) => s.replace(/^Browsing: /, '').split(' -- ')[0].trim())
    .filter(Boolean);
  return {
    gutenbergId: b.id,
    title: String(b.title || 'Untitled').replace(/\s*\$[^$]*$/, '').trim(),
    author: author || 'Unknown',
    subjects: [...new Set(subjects)].slice(0, 6),
    languages: b.languages || [],
    downloads: b.download_count ?? 0,
    cover: b.formats?.['image/jpeg'] || null,
    birthYear: b.authors?.[0]?.birth_year ?? null,
  };
}
