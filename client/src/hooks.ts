import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

// A small stale-while-revalidate cache shared by every useApi() caller.
const cache = new Map<string, unknown>();
const listeners = new Set<(prefix: string) => void>();

/** Drop cached responses whose path starts with any of the prefixes and refetch them. */
export function invalidate(...prefixes: string[]) {
  for (const key of [...cache.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
  }
  for (const l of listeners) prefixes.forEach((p) => l(p));
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T | undefined) : undefined));
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path && !cache.has(path)));
  const [version, setVersion] = useState(0);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    const onInvalidate = (prefix: string) => {
      if (pathRef.current?.startsWith(prefix)) setVersion((v) => v + 1);
    };
    listeners.add(onInvalidate);
    return () => {
      listeners.delete(onInvalidate);
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const cached = cache.get(path) as T | undefined;
    setData(cached);
    setLoading(cached === undefined);
    setError(null);
    const ctrl = new AbortController();
    get<T>(path, { signal: ctrl.signal })
      .then((d) => {
        if (cancelled) return;
        cache.set(path, d);
        setData(d);
      })
      .catch((e: Error) => {
        if (cancelled || e.name === 'AbortError') return;
        setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [path, version]);

  const reload = useCallback(() => {
    if (pathRef.current) cache.delete(pathRef.current);
    setVersion((v) => v + 1);
  }, []);

  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · Liberia Online Library`;
    else document.title = 'Liberia Online Library';
  }, [title]);
}

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — ignore */
  }
}

export function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStorage(key, fallback));
  useEffect(() => writeStorage(key, value), [key, value]);
  return [value, setValue] as const;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatches(m.matches);
    m.addEventListener('change', on);
    on();
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}
