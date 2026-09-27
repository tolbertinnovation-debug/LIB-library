import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Book } from '../types';
import { plural, readingTime } from '../format';
import { Cover } from './Cover';
import { Icon } from './Icon';

export function Stars({ value, size = 14, label }: { value: number | null; size?: number; label?: string }) {
  const v = value ?? 0;
  return (
    <span className="stars" aria-label={label ?? (value ? `${v.toFixed(1)} out of 5 stars` : 'No ratings yet')} role="img">
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, v - (i - 1)));
        return (
          <span key={i} className="star" style={{ width: size, height: size }}>
            <Icon name="star" size={size} className="star-empty" />
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>
              <Icon name="star" size={size} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="star-input" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={n <= value ? 'on' : ''}
          onClick={() => onChange(n)}
        >
          <Icon name="star" size={26} />
        </button>
      ))}
    </div>
  );
}

export function Availability({ book, compact = false }: { book: Book; compact?: boolean }) {
  if (book.readable && book.copies === 0) {
    return <span className="pill pill-free">Read free online</span>;
  }
  const parts: ReactNode[] = [];
  if (book.readable) parts.push(<span key="r" className="pill pill-free">Read free</span>);
  if (book.copies > 0) {
    if (book.available > 0) {
      parts.push(
        <span key="a" className="pill pill-ok">
          {compact ? `${book.available} available` : `${book.available} of ${plural(book.copies, 'copy', 'copies')} available`}
        </span>,
      );
    } else {
      parts.push(
        <span key="w" className="pill pill-wait">
          {book.holdsWaiting ? `Waitlist · ${book.holdsWaiting}` : 'All copies out'}
        </span>,
      );
    }
  }
  return <span className="pills">{parts}</span>;
}

export function BookCard({ book, progress, badge }: { book: Book; progress?: number; badge?: ReactNode }) {
  return (
    <Link to={`/books/${book.slug}`} className="book-card">
      <div className="book-card-cover">
        <Cover title={book.title} author={book.author} seed={book.slug} />
        {progress != null && (
          <div className="cover-progress" aria-label={`${Math.round(progress)}% read`}>
            <span style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
        )}
        {badge && <div className="book-card-badge">{badge}</div>}
      </div>
      <div className="book-card-body">
        <div className="book-card-title">{book.title}</div>
        <div className="book-card-author">{book.author}</div>
        <div className="book-card-meta">
          {book.ratingCount > 0 && (
            <span className="rating-inline">
              <Stars value={book.rating} size={12} /> <span className="muted">{book.ratingCount}</span>
            </span>
          )}
        </div>
        <Availability book={book} compact />
      </div>
    </Link>
  );
}

export function BookRow({ book, children }: { book: Book; children?: ReactNode }) {
  return (
    <div className="book-row">
      <Link to={`/books/${book.slug}`} className="book-row-cover" tabIndex={-1} aria-hidden>
        <Cover title={book.title} author={book.author} seed={book.slug} size="sm" />
      </Link>
      <div className="book-row-body">
        <Link to={`/books/${book.slug}`} className="book-row-title">
          {book.title}
        </Link>
        <div className="muted">
          {book.author}
          {book.year != null && ` · ${book.year < 0 ? `c. ${-book.year} BCE` : book.year}`}
          {book.hasText && book.wordCount > 0 && ` · ${readingTime(book.readingMinutes)}`}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ShelfRow({ title, subtitle, books, to, progress }: { title: string; subtitle?: string; books: Book[]; to?: string; progress?: Record<number, number> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };
  if (!books.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-head">
        <div>
          <h2 className="shelf-title">{to ? <Link to={to}>{title}</Link> : title}</h2>
          {subtitle && <p className="shelf-sub">{subtitle}</p>}
        </div>
        <div className="shelf-controls">
          {to && (
            <Link to={to} className="link-more">
              See all
            </Link>
          )}
          <button className="icon-btn" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}>
            <Icon name="chevronLeft" />
          </button>
          <button className="icon-btn" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}>
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>
      <div className="shelf-scroller" ref={scroller}>
        {books.map((b) => (
          <BookCard key={b.id} book={b} progress={progress?.[b.id]} />
        ))}
      </div>
    </section>
  );
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-inner">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="empty">
      <Icon name="inbox" size={36} />
      <p>{error.message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ icon = 'inbox', title, children }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function SkeletonGrid({ n = 12 }: { n?: number }) {
  return (
    <div className="book-grid" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="book-card skeleton">
          <div className="book-card-cover">
            <div className="cover skel" />
          </div>
          <div className="skel-line" />
          <div className="skel-line short" />
        </div>
      ))}
    </div>
  );
}
