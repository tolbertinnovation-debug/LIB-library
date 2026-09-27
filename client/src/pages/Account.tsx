import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, patch, post } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { LibraryCard } from '../components/LibraryCard';
import { Modal } from '../components/ui';
import { useDocumentTitle } from '../hooks';
import { useToast } from '../toast';
import type { User } from '../types';

export default function Account() {
  useDocumentTitle('Library card & settings');
  const { user, setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(user!.name);
  const [goal, setGoal] = useState(user!.readingGoal);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [closing, setClosing] = useState(false);
  const [confirm, setConfirm] = useState('');

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await patch<{ user: User }>('/me', { name, readingGoal: goal });
      setUser(r.user);
      toast('Saved.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post('/me/password', { current, next });
      setCurrent('');
      setNext('');
      toast('Password changed. Other devices have been signed out.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const closeAccount = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await del('/me', { password: confirm });
      toast('Your account has been closed. Thank you for reading with us.');
      window.location.assign('/');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (!user) return null;
  return (
    <div className="container account">
      <div className="page-head">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Library card & settings</h1>
        </div>
      </div>
      <div className="account-grid">
        <div>
          <LibraryCard name={user.name} cardNumber={user.cardNumber} since={user.createdAt} />
          <p className="muted small">Show this card number at the desk to check out print books in person.</p>
        </div>
        <div className="stack">
          <form className="panel" onSubmit={saveProfile} id="goal">
            <h2>Profile</h2>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
            </label>
            <label className="field">
              <span>Books I want to read in {new Date().getFullYear()}</span>
              <input type="number" min={1} max={500} value={goal} onChange={(e) => setGoal(Number(e.target.value))} />
            </label>
            <p className="muted small">Email: {user.email}</p>
            <button className="btn btn-primary">Save</button>
          </form>

          <form className="panel" onSubmit={changePassword}>
            <h2>Password</h2>
            <label className="field">
              <span>Current password</span>
              <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </label>
            <label className="field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
            </label>
            <button className="btn">Change password</button>
          </form>

          <div className="panel">
            <h2>Your data</h2>
            <p className="muted">
              We keep your loans, shelves, notes and reading time so we can show them back to you. We never sell or share them.
            </p>
            <div className="row gap-sm wrap">
              <a className="btn" href="/api/me/export" download>
                <Icon name="download" size={16} /> Download my data
              </a>
              <button className="btn btn-danger-ghost" onClick={() => setClosing(true)}>
                Close my account
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal open={closing} onClose={() => setClosing(false)} title="Close your account?">
        <form onSubmit={closeAccount} className="stack">
          <p>This permanently deletes your card, shelves, notes and history. Please return any borrowed books first.</p>
          <label className="field">
            <span>Confirm with your password</span>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoFocus />
          </label>
          <div className="row gap-sm">
            <button className="btn btn-danger">Close account</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setClosing(false); navigate('/me'); }}>
              Keep my card
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
