import { IS_STATIC, NO_SERVER_MESSAGE, staticGet } from './staticApi';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T = unknown>(path: string, method: Method = 'GET', body?: unknown, init?: RequestInit): Promise<T> {
  if (IS_STATIC) {
    if (method !== 'GET') throw new ApiError(501, NO_SERVER_MESSAGE);
    try {
      return (await staticGet(path)) as T;
    } catch (e) {
      throw new ApiError((e as { status?: number }).status ?? 501, (e as Error).message);
    }
  }
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    ...init,
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const get = <T,>(path: string, init?: RequestInit) => api<T>(path, 'GET', undefined, init);
export const post = <T,>(path: string, body?: unknown) => api<T>(path, 'POST', body);
export const put = <T,>(path: string, body?: unknown) => api<T>(path, 'PUT', body);
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, 'PATCH', body);
export const del = <T,>(path: string, body?: unknown) => api<T>(path, 'DELETE', body);
