import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="container not-found">
      <p className="not-found-code">404</p>
      <h1>This page has been checked out.</h1>
      <p className="muted">We couldn’t find what you were looking for. Maybe it’s on another shelf?</p>
      <div className="row gap-sm center">
        <Link to="/" className="btn btn-primary">
          Go home
        </Link>
        <Link to="/browse" className="btn">
          Browse the catalog
        </Link>
      </div>
    </div>
  );
}
