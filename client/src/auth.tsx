import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, post } from './api';
import { invalidate } from './hooks';
import type { User } from './types';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    get<{ user: User | null }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const afterChange = useCallback((u: User | null) => {
    setUser(u);
    // Anything personalised must be refetched.
    invalidate('/books', '/home', '/me', '/admin');
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await post<{ user: User }>('/auth/login', { email, password });
      afterChange(r.user);
      return r.user;
    },
    [afterChange],
  );
  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const r = await post<{ user: User }>('/auth/register', { name, email, password });
      afterChange(r.user);
      return r.user;
    },
    [afterChange],
  );
  const logout = useCallback(async () => {
    await post('/auth/logout');
    afterChange(null);
  }, [afterChange]);

  const value = useMemo(() => ({ user, ready, login, register, logout, setUser }), [user, ready, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
