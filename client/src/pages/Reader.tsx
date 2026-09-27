import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { del, get, patch, post, put } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { ListenPlayer } from '../components/ListenPlayer';
import { useApi, useDebounced, useDocumentTitle, useStoredState, readStorage, writeStorage, invalidate } from '../hooks';
import { IS_STATIC, NO_SERVER_MESSAGE } from '../staticApi';
import { useToast } from '../toast';
import type { BookDetail, Bookmark, Section, TocEntry } from '../types';

type Panel = 'toc' | 'search' | 'notes' | 'settings' | null;
type ReaderTheme = 'paper' | 'sepia' | 'night';

interface Settings {
  fontSize: number;
  lineHeight: number;
  width: 'narrow' | 'medium' | 'wide';
  font: 'serif' | 'sans';
  theme: ReaderTheme;
  justify: boolean;
}

const DEFAULTS: Settings = { fontSize: 20, lineHeight: 1.7, width: 'medium', font: 'serif', theme: 'paper', justify: false };
const WIDTHS = { narrow: '34em', medium: '40em', wide: '50em' };

interface Toc {
  sections: TocEntry[];
  totalWords: number;
}

interface FindResult {
  idx: number;
  title: string;
  position: number;
  before: string;
  match: string;
  after: string;
}

// ── Text rendering ────────────────────────────────────────────────────────────

function inline(text: string): ReactNode[] {
  // Gutenberg texts mark italics with _underscores_.
  const parts = text.split(/(_[^_\n]+_)/g);
  return parts.map((p, i) =>
    p.length > 2 && p.startsWith('_') && p.endsWith('_') ? <em key={i}>{p.slice(1, -1)}</em> : <Fragment key={i}>{p}</Fragment>,
  );
}

function prose(s: string) {
  return s.replace(/--/g, '—').replace(/\s*\n\s*/g, ' ').trim();
}

const Paragraphs = function Paragraphs({ body, verse }: { body: string; verse: boolean }) {
  const blocks = useMemo(() => body.split(/\n\s*\n/).filter((b) => b.trim()), [body]);
  return (
    <>
      {blocks.map((b, i) => {
        const trimmed = b.trim();
        const heading = trimmed.length < 70 && !/[a-z]/.test(trimmed) && /[A-Z]{3}/.test(trimmed);
        if (heading) {
          return (
            <h3 key={i} className="r-subhead" data-p={i}>
              {trimmed}
            </h3>
          );
        }
        if (verse) {
          return (
            <p key={i} className="r-verse" data-p={i}>
              {inline(b.replace(/^\n+|\s+$/g, '').replace(/--/g, '—'))}
            </p>
          );
        }
        return (
          <p key={i} data-p={i}>
            {inline(prose(b))}
          </p>
        );
      })}
    </>
  );
};

// ── Reader ────────────────────────────────────────────────────────────────────

export default function Reader() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const detail = useApi<BookDetail>(`/books/${slug}`);
  const book = detail.data?.book;
  const [toc, setToc] = useState<Toc | null>(null);
  const [tocError, setTocError] = useState<string | null>(null);
  const [idx, setIdx] = useState<number | null>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [settings, setSettings] = useStoredState<Settings>('lol-reader', DEFAULTS);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [position, setPosition] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const pendingPosition = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [listening, setListening] = useState(() => params.get('listen') === '1');
  const autoListen = useRef(params.get('listen') === '1');
  const lastSaved = useRef({ at: 0, idx: -1, pos: -1 });
  const activeMinutes = useRef(0);
  const lastActivity = useRef(Date.now());

  useDocumentTitle(book ? `Reading ${book.title}` : 'Reader');
  const s = { ...DEFAULTS, ...settings };

  // Load the table of contents (this may fetch the text from Project Gutenberg).
  useEffect(() => {
    let cancelled = false;
    setToc(null);
    setTocError(null);
    get<Toc>(`/books/${slug}/toc`)
      .then((t) => !cancelled && setToc(t))
      .catch((e: Error) => !cancelled && setTocError(e.message));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Decide where to open: ?s= in the URL, then saved progress.
  useEffect(() => {
    if (!toc || !detail.data || idx !== null) return;
    const fromUrl = params.get('s');
    const fromPos = params.get('p');
    if (fromUrl != null) {
      setIdx(Math.min(toc.sections.length - 1, Math.max(0, Number(fromUrl) || 0)));
      pendingPosition.current = fromPos ? Number(fromPos) : 0;
      return;
    }
    const saved = user ? detail.data.progress : readStorage<{ sectionIdx: number; position: number } | null>(`lol-progress-${slug}`, null);
    if (saved) {
      setIdx(Math.min(toc.sections.length - 1, saved.sectionIdx));
      pendingPosition.current = saved.position ?? 0;
    } else {
      setIdx(0);
      pendingPosition.current = 0;
    }
  }, [toc, detail.data, idx, params, user, slug]);

  // Load the current section.
  useEffect(() => {
    if (idx === null) return;
    let cancelled = false;
    setSectionError(null);
    get<Section>(`/books/${slug}/sections/${idx}`)
      .then((sec) => {
        if (cancelled) return;
        setSection(sec);
      })
      .catch((e: Error) => !cancelled && setSectionError(e.message));
    // Keep ?s= in sync so a refresh or shared link opens the same place.
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('s', String(idx));
        n.delete('p');
        n.delete('listen');
        return n;
      },
      { replace: true },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, slug]);

  // After a section renders, restore the scroll position.
  useEffect(() => {
    if (!section || section.idx !== idx) return;
    const target = pendingPosition.current ?? 0;
    pendingPosition.current = null;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: Math.max(0, target * max), behavior: 'instant' as ScrollBehavior });
      setPosition(target);
    });
  }, [section, idx]);

  // Bookmarks for signed-in readers.
  useEffect(() => {
    if (!user) return;
    get<{ bookmarks: Bookmark[] }>(`/books/${slug}/bookmarks`)
      .then((r) => setBookmarks(r.bookmarks))
      .catch(() => undefined);
  }, [user, slug]);

  const percent = useMemo(() => {
    if (!toc || idx === null || !toc.totalWords) return 0;
    const before = toc.sections.slice(0, idx).reduce((a, t) => a + t.words, 0);
    const here = toc.sections[idx]?.words ?? 0;
    return Math.min(100, ((before + here * position) / toc.totalWords) * 100);
  }, [toc, idx, position]);

  const saveProgress = useCallback(
    (force = false) => {
      if (idx === null || !section) return;
      const now = Date.now();
      const minutes = activeMinutes.current;
      const unchanged = lastSaved.current.idx === idx && Math.abs(lastSaved.current.pos - position) < 0.005;
      if (!force && (now - lastSaved.current.at < 4000 || (unchanged && minutes < 0.5))) return;
      lastSaved.current = { at: now, idx, pos: position };
      if (!user) {
        writeStorage(`lol-progress-${slug}`, { sectionIdx: idx, position });
        return;
      }
      activeMinutes.current = 0;
      fetch(`/api/books/${slug}/progress`, {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionIdx: idx, position, percent, minutes: Math.min(5, minutes) }),
      }).catch(() => {
        activeMinutes.current += minutes;
      });
    },
    [idx, section, position, percent, user, slug],
  );

  // Track scroll position, hide chrome while reading down.
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      lastActivity.current = Date.now();
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setPosition(max > 0 ? Math.min(1, Math.max(0, y / max)) : 1);
        if (Math.abs(y - lastY) > 8) {
          setChromeVisible(y < lastY || y < 80);
          lastY = y;
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Count active reading time: visible tab + recent activity.
  useEffect(() => {
    const bump = () => (lastActivity.current = Date.now());
    const events = ['keydown', 'mousemove', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity.current < 120_000) activeMinutes.current += 0.25;
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(timer);
    };
  }, []);

  const debouncedPos = useDebounced(position, 1200);
  useEffect(() => saveProgress(), [debouncedPos, saveProgress]);

  // Save when leaving: tab hidden, page closed, or component unmounted.
  const saveRef = useRef(saveProgress);
  saveRef.current = saveProgress;
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && saveRef.current(true);
    const onUnload = () => saveRef.current(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onUnload);
      saveRef.current(true);
      invalidate(`/books/${slug}`, '/me', '/home');
    };
  }, [slug]);

  const goTo = useCallback(
    (next: number, pos = 0) => {
      if (!toc) return;
      const clamped = Math.max(0, Math.min(toc.sections.length - 1, next));
      saveRef.current(true);
      if (clamped === idx) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: pos * max, behavior: 'smooth' });
      } else {
        pendingPosition.current = pos;
        setSection(null);
        setIdx(clamped);
      }
      setPanel((p) => (p === 'settings' ? p : null));
    },
    [toc, idx],
  );

  const addBookmark = useCallback(async () => {
    if (!user) {
      toast(IS_STATIC ? NO_SERVER_MESSAGE : 'Sign in to save bookmarks and notes.', 'info');
      return;
    }
    if (idx === null) return;
    const sel = window.getSelection();
    const fromSelection = Boolean(sel && !sel.isCollapsed && contentRef.current?.contains(sel.anchorNode) && sel.toString().trim());
    let excerpt = fromSelection ? sel!.toString() : '';
    if (!excerpt) {
      // The first paragraph whose top is on screen.
      const paras = contentRef.current?.querySelectorAll<HTMLElement>('[data-p]') ?? [];
      for (const p of paras) {
        const r = p.getBoundingClientRect();
        if (r.bottom > 80) {
          excerpt = p.textContent ?? '';
          break;
        }
      }
    }
    excerpt = excerpt.replace(/\s+/g, ' ').trim().slice(0, 280);
    try {
      const r = await post<{ bookmark: Bookmark }>(`/books/${slug}/bookmarks`, { sectionIdx: idx, position, excerpt });
      setBookmarks((b) => [...b, r.bookmark].sort((a, c) => a.sectionIdx - c.sectionIdx || a.position - c.position));
      sel?.removeAllRanges();
      toast(fromSelection ? 'Quote saved to your notes.' : 'Bookmarked.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }, [user, idx, position, slug, toast]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' && idx !== null) goTo(idx + 1);
      else if (e.key === 'ArrowLeft' && idx !== null) goTo(idx - 1);
      else if (e.key === 'b') addBookmark();
      else if (e.key === 'l') setListening((l) => !l);
      else if (e.key === 't') setPanel((p) => (p === 'toc' ? null : 'toc'));
      else if (e.key === '/' || e.key === 'f') {
        e.preventDefault();
        setPanel('search');
      } else if (e.key === 'Escape') setPanel(null);
      else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, goTo, addBookmark]);

  const markFinished = async () => {
    if (!user) {
      navigate(`/signin?next=/books/${slug}`);
      return;
    }
    await put(`/books/${slug}/shelf`, { status: 'finished' });
    invalidate('/me', `/books/${slug}`);
    toast('Marked as finished. Congratulations!', 'success');
    navigate(`/books/${slug}#reviews`);
  };

  const style = {
    '--r-size': `${s.fontSize}px`,
    '--r-leading': s.lineHeight,
    '--r-measure': WIDTHS[s.width],
  } as CSSProperties;

  const count = toc?.sections.length ?? 0;
  const isLast = idx !== null && idx === count - 1;
  const minutesLeft = section ? Math.max(1, Math.round((section.words * (1 - position)) / 230)) : 0;
  const sectionBookmarks = bookmarks.filter((b) => b.sectionIdx === idx);

  return (
    <div className={`reader reader-${s.theme} reader-font-${s.font} ${s.justify ? 'reader-justify' : ''} ${listening ? 'reader-listening' : ''}`} style={style}>
      <header className={`reader-bar ${chromeVisible || panel ? '' : 'hidden'}`}>
        <Link to={`/books/${slug}`} className="icon-btn" aria-label="Back to book page">
          <Icon name="arrowLeft" />
        </Link>
        <div className="reader-bar-title">
          <strong>{book?.title ?? ' '}</strong>
          <span>{section?.title ?? ''}</span>
        </div>
        <div className="reader-bar-actions">
          <button className={`icon-btn ${listening ? 'on' : ''}`} onClick={() => setListening((l) => !l)} aria-label="Listen (l)" title="Listen — human narrator or read aloud (l)" aria-pressed={listening}>
            <Icon name="headphones" />
          </button>
          <button className={`icon-btn ${panel === 'toc' ? 'on' : ''}`} onClick={() => setPanel(panel === 'toc' ? null : 'toc')} aria-label="Contents (t)" title="Contents (t)">
            <Icon name="list" />
          </button>
          <button className={`icon-btn ${panel === 'search' ? 'on' : ''}`} onClick={() => setPanel(panel === 'search' ? null : 'search')} aria-label="Search in book (/)" title="Search in book (/)">
            <Icon name="search" />
          </button>
          <button className="icon-btn" onClick={addBookmark} aria-label="Bookmark this spot (b)" title="Bookmark this spot — or select text first to save a quote (b)">
            <Icon name="bookmark" />
          </button>
          <button className={`icon-btn ${panel === 'notes' ? 'on' : ''}`} onClick={() => setPanel(panel === 'notes' ? null : 'notes')} aria-label="Bookmarks and notes" title="Bookmarks and notes">
            <Icon name="quote" />
          </button>
          <button className={`icon-btn ${panel === 'settings' ? 'on' : ''}`} onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="Reading settings" title="Reading settings">
            <Icon name="type" />
          </button>
        </div>
        <div className="reader-bar-progress" aria-hidden>
          <span style={{ width: `${percent}%` }} />
        </div>
      </header>

      {panel && (
        <aside className="reader-panel" aria-label="Reader panel">
          <div className="reader-panel-head">
            <h2>{{ toc: 'Contents', search: 'Search this book', notes: 'Bookmarks & notes', settings: 'Reading settings' }[panel]}</h2>
            <button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close panel">
              <Icon name="x" />
            </button>
          </div>
          {panel === 'toc' && toc && <TocPanel toc={toc} current={idx} bookmarks={bookmarks} onPick={(i) => goTo(i)} />}
          {panel === 'search' && <SearchPanel slug={slug} onPick={(r) => goTo(r.idx, r.position)} />}
          {panel === 'notes' && (
            <NotesPanel
              signedIn={Boolean(user)}
              bookmarks={bookmarks}
              onPick={(b) => goTo(b.sectionIdx, b.position)}
              onDelete={async (b) => {
                await del(`/bookmarks/${b.id}`);
                setBookmarks((all) => all.filter((x) => x.id !== b.id));
              }}
              onNote={async (b, note) => {
                await patch(`/bookmarks/${b.id}`, { note }).catch(() => undefined);
                setBookmarks((all) => all.map((x) => (x.id === b.id ? { ...x, note } : x)));
              }}
            />
          )}
          {panel === 'settings' && <SettingsPanel settings={s} onChange={(p) => setSettings({ ...s, ...p })} />}
        </aside>
      )}

      <main className="reader-main">
        {tocError && (
          <div className="reader-message">
            <Icon name="book" size={40} />
            <p>{tocError}</p>
            <div className="row gap-sm center">
              <button className="btn" onClick={() => window.location.reload()}>
                Try again
              </button>
              <Link className="btn" to={`/books/${slug}`}>
                Back to the book
              </Link>
            </div>
          </div>
        )}
        {!tocError && !section && !sectionError && (
          <div className="reader-message">
            <span className="spinner" />
            <p>{toc ? 'Opening…' : book && !book.hasText ? 'Fetching this book from Project Gutenberg… (first time only)' : 'Opening the book…'}</p>
          </div>
        )}
        {sectionError && (
          <div className="reader-message">
            <p>{sectionError}</p>
          </div>
        )}
        {section && book && (
          <article className="reader-content" ref={contentRef} lang={book.language}>
            {section.idx === 0 && (
              <header className="reader-titlepage">
                <p className="reader-titlepage-author">{book.author}</p>
                <h1>{book.title}</h1>
                <div className="reader-star" aria-hidden>
                  ★
                </div>
              </header>
            )}
            <h2 className="reader-section-title">{section.title}</h2>
            {sectionBookmarks.length > 0 && (
              <p className="reader-bm-hint">
                <Icon name="bookmark" size={14} /> {sectionBookmarks.length} bookmark{sectionBookmarks.length > 1 ? 's' : ''} in this part
              </p>
            )}
            <Paragraphs body={section.body} verse={book.verse} />

            <nav className="reader-next" aria-label="Chapter navigation">
              {idx! > 0 ? (
                <button className="btn" onClick={() => goTo(idx! - 1)}>
                  <Icon name="chevronLeft" size={18} /> {toc?.sections[idx! - 1]?.title}
                </button>
              ) : (
                <span />
              )}
              {!isLast ? (
                <button className="btn btn-primary" onClick={() => goTo(idx! + 1)}>
                  {toc?.sections[idx! + 1]?.title} <Icon name="chevronRight" size={18} />
                </button>
              ) : (
                <div className="reader-finish">
                  <p className="reader-star" aria-hidden>
                    ★
                  </p>
                  <p>You’ve reached the end of {book.title}.</p>
                  <button className="btn btn-primary" onClick={markFinished}>
                    Mark as finished & review
                  </button>
                </div>
              )}
            </nav>
          </article>
        )}
      </main>

      {listening && book && (
        <ListenPlayer
          sectionIdx={idx}
          sectionCount={count}
          containerRef={contentRef}
          sectionKey={section ? `${slug}:${section.idx}` : null}
          lang={book.language}
          title={book.title}
          author={book.author}
          sectionTitle={section?.title ?? ''}
          hasNext={!isLast}
          autoStart={autoListen.current}
          onNeedNext={() => idx !== null && goTo(idx + 1)}
          onClose={() => {
            autoListen.current = false;
            setListening(false);
          }}
        />
      )}

      <footer className={`reader-foot ${chromeVisible || panel ? '' : 'hidden'} ${listening ? 'with-player' : ''}`}>
        <span>
          {idx !== null && count > 0 && `Part ${idx + 1} of ${count}`}
          {section && ` · ${minutesLeft} min left in this part`}
        </span>
        <span>{Math.round(percent)}%</span>
      </footer>
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────────────────────

function TocPanel({ toc, current, bookmarks, onPick }: { toc: Toc; current: number | null; bookmarks: Bookmark[]; onPick: (i: number) => void }) {
  const currentRef = useRef<HTMLLIElement>(null);
  useEffect(() => currentRef.current?.scrollIntoView({ block: 'center' }), []);
  const marked = new Set(bookmarks.map((b) => b.sectionIdx));
  return (
    <ol className="reader-toc">
      {toc.sections.map((t) => (
        <li key={t.idx} ref={t.idx === current ? currentRef : undefined} className={t.idx === current ? 'current' : ''}>
          <button onClick={() => onPick(t.idx)}>
            <span>{t.title}</span>
            {marked.has(t.idx) && <Icon name="bookmark" size={13} />}
            <span className="muted">{Math.max(1, Math.round(t.words / 230))}m</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function SearchPanel({ slug, onPick }: { slug: string; onPick: (r: FindResult) => void }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 300);
  const { data, loading } = useApi<{ results: FindResult[]; total: number }>(debounced.trim().length >= 2 ? `/books/${slug}/find?q=${encodeURIComponent(debounced.trim())}` : null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="reader-search">
      <div className="input-icon">
        <Icon name="search" size={18} />
        <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a word or phrase" aria-label="Find in book" />
      </div>
      {loading && <p className="muted small">Searching…</p>}
      {data && debounced.trim().length >= 2 && (
        <p className="muted small">
          {data.total === 0 ? 'No matches.' : `${data.total.toLocaleString()} match${data.total === 1 ? '' : 'es'}${data.total > data.results.length ? ` · showing first ${data.results.length}` : ''}`}
        </p>
      )}
      <ul className="find-results">
        {data?.results.map((r, i) => (
          <li key={i}>
            <button onClick={() => onPick(r)}>
              <span className="find-where">{r.title}</span>
              <span className="find-snippet">
                {r.before}
                <mark>{r.match}</mark>
                {r.after}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotesPanel({
  signedIn,
  bookmarks,
  onPick,
  onDelete,
  onNote,
}: {
  signedIn: boolean;
  bookmarks: Bookmark[];
  onPick: (b: Bookmark) => void;
  onDelete: (b: Bookmark) => void;
  onNote: (b: Bookmark, note: string) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  if (!signedIn) {
    return (
      <p className="muted">
        <Link to="/signin">Sign in</Link> to keep bookmarks, quotes and notes — they’ll follow you to every device.
      </p>
    );
  }
  if (!bookmarks.length) {
    return (
      <div className="muted">
        <p>No bookmarks yet.</p>
        <p className="small">
          Press <kbd className="kbd">b</kbd> or the bookmark button to mark your spot. Select a passage first to save it as a quote.
        </p>
      </div>
    );
  }
  return (
    <ul className="notes-list">
      {bookmarks.map((b) => (
        <li key={b.id}>
          <button className="note-jump" onClick={() => onPick(b)}>
            <span className="find-where">{b.sectionTitle}</span>
            {b.excerpt && <span className="note-excerpt">“{b.excerpt}”</span>}
          </button>
          {editing === b.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onNote(b, draft);
                setEditing(null);
              }}
            >
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus aria-label="Note" />
              <div className="row gap-sm">
                <button className="btn btn-sm btn-primary">Save note</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {b.note && <p className="note-text">{b.note}</p>}
              <div className="row gap-sm">
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setDraft(b.note);
                    setEditing(b.id);
                  }}
                >
                  <Icon name="edit" size={14} /> {b.note ? 'Edit note' : 'Add note'}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => onDelete(b)}>
                  <Icon name="trash" size={14} /> Remove
                </button>
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function SettingsPanel({ settings, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  return (
    <div className="reader-settings">
      <div className="setting">
        <span className="field-label">Theme</span>
        <div className="theme-swatches">
          {(['paper', 'sepia', 'night'] as ReaderTheme[]).map((t) => (
            <button key={t} className={`swatch swatch-${t} ${settings.theme === t ? 'on' : ''}`} onClick={() => onChange({ theme: t })} aria-pressed={settings.theme === t}>
              Aa
              <span>{t[0]!.toUpperCase() + t.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <span className="field-label">Text size</span>
        <div className="stepper">
          <button className="btn" onClick={() => onChange({ fontSize: Math.max(14, settings.fontSize - 1) })} aria-label="Smaller text">
            A−
          </button>
          <span>{settings.fontSize}px</span>
          <button className="btn" onClick={() => onChange({ fontSize: Math.min(32, settings.fontSize + 1) })} aria-label="Larger text">
            A+
          </button>
        </div>
      </div>
      <div className="setting">
        <label className="field-label" htmlFor="leading">
          Line spacing
        </label>
        <input id="leading" type="range" min={1.3} max={2.2} step={0.05} value={settings.lineHeight} onChange={(e) => onChange({ lineHeight: Number(e.target.value) })} />
      </div>
      <div className="setting">
        <span className="field-label">Typeface</span>
        <div className="segmented">
          <button aria-pressed={settings.font === 'serif'} onClick={() => onChange({ font: 'serif' })} className="font-serif-sample">
            Serif
          </button>
          <button aria-pressed={settings.font === 'sans'} onClick={() => onChange({ font: 'sans' })}>
            Sans
          </button>
        </div>
      </div>
      <div className="setting">
        <span className="field-label">Page width</span>
        <div className="segmented">
          {(['narrow', 'medium', 'wide'] as const).map((w) => (
            <button key={w} aria-pressed={settings.width === w} onClick={() => onChange({ width: w })}>
              {w[0]!.toUpperCase() + w.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={settings.justify} onChange={(e) => onChange({ justify: e.target.checked })} /> Justify text
      </label>
      <button className="btn btn-ghost" onClick={() => onChange(DEFAULTS)}>
        Reset to defaults
      </button>
      <div className="shortcuts">
        <span className="field-label">Keyboard</span>
        <dl>
          <dt>
            <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd>
          </dt>
          <dd>Previous / next part</dd>
          <dt>
            <kbd className="kbd">b</kbd>
          </dt>
          <dd>Bookmark (select text to save a quote)</dd>
          <dt>
            <kbd className="kbd">t</kbd>
          </dt>
          <dd>Contents</dd>
          <dt>
            <kbd className="kbd">/</kbd>
          </dt>
          <dd>Search in book</dd>
        </dl>
      </div>
    </div>
  );
}
