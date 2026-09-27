// Usage: npm run seed -- [--reset] [--no-demo]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';
import { seed } from './seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = process.env.DATABASE_PATH || path.join(ROOT, 'data', 'library.db');
const args = new Set(process.argv.slice(2));

if (args.has('--reset')) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  console.log(`Removed ${file}`);
}
const db = openDb(file);
const done = seed(db, { demo: !args.has('--no-demo'), log: (m) => console.log(m) });
console.log(done ? 'Seeded the founding collection.' : 'Catalog already has books; nothing to do (use --reset to start over).');
db.close();
