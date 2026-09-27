import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { seed } from '../server/seed/seed.js';

/**
 * Start a fresh seeded library on a random port.
 * Returns a tiny client whose sessions are kept per "agent".
 */
export async function startLibrary({ demo = true, fetchImpl } = {}) {
  const clock = { t: Date.parse('2026-03-01T12:00:00Z') };
  const db = openDb(':memory:');
  seed(db, { now: clock.t, demo });
  const app = createApp({ db, now: () => clock.t, fetchImpl });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  function agent() {
    let cookie = '';
    async function call(method, path, body) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (method !== 'GET') headers['content-type'] = 'application/json';
      const res = await fetch(base + path, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: res.status, body: json, headers: res.headers };
    }
    return {
      get: (p) => call('GET', p),
      post: (p, b) => call('POST', p, b),
      put: (p, b) => call('PUT', p, b),
      patch: (p, b) => call('PATCH', p, b),
      del: (p, b) => call('DELETE', p, b),
      async login(email, password) {
        const r = await call('POST', '/api/auth/login', { email, password });
        if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
        return r.body.user;
      },
      async register(name, email, password = 'correct horse') {
        const r = await call('POST', '/api/auth/register', { name, email, password });
        if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
        return r.body.user;
      },
    };
  }

  return {
    db,
    base,
    clock,
    agent,
    advanceDays: (d) => {
      clock.t += d * 86400000;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
