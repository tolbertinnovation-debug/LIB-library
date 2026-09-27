import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { del, patch, post, put } from '../api';
import { useAuth } from '../auth';
import { DailyBars } from '../components/charts';
import { Icon } from '../components/Icon';
import { BookRow, Empty, ErrorState, Loading, Modal } from '../components/ui';
import { dueLabel, formatDate, plural } from '../format';
import { invalidate, useApi, useDebounced, useDocumentTitle } from '../hooks';
import { useToast } from '../toast';
import type { Book, SearchResult, Suggestion, User } from '../types';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'loans', label: 'Loans', icon: 'library' },
  { id: 'checkout', label: 'Check out', icon: 'card' },
  { id: 'holds', label: 'Holds', icon: 'clock' },
  { id: 'catalog', label: 'Catalog', icon: 'book' },
  { id: 'members', label: 'Members', icon: 'user' },
  { id: 'requests', label: 'Requests', icon: 'inbox' },
] as const;

interface Overview {
  counts: Record<string, number>;
  checkouts: { day: string; count: number }[];
  mostWanted: Book[];
  topBorrowed: Book[];
}

interface DeskLoan {
  id: number;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  renewals: number;
  book: { slug: string; title: string; author: string };
  member: { name: string; email: string; cardNumber: string };
}

export default function Desk() {
  useDocumentTitle('Librarian desk');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  return (
    <div className="container desk">
      <div className="page-head">
        <div>
          <p className="eyebrow">Staff</p>
          <h1>Librarian desk</h1>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setParams(t.id === 'overview' ? {} : { tab: t.id })}>
            <Icon name={t.icon} size={16} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'loans' && <LoansTab />}
      {tab === 'checkout' && <CheckoutTab />}
      {tab === 'holds' && <HoldsTab />}
      {tab === 'catalog' && <CatalogTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'requests' && <RequestsTab />}
    </div>
  );
}

function OverviewTab() {
  const { data, error, reload } = useApi<Overview>('/admin/overview');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const c = data.counts;
  const tiles: [string, number, string?, string?][] = [
    ['Titles', c.titles!, `${c.readable} readable online`],
    ['Print copies', c.copies!],
    ['Members', c.members!, `+${c.newMembers30} in 30 days`],
    ['On loan', c.activeLoans!, `${c.dueSoon} due in 3 days`, '?tab=loans'],
    ['Overdue', c.overdue!, undefined, '?tab=loans&status=overdue'],
    ['Holds waiting', c.holdsWaiting!, `${c.holdsReady} ready for pickup`, '?tab=holds'],
    ['Open requests', c.openSuggestions!, undefined, '?tab=requests'],
  ];
  return (
    <div className="stack-lg">
      <div className="tile-grid">
        {tiles.map(([label, value, sub, to]) => {
          const inner = (
            <>
              <span className="tile-label">{label}</span>
              <span className="tile-value">{value.toLocaleString()}</span>
              {sub && <span className="tile-sub">{sub}</span>}
            </>
          );
          return to ? (
            <Link key={label} to={`/desk${to}`} className={`tile ${label === 'Overdue' && value > 0 ? 'tile-alert' : ''}`}>
              {inner}
            </Link>
          ) : (
            <div key={label} className="tile">
              {inner}
            </div>
          );
        })}
      </div>
      <section className="panel">
        <h2>Checkouts per day</h2>
        <p className="muted small">Last 30 days · {plural(data.checkouts.reduce((a, d) => a + d.count, 0), 'checkout')}</p>
        <DailyBars data={data.checkouts.map((d) => ({ day: d.day, value: d.count }))} label="Checkouts per day, last 30 days" unit="checkouts" />
      </section>
      <div className="two-col">
        <section className="panel">
          <h2>Most wanted</h2>
          <p className="muted small">Titles with people waiting — consider buying more copies.</p>
          {data.mostWanted.length === 0 ? (
            <p className="muted">No waitlists right now.</p>
          ) : (
            <div className="book-list compact">
              {data.mostWanted.map((b) => (
                <BookRow key={b.id} book={b}>
                  <span className="pill pill-wait">
                    {b.holdsWaiting} waiting · {b.copies} {b.copies === 1 ? 'copy' : 'copies'}
                  </span>
                </BookRow>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>Most borrowed</h2>
          <div className="book-list compact">
            {data.topBorrowed.map((b) => (
              <BookRow key={b.id} book={b}>
                <span className="muted small">{plural(b.timesBorrowed, 'loan')}</span>
              </BookRow>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function LoansTab() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'active';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, reload } = useApi<{ loans: DeskLoan[] }>(`/admin/loans?status=${status}&q=${encodeURIComponent(dq)}`);
  const toast = useToast();
  const checkin = async (l: DeskLoan) => {
    try {
      await post(`/admin/loans/${l.id}/checkin`);
      toast(`Checked in “${l.book.title}”.`, 'success');
      invalidate('/admin', '/books', '/home');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="segmented">
          {['active', 'overdue', 'returned', 'all'].map((s) => (
            <button key={s} aria-pressed={status === s} onClick={() => setParams({ tab: 'loans', status: s })}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="input-icon grow">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Title, member, email or card number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter loans" />
        </div>
      </div>
      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data && data.loans.length === 0 && <Empty icon="library" title="No loans here" />}
      {data && data.loans.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Book</th>
                <th>Member</th>
                <th>Borrowed</th>
                <th>Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.loans.map((l) => {
                const due = dueLabel(l.dueAt);
                return (
                  <tr key={l.id}>
                    <td>
                      <Link to={`/books/${l.book.slug}`}>{l.book.title}</Link>
                      <div className="muted small">{l.book.author}</div>
                    </td>
                    <td>
                      {l.member.name}
                      <div className="muted small mono">{l.member.cardNumber}</div>
                    </td>
                    <td>{formatDate(l.borrowedAt)}</td>
                    <td>
                      {l.returnedAt ? (
                        <span className="muted">Returned {formatDate(l.returnedAt)}</span>
                      ) : (
                        <span className={`pill pill-${due.tone}`}>{due.text}</span>
                      )}
                      {l.renewals > 0 && <div className="muted small">Renewed {plural(l.renewals, 'time')}</div>}
                    </td>
                    <td className="right">
                      {!l.returnedAt && (
                        <button className="btn btn-sm" onClick={() => checkin(l)}>
                          Check in
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BookPicker({ onPick, placeholder = 'Search the catalog…' }: { onPick: (b: Book) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data } = useApi<SearchResult>(dq.trim() ? `/books?q=${encodeURIComponent(dq)}&limit=8` : null);
  return (
    <div className="picker">
      <div className="input-icon">
        <Icon name="search" size={18} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Find a book" />
      </div>
      {data && dq.trim() && (
        <ul className="picker-list">
          {data.books.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(b);
                  setQ('');
                }}
              >
                <strong>{b.title}</strong> <span className="muted">· {b.author}</span>
                <span className={`pill ${b.available > 0 ? 'pill-ok' : 'pill-wait'}`}>
                  {b.copies === 0 ? 'online only' : `${b.available}/${b.copies} in`}
                </span>
              </button>
            </li>
          ))}
          {data.books.length === 0 && <li className="muted small">No matches</li>}
        </ul>
      )}
    </div>
  );
}

function CheckoutTab() {
  const toast = useToast();
  const [card, setCard] = useState('');
  const [book, setBook] = useState<Book | null>(null);
  const [last, setLast] = useState<{ member: User; book: Book; dueAt: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!book) {
      toast('Choose a book first.', 'error');
      return;
    }
    try {
      const r = await post<{ loan: { dueAt: string }; member: User; book: Book }>('/admin/checkout', { cardNumber: card, slug: book.slug });
      setLast({ member: r.member, book: r.book, dueAt: r.loan.dueAt });
      toast(`Checked out to ${r.member.name}.`, 'success');
      setBook(null);
      invalidate('/admin', '/books', '/home');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="two-col">
      <form className="panel stack" onSubmit={submit}>
        <h2>Desk checkout</h2>
        <label className="field">
          <span>Member’s library card number</span>
          <input className="mono" inputMode="numeric" placeholder="0000-0000-0000" value={card} onChange={(e) => setCard(e.target.value)} required />
        </label>
        <div className="field">
          <span>Book</span>
          {book ? (
            <div className="picked">
              <strong>{book.title}</strong> <span className="muted">· {book.author}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBook(null)}>
                Change
              </button>
            </div>
          ) : (
            <BookPicker onPick={setBook} />
          )}
        </div>
        <button className="btn btn-primary">Check out</button>
      </form>
      <div className="panel">
        <h2>Last checkout</h2>
        {last ? (
          <div className="receipt">
            <p>
              <strong>{last.book.title}</strong>
            </p>
            <p>to {last.member.name}</p>
            <p className="mono">{last.member.cardNumber}</p>
            <p>
              Due back <strong>{formatDate(last.dueAt, { weekday: 'long', month: 'long', day: 'numeric' })}</strong>
            </p>
          </div>
        ) : (
          <p className="muted">Scan or type a card number, pick a book, and press Check out. Holds are respected: a copy saved for someone else can’t be checked out.</p>
        )}
      </div>
    </div>
  );
}

function HoldsTab() {
  const { data, error, reload } = useApi<{
    holds: { id: number; status: string; createdAt: string; expiresAt: string | null; book: { slug: string; title: string }; member: { name: string; cardNumber: string } }[];
  }>('/admin/holds');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.holds.length) return <Empty icon="clock" title="No active holds" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Book</th>
            <th>Member</th>
            <th>Placed</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.holds.map((h) => (
            <tr key={h.id}>
              <td>
                <Link to={`/books/${h.book.slug}`}>{h.book.title}</Link>
              </td>
              <td>
                {h.member.name}
                <div className="muted small mono">{h.member.cardNumber}</div>
              </td>
              <td>{formatDate(h.createdAt)}</td>
              <td>
                {h.status === 'ready' ? <span className="pill pill-ok">Ready until {formatDate(h.expiresAt, { month: 'short', day: 'numeric' })}</span> : <span className="pill">Waiting</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface BookForm {
  title: string;
  author: string;
  year: string;
  copies: string;
  subjects: string;
  description: string;
  gutenbergId: string;
  featured: boolean;
  verse: boolean;
}

const EMPTY_FORM: BookForm = { title: '', author: '', year: '', copies: '1', subjects: '', description: '', gutenbergId: '', featured: false, verse: false };

function CatalogTab() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, reload } = useApi<SearchResult>(`/books?q=${encodeURIComponent(dq)}&sort=${dq ? '' : 'added'}&limit=20&page=${page}`);
  const [editing, setEditing] = useState<Book | 'new' | null>(null);
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="input-icon grow">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Find a book to edit"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            aria-label="Find a book"
          />
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> Add a book
        </button>
      </div>
      {!data && <Loading />}
      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Copies</th>
                <th>Online</th>
                <th>Loans</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.books.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={`/books/${b.slug}`}>{b.title}</Link>
                    <div className="muted small">
                      {b.author}
                      {b.year != null && ` · ${b.year}`}
                    </div>
                  </td>
                  <td>
                    {b.available}/{b.copies} in
                    {b.holdsWaiting > 0 && <div className="muted small">{b.holdsWaiting} waiting</div>}
                  </td>
                  <td>{b.hasText ? <span className="pill pill-free">Text loaded</span> : b.gutenbergId ? <span className="pill">Gutenberg #{b.gutenbergId}</span> : <span className="muted">—</span>}</td>
                  <td>{b.timesBorrowed}</td>
                  <td className="right">
                    <button className="btn btn-sm" onClick={() => setEditing(b)}>
                      <Icon name="edit" size={14} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.pages > 1 && (
        <nav className="pager">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted">
            Page {page} of {data.pages}
          </span>
          <button className="btn" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
      <BookEditor
        book={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          invalidate('/books', '/home', '/admin', '/subjects');
          reload();
        }}
      />
    </div>
  );
}

function BookEditor({ book, onClose, onSaved }: { book: Book | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = book === 'new';
  const initial: BookForm =
    book && book !== 'new'
      ? {
          title: book.title,
          author: book.author,
          year: book.year?.toString() ?? '',
          copies: String(book.copies),
          subjects: book.subjects.join(', '),
          description: book.description,
          gutenbergId: book.gutenbergId?.toString() ?? '',
          featured: book.featured,
          verse: book.verse,
        }
      : EMPTY_FORM;
  const [form, setForm] = useState<BookForm>(initial);
  const [text, setText] = useState('');
  const [key, setKey] = useState<unknown>(null);
  if (key !== book) {
    setKey(book);
    setForm(initial);
    setText('');
  }
  const set = <K extends keyof BookForm>(k: K, v: BookForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const payload = {
      title: form.title,
      author: form.author,
      year: form.year === '' ? null : Number(form.year),
      copies: Number(form.copies || 0),
      subjects: form.subjects,
      description: form.description,
      gutenbergId: form.gutenbergId === '' ? null : Number(form.gutenbergId),
      featured: form.featured,
      verse: form.verse,
    };
    try {
      const r = isNew ? await post<{ book: Book }>('/admin/books', payload) : await patch<{ book: Book }>(`/admin/books/${(book as Book).slug}`, payload);
      if (text.trim()) {
        const t = await put<{ sections: number; words: number }>(`/admin/books/${r.book.slug}/text`, { text });
        toast(`Saved, with ${plural(t.sections, 'section')} and ${t.words.toLocaleString()} words of text.`, 'success');
      } else toast('Saved.', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async () => {
    if (isNew || !book) return;
    if (!window.confirm(`Remove “${book.title}” from the catalog? This deletes its reviews and history.`)) return;
    try {
      await del(`/admin/books/${book.slug}`);
      toast('Removed from the catalog.');
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <Modal open={book != null} onClose={onClose} title={isNew ? 'Add a book' : 'Edit book'} wide>
      <form className="editor" onSubmit={save}>
        <div className="form-grid">
          <label className="field span-2">
            <span>Title</span>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} required maxLength={300} />
          </label>
          <label className="field">
            <span>Author</span>
            <input value={form.author} onChange={(e) => set('author', e.target.value)} required maxLength={200} />
          </label>
          <label className="field">
            <span>Year first published</span>
            <input type="number" value={form.year} onChange={(e) => set('year', e.target.value)} placeholder="e.g. 1958 (negative for BCE)" />
          </label>
          <label className="field">
            <span>Print copies</span>
            <input type="number" min={0} max={1000} value={form.copies} onChange={(e) => set('copies', e.target.value)} />
          </label>
          <label className="field">
            <span>Project Gutenberg number</span>
            <input type="number" min={1} value={form.gutenbergId} onChange={(e) => set('gutenbergId', e.target.value)} placeholder="Optional — enables online reading" />
          </label>
          <label className="field span-2">
            <span>Subjects (comma-separated)</span>
            <input value={form.subjects} onChange={(e) => set('subjects', e.target.value)} placeholder="Fiction, Liberia, History" />
          </label>
          <label className="field span-2">
            <span>Description</span>
            <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} /> Feature on the home page
          </label>
          <label className="check">
            <input type="checkbox" checked={form.verse} onChange={(e) => set('verse', e.target.checked)} /> Poetry or drama (keep line breaks)
          </label>
          <div className="field span-2">
            <span>Full text (optional)</span>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a plain-text book, or choose a .txt file below. Chapters are detected automatically." />
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setText(await f.text());
              }}
            />
            {book && book !== 'new' && book.hasText && <small className="muted">This book already has text; uploading replaces it.</small>}
          </div>
        </div>
        <div className="row gap-sm spread">
          <div className="row gap-sm">
            <button className="btn btn-primary">{isNew ? 'Add to catalog' : 'Save changes'}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          {!isNew && (
            <button type="button" className="btn btn-danger-ghost" onClick={remove}>
              <Icon name="trash" size={14} /> Remove
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function MembersTab() {
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, reload } = useApi<{ members: (User & { activeLoans: number; overdue: number; totalLoans: number; holds: number })[] }>(
    `/admin/members?q=${encodeURIComponent(dq)}`,
  );
  const setRole = async (id: number, role: 'member' | 'librarian') => {
    try {
      await patch(`/admin/members/${id}`, { role });
      toast(role === 'librarian' ? 'Promoted to librarian.' : 'Librarian access removed.', 'success');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="stack">
      <div className="input-icon">
        <Icon name="search" size={18} />
        <input type="search" placeholder="Name, email or card number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a member" />
      </div>
      {!data && <Loading />}
      {data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Card</th>
                <th>Loans</th>
                <th>Holds</th>
                <th>Joined</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.name}
                    <div className="muted small">{m.email}</div>
                  </td>
                  <td className="mono">{m.cardNumber}</td>
                  <td>
                    {m.activeLoans} now · {m.totalLoans} total
                    {m.overdue > 0 && <div><span className="pill pill-danger">{m.overdue} overdue</span></div>}
                  </td>
                  <td>{m.holds}</td>
                  <td>{formatDate(m.createdAt)}</td>
                  <td>
                    <select value={m.role} disabled={m.id === user?.id} onChange={(e) => setRole(m.id, e.target.value as 'member' | 'librarian')} aria-label={`Role for ${m.name}`}>
                      <option value="member">Member</option>
                      <option value="librarian">Librarian</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RequestsTab() {
  const toast = useToast();
  const { data, reload } = useApi<{ suggestions: Suggestion[] }>('/admin/suggestions');
  const setStatus = async (s: Suggestion, status: Suggestion['status']) => {
    await patch(`/admin/suggestions/${s.id}`, { status });
    toast(status === 'acquired' ? 'Marked as acquired — remember to add it to the catalog.' : 'Updated.', 'success');
    reload();
  };
  if (!data) return <Loading />;
  if (!data.suggestions.length) return <Empty icon="inbox" title="No purchase requests yet" />;
  return (
    <ul className="request-list">
      {data.suggestions.map((s) => (
        <li key={s.id} className={`panel request request-${s.status}`}>
          <div>
            <strong>{s.title}</strong>
            {s.author && <span className="muted"> · {s.author}</span>}
            <div className="muted small">
              Suggested by {s.member} · {formatDate(s.createdAt)}
              {s.sourceKey && (
                <>
                  {' '}
                  ·{' '}
                  <a href={`https://openlibrary.org${s.sourceKey}`} target="_blank" rel="noreferrer">
                    Open Library record ↗
                  </a>
                </>
              )}
            </div>
            {s.note && <p className="request-note">“{s.note}”</p>}
          </div>
          <div className="row gap-sm">
            {s.status !== 'acquired' && (
              <button className="btn btn-sm btn-primary" onClick={() => setStatus(s, 'acquired')}>
                <Icon name="check" size={14} /> Acquired
              </button>
            )}
            {s.status !== 'declined' && (
              <button className="btn btn-sm btn-ghost" onClick={() => setStatus(s, 'declined')}>
                Decline
              </button>
            )}
            {s.status !== 'open' && (
              <button className="btn btn-sm btn-ghost" onClick={() => setStatus(s, 'open')}>
                Reopen
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
