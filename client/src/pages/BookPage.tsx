import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, del, get, post, put } from '../api';
import { useAuth } from '../auth';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { ErrorState, Loading, ShelfRow, StarInput, Stars } from '../components/ui';
import { dueLabel, formatDate, formatYear, plural, readingTime, timeAgo } from '../format';
import { invalidate, useApi, useDocumentTitle } from '../hooks';
import { useToast } from '../toast';
import type { BookDetail, Circulation, Shelf, ShelfStatus } from '../types';

const SHELF_LABELS: Record<ShelfStatus, string> = {
  want: 'Want to read',
  reading: 'Currently reading',
  finished: 'Finished',
};

export default function BookPage() {
  const { slug = '' } = useParams();
  const { data, error, reload, setData } = useApi<BookDetail>(`/books/${slug}`);
  useDocumentTitle(data?.book.title);

  if (error) return <div className="container"><ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <Loading />;
  const { book } = data;

  const setCirculation = (c: Circulation) => setData({ ...data, circulation: c });
  const setShelf = (s: Shelf | null) => setData({ ...data, shelf: s });

  return (
    <div className="container book-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/browse">Catalog</Link>
        <Icon name="chevronRight" size={14} />
        {book.subjects[0] && (
          <>
            <Link to={`/browse?subject=${encodeURIComponent(book.subjects.find((s) => s !== 'Fiction') ?? book.subjects[0])}`}>
              {book.subjects.find((s) => s !== 'Fiction') ?? book.subjects[0]}
            </Link>
            <Icon name="chevronRight" size={14} />
          </>
        )}
        <span aria-current="page">{book.title}</span>
      </nav>

      <div className="book-hero">
        <div className="book-hero-cover">
          <Cover title={book.title} author={book.author} seed={book.slug} size="lg" />
        </div>
        <div className="book-hero-info">
          <h1 className="book-title">{book.title}</h1>
          <p className="book-author">
            by <Link to={`/browse?author=${encodeURIComponent(book.author)}`}>{book.author}</Link>
            {book.year != null && <span className="muted"> · {formatYear(book.year)}</span>}
          </p>
          <div className="book-rating-line">
            <Stars value={book.rating} size={18} />
            {book.ratingCount > 0 ? (
              <a href="#reviews" className="muted">
                {book.rating?.toFixed(1)} · {plural(book.ratingCount, 'review')}
              </a>
            ) : (
              <a href="#reviews" className="muted">
                Be the first to review
              </a>
            )}
            {book.timesBorrowed > 0 && <span className="muted">· Borrowed {plural(book.timesBorrowed, 'time')}</span>}
          </div>
          <p className="book-description">{book.description || 'No description yet.'}</p>
          <div className="chips">
            {book.subjects.map((s) => (
              <Link key={s} to={`/browse?subject=${encodeURIComponent(s)}`} className="chip chip-sm">
                {s}
              </Link>
            ))}
          </div>
          {data.collections.length > 0 && (
            <p className="muted small">
              In{' '}
              {data.collections.map((c, i) => (
                <span key={c.slug}>
                  {i > 0 && ', '}
                  <Link to={`/collections/${c.slug}`}>{c.title}</Link>
                </span>
              ))}
            </p>
          )}
        </div>

        <aside className="action-panel" aria-label="Get this book">
          {book.readable && <ReadPanel data={data} />}
          {book.copies > 0 && <BorrowPanel data={data} onChange={setCirculation} />}
          <ShelfPanel data={data} onChange={setShelf} />
        </aside>
      </div>

      {data.toc.length > 0 && <Contents data={data} />}

      <Reviews data={data} onChanged={reload} />

      {data.similar.length > 0 && <ShelfRow title="You might also like" books={data.similar} />}
    </div>
  );
}

function ReadPanel({ data }: { data: BookDetail }) {
  const { book, progress } = data;
  const started = progress && progress.percent > 0;
  return (
    <div className="panel panel-read">
      <div className="panel-title">
        <Icon name="bookOpen" size={18} /> Read online
      </div>
      <p className="muted small">
        Free and complete · public domain
        {book.hasText && book.wordCount > 0 && ` · ${readingTime(book.readingMinutes)}`}
      </p>
      {started && (
        <div className="progress-line" aria-label={`${Math.round(progress.percent)}% read`}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>
      )}
      <Link to={`/read/${book.slug}`} className="btn btn-primary btn-block">
        {started ? `Continue reading · ${Math.round(progress.percent)}%` : 'Start reading'}
      </Link>
    </div>
  );
}

function BorrowPanel({ data, onChange }: { data: BookDetail; onChange: (c: Circulation) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { book, circulation: c } = data;

  const act = async (fn: () => Promise<{ circulation?: Circulation }>, success: string) => {
    if (!user) {
      navigate(`/signin?next=${encodeURIComponent(`/books/${book.slug}`)}`);
      return;
    }
    setBusy(true);
    try {
      const r = await fn();
      if (r.circulation) onChange(r.circulation);
      invalidate('/me', '/home', '/books?');
      toast(success, 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const d = await get<BookDetail>(`/books/${book.slug}`);
    return { circulation: d.circulation };
  };

  let body;
  if (c.loan) {
    const due = dueLabel(c.loan.dueAt);
    body = (
      <>
        <p className={`status status-${due.tone}`}>
          <Icon name="check" size={16} />
          <span>On loan to you · {due.text}</span>
        </p>
        <div className="row gap-sm">
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await post(`/loans/${c.loan!.id}/renew`);
                return refresh();
              }, 'Renewed for another two weeks.')
            }
          >
            <Icon name="refresh" size={16} /> Renew
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await post(`/loans/${c.loan!.id}/return`);
                return refresh();
              }, 'Returned. Thank you!')
            }
          >
            Return
          </button>
        </div>
      </>
    );
  } else if (c.hold?.status === 'ready') {
    body = (
      <>
        <p className="status status-ok">
          <Icon name="sparkle" size={16} />
          <span>A copy is waiting for you until {formatDate(c.hold.expiresAt, { weekday: 'short', month: 'short', day: 'numeric' })}.</span>
        </p>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => act(() => post(`/books/${book.slug}/borrow`), 'Borrowed! Enjoy the book.')}>
          Borrow your copy
        </button>
      </>
    );
  } else if (c.hold) {
    body = (
      <>
        <p className="status">
          <Icon name="clock" size={16} />
          <span>
            You’re <strong>#{c.hold.position}</strong> in line. We’ll save the next copy for you.
          </span>
        </p>
        <button
          className="btn btn-block"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await del(`/holds/${c.hold!.id}`);
              return refresh();
            }, 'Hold cancelled.')
          }
        >
          Cancel hold
        </button>
      </>
    );
  } else if (c.available > 0) {
    body = (
      <>
        <p className="status status-ok">
          {c.available} of {plural(c.copies, 'copy', 'copies')} on the shelf
        </p>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => act(() => post(`/books/${book.slug}/borrow`), 'Borrowed! It’s due back in two weeks.')}>
          Borrow
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p className="status status-warning">
          All {plural(c.copies, 'copy', 'copies')} are out{c.waiting > 0 && ` · ${plural(c.waiting, 'person', 'people')} waiting`}
        </p>
        <button className="btn btn-accent btn-block" disabled={busy} onClick={() => act(() => post(`/books/${book.slug}/hold`), 'You’re on the list. We’ll hold the next copy for you.')}>
          Place a hold
        </button>
      </>
    );
  }
  return (
    <div className="panel">
      <div className="panel-title">
        <Icon name="library" size={18} /> Borrow a print copy
      </div>
      {body}
      <p className="muted tiny">Two-week loans · renew twice · never any fines</p>
    </div>
  );
}

function ShelfPanel({ data, onChange }: { data: BookDetail; onChange: (s: Shelf | null) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const shelf = data.shelf;

  const save = async (patch: { status?: ShelfStatus | null; favorite?: boolean }) => {
    if (!user) {
      navigate(`/signin?next=${encodeURIComponent(`/books/${data.book.slug}`)}`);
      return;
    }
    try {
      const r = await put<{ shelf: Shelf | null }>(`/books/${data.book.slug}/shelf`, patch);
      onChange(r.shelf);
      invalidate('/me');
      if ('status' in patch) toast(patch.status ? `Added to “${SHELF_LABELS[patch.status]}”.` : 'Removed from your shelves.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: data.book.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied.', 'success');
      }
    } catch {
      /* dismissed */
    }
  };

  return (
    <div className="panel panel-shelf">
      <label className="field-label" htmlFor="shelf-select">
        My shelves
      </label>
      <div className="row gap-sm">
        <select
          id="shelf-select"
          value={shelf?.status ?? ''}
          onChange={(e) => save({ status: (e.target.value || null) as ShelfStatus | null })}
        >
          <option value="">Not on a shelf</option>
          {(Object.keys(SHELF_LABELS) as ShelfStatus[]).map((k) => (
            <option key={k} value={k}>
              {SHELF_LABELS[k]}
            </option>
          ))}
        </select>
        <button
          className={`icon-btn heart ${shelf?.favorite ? 'on' : ''}`}
          onClick={() => save({ favorite: !shelf?.favorite })}
          aria-pressed={Boolean(shelf?.favorite)}
          aria-label={shelf?.favorite ? 'Remove from favourites' : 'Add to favourites'}
        >
          <Icon name="heart" />
        </button>
        <button className="icon-btn" onClick={share} aria-label="Share this book">
          <Icon name="share" />
        </button>
      </div>
    </div>
  );
}

function Contents({ data }: { data: BookDetail }) {
  const [open, setOpen] = useState(false);
  const shown = open ? data.toc : data.toc.slice(0, 8);
  const current = data.progress?.sectionIdx;
  return (
    <section className="section-block">
      <h2>Contents</h2>
      <ol className="toc">
        {shown.map((t) => (
          <li key={t.idx} className={t.idx === current ? 'current' : ''}>
            <Link to={`/read/${data.book.slug}?s=${t.idx}`}>
              <span>{t.title}</span>
              <span className="muted small">{Math.max(1, Math.round(t.words / 230))} min</span>
            </Link>
          </li>
        ))}
      </ol>
      {data.toc.length > 8 && (
        <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show fewer' : `Show all ${data.toc.length} parts`}
          <Icon name="chevronDown" size={16} className={open ? 'flip' : ''} />
        </button>
      )}
    </section>
  );
}

function Reviews({ data, onChanged }: { data: BookDetail; onChanged: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const mine = data.reviews.find((r) => r.mine);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? '');
  const [busy, setBusy] = useState(false);
  const total = data.distribution.reduce((a, b) => a + b, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!rating) {
      toast('Choose a star rating first.', 'error');
      return;
    }
    setBusy(true);
    try {
      await put(`/books/${data.book.slug}/review`, { rating, body });
      toast('Thanks for your review!', 'success');
      setEditing(false);
      invalidate('/home', '/books?');
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save your review.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await del(`/books/${data.book.slug}/review`);
    setRating(0);
    setBody('');
    toast('Review removed.');
    onChanged();
  };

  return (
    <section className="section-block" id="reviews">
      <h2>Reader reviews</h2>
      <div className="reviews-layout">
        <div className="rating-summary">
          <div className="rating-big">{data.book.rating ? data.book.rating.toFixed(1) : '–'}</div>
          <Stars value={data.book.rating} size={18} />
          <p className="muted small">{plural(total, 'rating')}</p>
          <div className="dist">
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n} className="dist-row">
                <span>{n}★</span>
                <span className="dist-bar">
                  <span style={{ width: total ? `${(data.distribution[n - 1]! / total) * 100}%` : 0 }} />
                </span>
                <span className="muted">{data.distribution[n - 1]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="review-list">
          {user && (!mine || editing) && (
            <form className="review-form" onSubmit={submit}>
              <p className="field-label">{mine ? 'Edit your review' : 'What did you think?'}</p>
              <StarInput value={rating} onChange={setRating} />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} placeholder="Share a few words for other readers (optional)" />
              <div className="row gap-sm">
                <button className="btn btn-primary" disabled={busy}>
                  {mine ? 'Save changes' : 'Post review'}
                </button>
                {editing && (
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
          {!user && (
            <p className="muted">
              <Link to={`/signin?next=/books/${data.book.slug}`}>Sign in</Link> to rate and review this book.
            </p>
          )}
          {data.reviews.length === 0 && <p className="muted">No reviews yet.</p>}
          {data.reviews.map((r) => (
            <article key={r.id} className={`review ${r.mine ? 'review-mine' : ''}`}>
              <header>
                <span className="avatar avatar-sm">{r.reviewer[0]}</span>
                <strong>{r.mine ? 'You' : r.reviewer}</strong>
                <Stars value={r.rating} size={13} />
                <span className="muted small">{timeAgo(r.updatedAt)}</span>
                {r.mine && !editing && (
                  <span className="review-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                      Edit
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={remove}>
                      Delete
                    </button>
                  </span>
                )}
              </header>
              {r.body && <p>{r.body}</p>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
