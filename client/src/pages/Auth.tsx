import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { LibraryCard } from '../components/LibraryCard';
import { LogoMark } from '../components/Logo';
import { useDocumentTitle } from '../hooks';
import { useToast } from '../toast';

function useNext() {
  const [params] = useSearchParams();
  const next = params.get('next') || '/me';
  // Only allow local paths.
  return next.startsWith('/') && !next.startsWith('//') ? next : '/me';
}

export function SignIn() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const next = useNext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(email, password);
      toast(`Welcome back, ${u.name.split(' ')[0]}!`, 'success');
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const demo = (who: 'reader' | 'librarian') => {
    setEmail(`${who}@liberia.library`);
    setPassword(who === 'reader' ? 'readmore' : 'librarian');
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <LogoMark size={48} />
        <h1>Welcome back</h1>
        <p className="muted">Sign in with the email on your library card.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small center">
          New here? <Link to={`/join${next !== '/me' ? `?next=${encodeURIComponent(next)}` : ''}`}>Get a free library card</Link>
        </p>
        <div className="demo-box">
          <span className="field-label">Exploring? Try a demo account</span>
          <div className="row gap-sm">
            <button type="button" className="btn btn-sm" onClick={() => demo('reader')}>
              Demo reader
            </button>
            <button type="button" className="btn btn-sm" onClick={() => demo('librarian')}>
              Demo librarian
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function Join() {
  useDocumentTitle('Get a library card');
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const next = useNext();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await register(name, email, password);
      toast(`Welcome to the library, ${u.name.split(' ')[0]}! Your card number is ${u.cardNumber}.`, 'success');
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-join">
      <div className="auth-side">
        <h1>Your free library card</h1>
        <ul className="benefits">
          <li>Borrow up to five print books at a time</li>
          <li>Join waitlists — we’ll save the next copy for you</li>
          <li>Read hundreds of classics in your browser, and pick up where you left off on any device</li>
          <li>Keep quotes, notes and a yearly reading goal</li>
          <li>Never pay a fine. Ever.</li>
        </ul>
        <LibraryCard name={name || 'Your Name'} cardNumber="•••• •••• ••••" since={new Date().toISOString()} />
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>Create your account</h2>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span>Full name</span>
          <input autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <small className="muted">At least 8 characters.</small>
        </label>
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'Creating your card…' : 'Get my card'}
        </button>
        <p className="muted small center">
          Already a member? <Link to="/signin">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
