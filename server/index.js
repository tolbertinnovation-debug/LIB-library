import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seed } from './seed/seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || (production ? 3000 : 3001);
const dbFile = process.env.DATABASE_PATH || path.join(ROOT, 'data', 'library.db');

const db = openDb(dbFile);
if (seed(db, { demo: process.env.SEED_DEMO !== 'false', log: (m) => console.log(m) })) {
  console.log('Seeded the founding collection.');
}

const app = createApp({
  db,
  serveClient: production,
  secureCookies: process.env.SECURE_COOKIES === 'true',
  // Accounts registered with these emails become librarians automatically.
  adminEmails: (process.env.ADMIN_EMAILS || '').split(','),
});

const server = app.listen(port, () => {
  console.log(`Liberia Online Library is open at http://localhost:${port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
