import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { del, post } from '../api';
import { useAuth } from '../auth';
import { ActivityHeatmap, GoalRing } from '../components/charts';
import { Icon } from '../components/Icon';
import { BookCard, BookRow, Empty, ErrorState, Loading, ShelfRow } from '../components/ui';
import { compact, dueLabel, formatDate, plural } from '../format';
import { invalidate, useApi, useDocumentTitle } from '../hooks';
import { useToast } from '../toast';
import type { Dashboard, Hold, Loan, ShelfStatus } from '../types';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'shelves', label: 'Shelves' },
  { id: 'notes', label: 'Notes & quotes' },
  { id: 'history', label: 'History' },
] as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function MyLibrary() {
  useDocumentTitle('My library');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const { data, error, reload } = useApi<Dashboard>('/me/dashboard');

  if (error) return <div className="container"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <Loading />;

  return (
    <div className="container my-library">
      <div className="page-head">
        <div>
          <p className="eyebrow">My library</p>
          <h1>
            {greeting()}, {user?.name.split(' ')[0]}.
          </h1>
          <p className="muted">
            {data.loans.length ? plural(data.loans.length, 'book') + ' on loan' : 'Nothing on loan'} ·{' '}
            {data.holds.length ? plural(data.holds.length, 'hold') : 'no holds'}
            {data.stats.streak > 0 && ` · ${plural(data.stats.streak, 'day')} reading streak`}
          </p>
        </div>
        <Link to="/account" className="btn">
          <Icon name="card" size={18} /> Library card
        </Link>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setParams(t.id === 'overview' ? {} : { tab: t.id })}>
            {t.label}
            {t.id === 'notes' && data.bookmarks.length > 0 && <span className="tab-count">{data.bookmarks.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview data={data} onChanged={reload} />}
      {tab === 'shelves' && <Shelves data={data} />}
      {tab === 'notes' && <Notes data={data} />}
      {tab === 'history' && <History data={data} />}
    </div>
  );
}

function Overview({ data, onChanged }: { data: Dashboard; onChanged: () => void }) {
  const { stats } = data;
  const reading = data.shelves.filter((s) => s.status === 'reading');
  const readyHolds = data.holds.filter((h) => h.status === 'ready');
  const overdue = data.loans.filter((l) => Date.parse(l.dueAt) < Date.now());
  const minutes30 = stats.activity.slice(-30).reduce((a, d) => a + d.minutes, 0);

  return (
    <div className="overview">
      {(readyHolds.length > 0 || overdue.length > 0) && (
        <div className="alerts">
          {readyHolds.map((h) => (
            <Link key={h.id} to={`/books/${h.book.slug}`} className="alert alert-ok">
              <Icon name="sparkle" size={18} />
              <span>
                <strong>{h.book.title}</strong> is waiting for you — borrow it by {formatDate(h.expiresAt, { weekday: 'long', month: 'short', day: 'numeric' })}.
              </span>
            </Link>
          ))}
          {overdue.map((l) => (
            <div key={l.id} className="alert alert-danger">
              <Icon name="clock" size={18} />
              <span>
                <strong>{l.book.title}</strong> was due {formatDate(l.dueAt)}. No fines here — just return or renew it when you can.
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-card stat-goal">
          <GoalRing value={stats.finishedThisYear} goal={stats.goal} />
          <div>
            <h3>{stats.year} reading goal</h3>
            <p className="muted">
              {stats.finishedThisYear >= stats.goal
                ? 'Goal reached — wonderful!'
                : `${plural(stats.goal - stats.finishedThisYear, 'book')} to go.`}
            </p>
            <Link to="/account#goal" className="small">
              Change goal
            </Link>
          </div>
        </div>
        <div className="stat-card">
          <Icon name="flame" size={22} className="stat-icon" />
          <div className="stat-value">{stats.streak}</div>
          <div className="stat-label">day streak</div>
        </div>
        <div className="stat-card">
          <Icon name="clock" size={22} className="stat-icon" />
          <div className="stat-value">{minutes30 >= 120 ? `${Math.round(minutes30 / 60)}h` : `${minutes30}m`}</div>
          <div className="stat-label">read in the last 30 days</div>
        </div>
        <div className="stat-card">
          <Icon name="bookOpen" size={22} className="stat-icon" />
          <div className="stat-value">{compact(stats.wordsRead)}</div>
          <div className="stat-label">words read</div>
        </div>
        <div className="stat-card stat-activity">
          <h3>Reading activity</h3>
          <ActivityHeatmap days={stats.activity} />
        </div>
      </div>

      <section className="section-block">
        <div className="section-head">
          <h2>On loan</h2>
          <span className="muted small">
            {data.loans.length} of {data.rules.maxLoans} · {data.rules.loanDays}-day loans
          </span>
        </div>
        {data.loans.length === 0 ? (
          <Empty icon="library" title="No books on loan">
            <p>
              <Link to="/browse?available=1">See what’s on the shelf</Link>
            </p>
          </Empty>
        ) : (
          <div className="book-list">
            {data.loans.map((l) => (
              <LoanRow key={l.id} loan={l} onChanged={onChanged} />
            ))}
          </div>
        )}
      </section>

      {data.holds.length > 0 && (
        <section className="section-block">
          <div className="section-head">
            <h2>Holds</h2>
            <span className="muted small">
              {data.holds.length} of {data.rules.maxHolds}
            </span>
          </div>
          <div className="book-list">
            {data.holds.map((h) => (
              <HoldRow key={h.id} hold={h} onChanged={onChanged} />
            ))}
          </div>
        </section>
      )}

      {reading.length > 0 && (
        <ShelfRow
          title="Currently reading"
          books={reading.map((s) => s.book)}
          progress={Object.fromEntries(reading.filter((s) => s.progress).map((s) => [s.book.id, s.progress!.percent]))}
          to="/me?tab=shelves"
        />
      )}

      {stats.topSubjects.length > 0 && (
        <section className="section-block">
          <h2>Your reading, by subject</h2>
          <div className="chips">
            {stats.topSubjects.map((s) => (
              <Link key={s.name} to={`/browse?subject=${encodeURIComponent(s.name)}`} className="chip">
                {s.name} <span className="chip-count">{s.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <ShelfRow title="Picked for you" subtitle="Based on what you read and love." books={data.recommendations} />
    </div>
  );
}

function LoanRow({ loan, onChanged }: { loan: Loan; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const due = dueLabel(loan.dueAt);
  const act = async (path: string, msg: string) => {
    setBusy(true);
    try {
      await post(path);
      toast(msg, 'success');
      invalidate('/books', '/home');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <BookRow book={loan.book}>
      <div className="row gap-sm wrap">
        <span className={`pill pill-${due.tone}`}>{due.text}</span>
        <span className="muted small">
          Borrowed {formatDate(loan.borrowedAt, { month: 'short', day: 'numeric' })} · {plural(loan.renewalsLeft, 'renewal')} left
          {loan.othersWaiting > 0 && ` · ${plural(loan.othersWaiting, 'person', 'people')} waiting`}
        </span>
      </div>
      <div className="row gap-sm">
        <button
          className="btn btn-sm"
          disabled={busy || loan.renewalsLeft <= 0 || loan.othersWaiting > 0}
          title={loan.othersWaiting > 0 ? 'Someone is waiting for this book' : loan.renewalsLeft <= 0 ? 'No renewals left' : undefined}
          onClick={() => act(`/loans/${loan.id}/renew`, 'Renewed for two more weeks.')}
        >
          <Icon name="refresh" size={14} /> Renew
        </button>
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act(`/loans/${loan.id}/return`, 'Returned — thank you!')}>
          Return
        </button>
      </div>
    </BookRow>
  );
}

function HoldRow({ hold, onChanged }: { hold: Hold; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg, 'success');
      invalidate('/books', '/home');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <BookRow book={hold.book}>
      <div className="row gap-sm wrap">
        {hold.status === 'ready' ? (
          <span className="pill pill-ok">Ready · until {formatDate(hold.expiresAt, { month: 'short', day: 'numeric' })}</span>
        ) : (
          <span className="pill">#{hold.position} in line</span>
        )}
        <span className="muted small">Placed {formatDate(hold.createdAt, { month: 'short', day: 'numeric' })}</span>
      </div>
      <div className="row gap-sm">
        {hold.status === 'ready' && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(() => post(`/books/${hold.book.slug}/borrow`), 'Borrowed! Enjoy.')}>
            Borrow now
          </button>
        )}
        <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => del(`/holds/${hold.id}`), 'Hold cancelled.')}>
          Cancel hold
        </button>
      </div>
    </BookRow>
  );
}

const SHELF_TABS: { id: ShelfStatus | 'favorite'; label: string }[] = [
  { id: 'reading', label: 'Reading' },
  { id: 'want', label: 'Want to read' },
  { id: 'finished', label: 'Finished' },
  { id: 'favorite', label: 'Favourites' },
];

function Shelves({ data }: { data: Dashboard }) {
  const [which, setWhich] = useState<ShelfStatus | 'favorite'>('reading');
  const list = data.shelves.filter((s) => (which === 'favorite' ? s.favorite : s.status === which));
  return (
    <div>
      <div className="segmented segmented-lg" role="group" aria-label="Shelf">
        {SHELF_TABS.map((t) => (
          <button key={t.id} aria-pressed={which === t.id} onClick={() => setWhich(t.id)}>
            {t.label} <span className="chip-count">{data.shelves.filter((s) => (t.id === 'favorite' ? s.favorite : s.status === t.id)).length}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon="bookmark" title="This shelf is empty">
          <p>
            Use the “My shelves” menu on any book page to add it here. <Link to="/browse">Browse the catalog</Link>
          </p>
        </Empty>
      ) : (
        <div className="book-grid">
          {list.map((s) => (
            <BookCard
              key={s.book.id}
              book={s.book}
              progress={s.status === 'reading' ? s.progress?.percent ?? 0 : undefined}
              badge={s.favorite ? <Icon name="heart" size={14} /> : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Notes({ data }: { data: Dashboard }) {
  if (!data.bookmarks.length) {
    return (
      <Empty icon="quote" title="No notes yet">
        <p>While reading, select a passage and press the bookmark button to save it here with your own note.</p>
      </Empty>
    );
  }
  const byBook = new Map<string, typeof data.bookmarks>();
  for (const b of data.bookmarks) {
    const key = b.book!.slug;
    byBook.set(key, [...(byBook.get(key) ?? []), b]);
  }
  return (
    <div className="notes-page">
      {[...byBook.entries()].map(([slug, marks]) => (
        <section key={slug} className="notes-book">
          <h2>
            <Link to={`/books/${slug}`}>{marks[0]!.book!.title}</Link> <span className="muted small">{marks[0]!.book!.author}</span>
          </h2>
          <ul>
            {marks.map((m) => (
              <li key={m.id} className="note-card">
                <Link to={`/read/${slug}?s=${m.sectionIdx}&p=${m.position.toFixed(4)}`}>
                  <span className="find-where">{m.sectionTitle}</span>
                  {m.excerpt && <blockquote>“{m.excerpt}”</blockquote>}
                </Link>
                {m.note && <p className="note-text">{m.note}</p>}
                <span className="muted tiny">{formatDate(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function History({ data }: { data: Dashboard }) {
  return (
    <div>
      <section className="section-block">
        <h2>Past loans</h2>
        {data.history.length === 0 ? (
          <p className="muted">Books you return will be listed here.</p>
        ) : (
          <div className="book-list">
            {data.history.map((l) => (
              <BookRow key={l.id} book={l.book}>
                <span className="muted small">
                  Borrowed {formatDate(l.borrowedAt)} · returned {formatDate(l.returnedAt)}
                </span>
              </BookRow>
            ))}
          </div>
        )}
      </section>
      <section className="section-block">
        <h2>Your purchase suggestions</h2>
        {data.suggestions.length === 0 ? (
          <p className="muted">
            Can’t find a book? <Link to="/discover">Search millions of titles</Link> and ask us to add it.
          </p>
        ) : (
          <ul className="suggestion-list">
            {data.suggestions.map((s) => (
              <li key={s.id}>
                <strong>{s.title}</strong>
                {s.author && <span className="muted"> · {s.author}</span>}
                <span className={`pill ${s.status === 'acquired' ? 'pill-ok' : s.status === 'declined' ? 'pill-wait' : ''}`}>
                  {s.status === 'open' ? 'Under review' : s.status === 'acquired' ? 'Added to the collection' : 'Not this time'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
