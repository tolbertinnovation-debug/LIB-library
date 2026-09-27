import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Availability, BookCard, BookRow, Empty, ErrorState, SkeletonGrid, Stars } from '../components/ui';
import { formatYear, plural } from '../format';
import { useApi, useDebounced, useDocumentTitle, useStoredState } from '../hooks';
import type { SearchResult } from '../types';

const ERAS = [
  { id: '', label: 'Any time' },
  { id: 'ancient', label: 'Before 1500' },
  { id: 'early', label: '1500–1799' },
  { id: 'c19', label: '1800s' },
  { id: 'c20', label: '1900s' },
  { id: 'c21', label: '2000s' },
];

const SORTS = [
  { id: '', label: 'Best match' },
  { id: 'title', label: 'Title A–Z' },
  { id: 'author', label: 'Author A–Z' },
  { id: 'popular', label: 'Most borrowed' },
  { id: 'rating', label: 'Highest rated' },
  { id: 'newest', label: 'Newest published' },
  { id: 'oldest', label: 'Oldest published' },
  { id: 'added', label: 'Recently added' },
];

export default function Browse() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useStoredState<'grid' | 'list'>('lol-browse-view', 'grid');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const debounced = useDebounced(draft, 300);

  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (debounced === q) return;
    update({ q: debounced || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: 'q' in changes && Object.keys(changes).length <= 2 });
  }

  const apiParams = new URLSearchParams(params);
  apiParams.set('limit', '24');
  const { data, error, loading, reload } = useApi<SearchResult>(`/books?${apiParams.toString()}`);
  const subjects = useApi<{ subjects: { name: string; count: number }[] }>('/subjects');

  const subject = params.get('subject');
  const author = params.get('author');
  const era = params.get('era') ?? '';
  const sort = params.get('sort') ?? '';
  const page = Number(params.get('page') ?? 1);

  useDocumentTitle(q ? `“${q}”` : subject ?? author ?? 'Browse the catalog');

  const heading = author ? `Books by ${author}` : subject ? subject : q ? `Results for “${q}”` : 'The catalog';

  const active: { label: string; clear: Record<string, null> }[] = [];
  if (subject) active.push({ label: subject, clear: { subject: null } });
  if (author) active.push({ label: `by ${author}`, clear: { author: null } });
  if (era) active.push({ label: ERAS.find((e) => e.id === era)?.label ?? era, clear: { era: null } });
  if (params.get('readable')) active.push({ label: 'Read free online', clear: { readable: null } });
  if (params.get('available')) active.push({ label: 'On the shelf now', clear: { available: null } });

  return (
    <div className="container browse">
      <div className="page-head">
        <div>
          <p className="eyebrow">Browse</p>
          <h1>{heading}</h1>
          {data && <p className="muted">{plural(data.total, 'title')}</p>}
        </div>
      </div>

      <div className="browse-layout">
        <aside className={`filters ${filtersOpen ? 'open' : ''}`} aria-label="Filters">
          <div className="filter-group">
            <label className="field-label" htmlFor="browse-q">
              Search within the catalog
            </label>
            <div className="input-icon">
              <Icon name="search" size={18} />
              <input id="browse-q" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Title, author, subject…" />
            </div>
          </div>
          <div className="filter-group">
            <span className="field-label">Format</span>
            <label className="check">
              <input type="checkbox" checked={params.get('readable') === '1'} onChange={(e) => update({ readable: e.target.checked ? '1' : null, page: null })} />
              Read free online
            </label>
            <label className="check">
              <input type="checkbox" checked={params.get('available') === '1'} onChange={(e) => update({ available: e.target.checked ? '1' : null, page: null })} />
              Copies on the shelf now
            </label>
          </div>
          <div className="filter-group">
            <span className="field-label">Published</span>
            {ERAS.map((e) => (
              <label key={e.id} className="check">
                <input type="radio" name="era" checked={era === e.id} onChange={() => update({ era: e.id || null, page: null })} />
                {e.label}
              </label>
            ))}
          </div>
          <div className="filter-group">
            <span className="field-label">Subjects</span>
            <div className="subject-cloud">
              {subjects.data?.subjects.map((s) => (
                <button
                  key={s.name}
                  className={`chip chip-sm ${subject === s.name ? 'chip-on' : ''}`}
                  onClick={() => update({ subject: subject === s.name ? null : s.name, page: null })}
                  aria-pressed={subject === s.name}
                >
                  {s.name} <span className="chip-count">{s.count}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="results" aria-busy={loading}>
          <div className="results-bar">
            <button className="btn btn-ghost filters-toggle" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
              <Icon name="settings" size={18} /> Filters
            </button>
            <div className="active-filters">
              {active.map((a) => (
                <button key={a.label} className="chip chip-on chip-sm" onClick={() => update({ ...a.clear, page: null })}>
                  {a.label} <Icon name="x" size={14} />
                </button>
              ))}
            </div>
            <label className="sort">
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(e) => update({ sort: e.target.value || null, page: null })}>
                {SORTS.filter((s) => s.id || q).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented" role="group" aria-label="View">
              <button aria-pressed={view === 'grid'} onClick={() => setView('grid')} aria-label="Grid view">
                <Icon name="grid" size={18} />
              </button>
              <button aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label="List view">
                <Icon name="list" size={18} />
              </button>
            </div>
          </div>

          {error && <ErrorState error={error} onRetry={reload} />}
          {!data && !error && <SkeletonGrid />}
          {data && data.total === 0 && (
            <Empty icon="search" title="No books match that yet">
              <p>
                Try a different spelling, remove a filter, or <Link to={`/discover${q ? `?q=${encodeURIComponent(q)}` : ''}`}>search 70,000 more free books</Link>.
              </p>
            </Empty>
          )}
          {data && data.total > 0 && view === 'grid' && (
            <div className="book-grid">
              {data.books.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
          )}
          {data && data.total > 0 && view === 'list' && (
            <div className="book-list">
              {data.books.map((b) => (
                <BookRow key={b.id} book={b}>
                  <p className="book-row-desc">{b.description}</p>
                  <div className="row gap-sm wrap">
                    {b.ratingCount > 0 && <Stars value={b.rating} size={13} />}
                    <Availability book={b} />
                    {b.year != null && <span className="muted small">{formatYear(b.year)}</span>}
                  </div>
                </BookRow>
              ))}
            </div>
          )}

          {data && data.pages > 1 && (
            <nav className="pager" aria-label="Pages">
              <button className="btn" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                <Icon name="chevronLeft" size={18} /> Previous
              </button>
              <span className="muted">
                Page {page} of {data.pages}
              </span>
              <button className="btn" disabled={page >= data.pages} onClick={() => update({ page: String(page + 1) })}>
                Next <Icon name="chevronRight" size={18} />
              </button>
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
