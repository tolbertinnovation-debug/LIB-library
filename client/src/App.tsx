import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import Home from './pages/Home';
import Browse from './pages/Browse';
import BookPage from './pages/BookPage';
import { SignIn, Join } from './pages/Auth';
import NotFound from './pages/NotFound';

const Reader = lazy(() => import('./pages/Reader'));
const MyLibrary = lazy(() => import('./pages/MyLibrary'));
const Account = lazy(() => import('./pages/Account'));
const Discover = lazy(() => import('./pages/Discover'));
const Collection = lazy(() => import('./pages/Collection'));
const Desk = lazy(() => import('./pages/Desk'));
const About = lazy(() => import('./pages/About'));

function RequireUser({ children, librarian = false }: { children: ReactNode; librarian?: boolean }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (librarian && user.role !== 'librarian') return <NotFound />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/read/:slug" element={<Reader />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="browse" element={<Browse />} />
          <Route path="books/:slug" element={<BookPage />} />
          <Route path="collections/:slug" element={<Collection />} />
          <Route path="discover" element={<Discover />} />
          <Route path="about" element={<About />} />
          <Route path="signin" element={<SignIn />} />
          <Route path="join" element={<Join />} />
          <Route path="me" element={<RequireUser><MyLibrary /></RequireUser>} />
          <Route path="account" element={<RequireUser><Account /></RequireUser>} />
          <Route path="desk/*" element={<RequireUser librarian><Desk /></RequireUser>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
