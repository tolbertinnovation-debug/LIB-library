import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { initials } from '../format';
import { useTheme } from '../theme';
import { useToast } from '../toast';
import { Icon } from './Icon';
import { Logo } from './Logo';

function SearchBox({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (location.pathname !== '/browse') setQ('');
  }, [location.pathname]);

  // Press "/" anywhere to jump to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/browse?q=${encodeURIComponent(q.trim())}` : '/browse');
    input.current?.blur();
    onDone?.();
  };
  return (
    <form className="header-search" role="search" onSubmit={submit}>
      <Icon name="search" size={18} />
      <input
        ref={input}
        type="search"
        placeholder="Search titles, authors, subjects…"
        aria-label="Search the catalog"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <kbd className="kbd" aria-hidden>
        /
      </kbd>
    </form>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  if (!user) {
    return (
      <div className="header-auth">
        <Link to="/signin" className="btn btn-ghost">
          Sign in
        </Link>
        <Link to="/join" className="btn btn-primary">
          Get a card
        </Link>
      </div>
    );
  }
  return (
    <div className="user-menu" ref={ref}>
      <button className="avatar-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label="Account menu">
        <span className="avatar">{initials(user.name)}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <strong>{user.name}</strong>
            <span className="muted">Card {user.cardNumber}</span>
          </div>
          <Link role="menuitem" to="/me" onClick={() => setOpen(false)}>
            <Icon name="library" size={18} /> My library
          </Link>
          <Link role="menuitem" to="/account" onClick={() => setOpen(false)}>
            <Icon name="card" size={18} /> Library card & settings
          </Link>
          {user.role === 'librarian' && (
            <Link role="menuitem" to="/desk" onClick={() => setOpen(false)}>
              <Icon name="desk" size={18} /> Librarian desk
            </Link>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
              toast('Signed out. See you soon!');
              navigate('/');
            }}
          >
            <Icon name="logout" size={18} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  const { theme, cycle } = useTheme();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const nav = (
    <>
      <NavLink to="/" end>
        <Icon name="home" size={18} /> Home
      </NavLink>
      <NavLink to="/browse">
        <Icon name="library" size={18} /> Browse
      </NavLink>
      <NavLink to="/discover">
        <Icon name="compass" size={18} /> Discover
      </NavLink>
      {user && (
        <NavLink to="/me">
          <Icon name="bookmark" size={18} /> My Library
        </NavLink>
      )}
      {user?.role === 'librarian' && (
        <NavLink to="/desk">
          <Icon name="desk" size={18} /> Desk
        </NavLink>
      )}
    </>
  );

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="header">
        <div className="header-inner">
          <button className="icon-btn menu-toggle" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" aria-expanded={menuOpen}>
            <Icon name={menuOpen ? 'x' : 'menu'} />
          </button>
          <Link to="/" className="brand" aria-label="Liberia Online Library home">
            <Logo />
          </Link>
          <nav className="main-nav" aria-label="Main">
            {nav}
          </nav>
          <SearchBox />
          <button className="icon-btn" onClick={cycle} aria-label={`Colour theme: ${theme}. Click to change.`} title={`Theme: ${theme}`}>
            <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />
          </button>
          <UserMenu />
        </div>
        {menuOpen && (
          <nav className="mobile-nav" aria-label="Main">
            <SearchBox onDone={() => setMenuOpen(false)} />
            {nav}
          </nav>
        )}
      </header>
      <main id="main" className="main">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Logo />
          <p>
            A free public library for Liberia and the world. Borrow from our shelves, read the classics in your browser, and help us
            grow the collection.
          </p>
        </div>
        <div>
          <h4>Library</h4>
          <Link to="/browse">Catalog</Link>
          <Link to="/browse?readable=1">Read free online</Link>
          <Link to="/collections/liberian-african-voices">Liberian &amp; African voices</Link>
          <Link to="/discover">Discover more books</Link>
        </div>
        <div>
          <h4>Members</h4>
          <Link to="/join">Get a library card</Link>
          <Link to="/me">My library</Link>
          <Link to="/about">How borrowing works</Link>
        </div>
        <div>
          <h4>Sources</h4>
          <a href="https://www.gutenberg.org/" target="_blank" rel="noreferrer">
            Project Gutenberg
          </a>
          <a href="https://openlibrary.org/" target="_blank" rel="noreferrer">
            Open Library
          </a>
          <Link to="/about#public-domain">About public-domain texts</Link>
        </div>
      </div>
      <div className="footer-base">
        <span>★ Liberia Online Library</span>
        <span>Fine-free · Open to everyone · Made with care</span>
      </div>
    </footer>
  );
}
