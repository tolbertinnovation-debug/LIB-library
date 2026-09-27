import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { useAuth } from '../auth';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { Empty, Loading, Modal } from '../components/ui';
import { compact, plural } from '../format';
import { useApi, useDocumentTitle } from '../hooks';
import { useToast } from '../toast';

interface GutenbergBook {
  gutenbergId: number;
  title: string;
  author: string;
  subjects: string[];
  languages: string[];
  downloads: number;
  cover: string | null;
  slug: string | null;
}

interface OpenLibraryDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  edition_count?: number;
  subject?: string[];
}

type Source = 'gutenberg' | 'openlibrary';

export default function Discover() {
  useDocumentTitle('Discover');
  const [params, setParams] = useSearchParams();
  const source = (params.get('source') as Source) || 'gutenberg';
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (draft.trim()) next.set('q', draft.trim());
    else next.delete('q');
    setParams(next);
  };

  return (
    <div className="container discover">
      <div className="page-head">
        <div>
          <p className="eyebrow">Discover</p>
          <h1>Find any book in the world</h1>
          <p className="lede">
            Search <strong>70,000+ free e-books</strong> from Project Gutenberg and open them in our reader, or look up <strong>millions of titles</strong> in Open
            Library and ask us to add them to our shelves.
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={source === 'gutenberg'} className={source === 'gutenberg' ? 'on' : ''} onClick={() => setParams(q ? { q } : {})}>
          <Icon name="bookOpen" size={16} /> Free to read · Project Gutenberg
        </button>
        <button
          role="tab"
          aria-selected={source === 'openlibrary'}
          className={source === 'openlibrary' ? 'on' : ''}
          onClick={() => setParams(q ? { q, source: 'openlibrary' } : { source: 'openlibrary' })}
        >
          <Icon name="globe" size={16} /> Every book · Open Library
        </button>
      </div>

      <form className="hero-search discover-search" onSubmit={submit} role="search">
        <Icon name="search" size={22} />
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={source === 'gutenberg' ? 'Search free classics — e.g. “Dickens”, “Frankenstein”' : 'Search any title or author'}
          aria-label="Search"
        />
        <button className="btn btn-primary">Search</button>
      </form>

      {!q && (
        <div className="chips">
          {(source === 'gutenberg'
            ? ['Jane Austen', 'Sherlock Holmes', 'Africa', 'Poetry', 'Fairy tales', 'Philosophy', 'Frederick Douglass', 'Science fiction']
            : ['Chinua Achebe', 'Liberia history', 'Chimamanda Adichie', 'Wangari Maathai', 'Toni Morrison', 'Mathematics']
          ).map((s) => (
            <button key={s} className="chip" onClick={() => setParams(source === 'gutenberg' ? { q: s } : { q: s, source })}>
              {s}
            </button>
          ))}
        </div>
      )}

      {q && source === 'gutenberg' && <GutenbergResults q={q} />}
      {q && source === 'openlibrary' && <OpenLibraryResults q={q} />}
    </div>
  );
}

function GutenbergResults({ q }: { q: string }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q]);
  const { data, error, loading } = useApi<{ count: number; next: boolean; results: GutenbergBook[] }>(`/gutenberg/search?q=${encodeURIComponent(q)}&page=${page}`);
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  const open = async (b: GutenbergBook) => {
    if (b.slug) {
      navigate(`/read/${b.slug}`);
      return;
    }
    if (!user) {
      navigate(`/signin?next=${encodeURIComponent(`/discover?q=${q}`)}`);
      return;
    }
    setBusy(b.gutenbergId);
    try {
      const r = await post<{ slug: string }>(`/gutenberg/${b.gutenbergId}/add`);
      toast(`Added “${b.title}” to the library.`, 'success');
      navigate(`/read/${r.slug}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Loading label="Searching Project Gutenberg…" />;
  if (error) {
    return (
      <Empty icon="globe" title="Project Gutenberg is out of reach">
        <p>{error.message} You can still browse everything already in our catalog.</p>
        <Link to={`/browse?q=${encodeURIComponent(q)}`} className="btn">
          Search our catalog instead
        </Link>
      </Empty>
    );
  }
  if (!data) return null;
  if (!data.results.length) return <Empty icon="search" title="No free e-books matched" />;
  return (
    <>
      <p className="muted">{plural(data.count, 'free e-book')} found</p>
      <div className="discover-list">
        {data.results.map((b) => (
          <article key={b.gutenbergId} className="discover-item">
            <div className="discover-cover">
              {b.cover ? <img src={b.cover} alt="" loading="lazy" /> : <Cover title={b.title} author={b.author} seed={`pg${b.gutenbergId}`} size="sm" />}
            </div>
            <div className="discover-body">
              <h3>{b.title}</h3>
              <p className="muted">{b.author}</p>
              <p className="muted small">
                {b.subjects.slice(0, 3).join(' · ')}
                {b.downloads > 0 && ` · ${compact(b.downloads)} downloads`}
              </p>
            </div>
            <div className="discover-actions">
              <button className="btn btn-primary btn-sm" onClick={() => open(b)} disabled={busy === b.gutenbergId}>
                {b.slug ? 'Read now' : busy === b.gutenbergId ? 'Adding…' : 'Add & read'}
              </button>
              {b.slug && (
                <Link className="btn btn-sm btn-ghost" to={`/books/${b.slug}`}>
                  Details
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
      <nav className="pager">
        <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span className="muted">Page {page}</span>
        <button className="btn" disabled={!data.next} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </nav>
    </>
  );
}

function OpenLibraryResults({ q }: { q: string }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; docs: OpenLibraryDoc[]; total: number }>({ loading: true, error: null, docs: [], total: 0 });
  const [suggesting, setSuggesting] = useState<OpenLibraryDoc | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=24&fields=key,title,author_name,first_publish_year,cover_i,edition_count,subject`;
    fetch(url, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Open Library search failed');
        return r.json();
      })
      .then((j: { docs: OpenLibraryDoc[]; numFound: number }) => setState({ loading: false, error: null, docs: j.docs, total: j.numFound }))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setState({ loading: false, error: 'Open Library is out of reach right now.', docs: [], total: 0 });
      });
    return () => ctrl.abort();
  }, [q]);

  if (state.loading) return <Loading label="Searching Open Library…" />;
  if (state.error) return <Empty icon="globe" title={state.error} />;
  if (!state.docs.length) return <Empty icon="search" title="Nothing matched" />;
  return (
    <>
      <p className="muted">{plural(state.total, 'record')} in Open Library</p>
      <div className="discover-list">
        {state.docs.map((d) => {
          const author = d.author_name?.[0] ?? 'Unknown author';
          return (
            <article key={d.key} className="discover-item">
              <div className="discover-cover">
                {d.cover_i ? (
                  <img src={`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`} alt="" loading="lazy" />
                ) : (
                  <Cover title={d.title} author={author} seed={d.key} size="sm" />
                )}
              </div>
              <div className="discover-body">
                <h3>{d.title}</h3>
                <p className="muted">
                  {author}
                  {d.first_publish_year && ` · ${d.first_publish_year}`}
                </p>
                <p className="muted small">
                  {d.edition_count ? plural(d.edition_count, 'edition') : ''}
                  {d.subject?.length ? ` · ${d.subject.slice(0, 3).join(' · ')}` : ''}
                </p>
              </div>
              <div className="discover-actions">
                <Link className="btn btn-sm btn-ghost" to={`/browse?q=${encodeURIComponent(d.title)}`}>
                  In our catalog?
                </Link>
                <button className="btn btn-sm" onClick={() => setSuggesting(d)}>
                  Suggest for our shelves
                </button>
                <a className="btn btn-sm btn-ghost" href={`https://openlibrary.org${d.key}`} target="_blank" rel="noreferrer">
                  Open Library ↗
                </a>
              </div>
            </article>
          );
        })}
      </div>
      <SuggestModal doc={suggesting} onClose={() => setSuggesting(null)} />
    </>
  );
}

function SuggestModal({ doc, onClose }: { doc: OpenLibraryDoc | null; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!doc) return;
    try {
      await post('/suggestions', { title: doc.title, author: doc.author_name?.[0] ?? '', sourceKey: doc.key, note });
      toast('Thank you! Our librarians will review your suggestion.', 'success');
      setNote('');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <Modal open={Boolean(doc)} onClose={onClose} title="Suggest a purchase">
      {!user ? (
        <p>
          <Link to="/signin?next=/discover">Sign in</Link> to suggest books for the library.
        </p>
      ) : (
        doc && (
          <form onSubmit={submit} className="stack">
            <p>
              <strong>{doc.title}</strong>
              {doc.author_name?.[0] && ` by ${doc.author_name[0]}`}
            </p>
            <label className="field">
              <span>Why should we add it? (optional)</span>
              <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn btn-primary">Send suggestion</button>
          </form>
        )
      )}
    </Modal>
  );
}
