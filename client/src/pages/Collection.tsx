import { useParams } from 'react-router-dom';
import { BookCard, ErrorState, SkeletonGrid } from '../components/ui';
import { plural } from '../format';
import { useApi, useDocumentTitle } from '../hooks';
import type { Book } from '../types';

export default function Collection() {
  const { slug = '' } = useParams();
  const { data, error, reload } = useApi<{ collection: { title: string; description: string }; books: Book[] }>(`/collections/${slug}`);
  useDocumentTitle(data?.collection.title);
  return (
    <div className="container">
      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <SkeletonGrid />}
      {data && (
        <>
          <div className="page-head collection-head">
            <div>
              <p className="eyebrow">Collection · {plural(data.books.length, 'title')}</p>
              <h1>{data.collection.title}</h1>
              <p className="lede">{data.collection.description}</p>
            </div>
          </div>
          <div className="book-grid">
            {data.books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
