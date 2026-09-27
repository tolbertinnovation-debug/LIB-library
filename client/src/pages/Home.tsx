import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { LibraryCard } from '../components/LibraryCard';
import { ErrorState, ShelfRow, SkeletonGrid } from '../components/ui';
import { compact, readingTime } from '../format';
import { useApi, useDocumentTitle } from '../hooks';
import { IS_STATIC } from '../staticApi';
import type { HomeData } from '../types';

const QUICK = [
  { label: 'Read free tonight', to: '/browse?readable=1' },
  { label: 'Liberian & African voices', to: '/collections/liberian-african-voices' },
  { label: 'Mysteries', to: '/browse?subject=Mystery' },
  { label: 'Poetry', to: '/browse?subject=Poetry' },
  { label: 'For young readers', to: '/collections/young-readers' },
  { label: 'On the shelf now', to: '/browse?available=1' },
];

export default function Home() {
  useDocumentTitle(undefined);
  const { user } = useAuth();
  const { data, error, reload } = useApi<HomeData>('/home');
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/browse?q=${encodeURIComponent(q.trim())}` : '/browse');
  };

  const heroBooks = data?.featured.slice(0, 3) ?? [];

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="star-glyph">★</span> The people’s library of Liberia
            </p>
            <h1>
              A library for Liberia,
              <br />
              <em>open to the whole world.</em>
            </h1>
            <p className="hero-lede">
              Borrow from our shelves, join a waitlist for the books everyone wants, or open a classic right now in your browser. No fees. No
              fines. Just reading.
            </p>
            <form className="hero-search" onSubmit={submit} role="search">
              <Icon name="search" size={22} />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Try “Achebe”, “whale”, or “Liberia”"
                aria-label="Search the catalog"
              />
              <button className="btn btn-primary" type="submit">
                Search
              </button>
            </form>
            <div className="chips">
              {QUICK.map((c) => (
                <Link key={c.to} to={c.to} className="chip">
                  {c.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="hero-art" aria-hidden>
            {heroBooks.map((b, i) => (
              <Link key={b.id} to={`/books/${b.slug}`} className={`hero-cover hero-cover-${i}`} tabIndex={-1}>
                <Cover title={b.title} author={b.author} seed={b.slug} size="lg" />
              </Link>
            ))}
          </div>
        </div>
        {data && (
          <dl className="stats-band">
            <div>
              <dt>Titles in the catalog</dt>
              <dd>{data.stats.books.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Free to read online</dt>
              <dd>{data.stats.readable.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Words ready to read</dt>
              <dd>{compact(data.stats.words)}</dd>
            </div>
            <div>
              <dt>Library members</dt>
              <dd>{data.stats.members.toLocaleString()}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="container">
        {error && <ErrorState error={error} onRetry={reload} />}
        {!data && !error && <SkeletonGrid n={6} />}

        {data && data.continueReading.length > 0 && (
          <ShelfRow
            title="Continue reading"
            subtitle="Pick up exactly where you left off."
            books={data.continueReading}
            progress={Object.fromEntries(data.continueReading.map((b) => [b.id, b.progress.percent]))}
            to="/me"
          />
        )}

        {data?.bookOfTheDay && (
          <section className="botd">
            <Link to={`/books/${data.bookOfTheDay.book.slug}`} className="botd-cover" tabIndex={-1} aria-hidden>
              <Cover title={data.bookOfTheDay.book.title} author={data.bookOfTheDay.book.author} seed={data.bookOfTheDay.book.slug} size="lg" />
            </Link>
            <div className="botd-body">
              <p className="eyebrow">Today’s opening lines</p>
              <h2>
                <Link to={`/books/${data.bookOfTheDay.book.slug}`}>{data.bookOfTheDay.book.title}</Link>
              </h2>
              <p className="muted">
                {data.bookOfTheDay.book.author} · {readingTime(data.bookOfTheDay.book.readingMinutes)}
              </p>
              <blockquote className="botd-quote">{data.bookOfTheDay.excerpt}</blockquote>
              <div className="row gap">
                <Link to={`/read/${data.bookOfTheDay.book.slug}`} className="btn btn-primary">
                  <Icon name="bookOpen" size={18} /> Keep reading
                </Link>
                <Link to={`/books/${data.bookOfTheDay.book.slug}`} className="btn">
                  About this book
                </Link>
              </div>
            </div>
          </section>
        )}

        {data?.collections.map((c) => (
          <ShelfRow key={c.slug} title={c.title} subtitle={c.description} books={c.books} to={`/collections/${c.slug}`} />
        ))}

        {data && <ShelfRow title="Most borrowed" subtitle="What your neighbours are reading." books={data.popular} to="/browse?sort=popular" />}
        {data && <ShelfRow title="Recently added" books={data.added} to="/browse?sort=added" />}

        {!user && !IS_STATIC && data && (
          <section className="join-band">
            <div>
              <p className="eyebrow">Free for everyone</p>
              <h2>Get your library card in thirty seconds.</h2>
              <p>
                Borrow up to five books at a time, join waitlists, save your place in every book, keep notes, and track your reading goal.
              </p>
              <Link to="/join" className="btn btn-primary btn-lg">
                Get a free card
              </Link>
            </div>
            <LibraryCard name="Your Name Here" cardNumber="0000-0000-0000" since={new Date().toISOString()} />
          </section>
        )}
      </div>
    </div>
  );
}
