# ★ Liberia Online Library

A complete public library that lives on the web — built for Liberia, open to the whole world.

- **Catalog & search** — full-text search (SQLite FTS5) with prefix matching, accent-insensitive
  (“ngugi” finds *Ngũgĩ*), filters for subject, era, availability and online reading, and seven sort orders.
- **Read online** — a distraction-free reader for public-domain books: paper / sepia / night themes,
  adjustable type, chapter navigation, search inside the book, bookmarks, saved quotes and notes,
  and automatic sync of your place across devices. Keyboard: `←`/`→` chapters, `b` bookmark,
  `t` contents, `/` search.
- **Listen** — press 🎧 in the reader. When a volunteer-narrated LibriVox recording of the book
  exists on the Internet Archive, it plays a **real human narrator**, chapter by chapter, with
  speed control, ±15/30-second skips, a sleep timer, lock-screen controls and your place remembered.
  Otherwise (or if you switch to **Follow text**) the book is read by the most natural voice on the
  device, highlighting each paragraph, pausing between sentences like a narrator, and saying
  “Mister”, “Chapter 4” and so on the way a person would. Keyboard: `l` opens the player, `space`
  plays/pauses.
- **17 complete classics are bundled** (≈1.3 million words — Austen, Carroll, Melville, Milton,
  Shakespeare, Whitman, Chesterton, Blake…), so reading works even without internet access.
  Any other catalog title with a Project Gutenberg number is downloaded on first open and cached.
- **Borrow print copies** — 14-day loans, two renewals, a fair first-come holds queue, three-day pickup
  window for ready holds, and no fines, ever.
- **My Library** — loans with due dates, holds with queue position, shelves (want / reading / finished /
  favourites), a yearly reading goal, reading streak, a 12-week activity heatmap, words-read total,
  personal recommendations, notes & quotes, loan history, and a digital library card.
- **Discover** — search 70,000+ free e-books on Project Gutenberg and add them to the library with one
  click, or search millions of Open Library records and suggest them for purchase.
- **Librarian desk** — live overview (overdue, due soon, most-wanted titles, checkouts per day),
  desk checkout by library-card number, check-in, holds list, catalog editor with full-text upload
  and automatic chapter detection, member management, and purchase-request triage.
- **A founding collection** of 84 titles with a *Liberian & African Voices* collection at its heart —
  Bai T. Moore, Helene Cooper, Wayétu Moore, Ellen Johnson Sirleaf, Leymah Gbowee, Edward Wilmot Blyden,
  Achebe, Adichie, Ngũgĩ, Emecheta, Dangarembga, Mariama Bâ, Soyinka and more.
- **Privacy & safety** — scrypt password hashing, HTTP-only session cookies, CSRF protection,
  a strict Content-Security-Policy, login rate-limiting, “download my data” and “close my account”.
- **Accessible & responsive** — keyboard-friendly, screen-reader labels, light and dark themes,
  reduced-motion support, and layouts that work from phones to wide screens.

Every book gets a generated typographic cover, so the catalog looks complete without depending on
an outside image service.

## Quick start

Requires **Node.js 22.13 or newer** (it uses the built-in `node:sqlite` — no native modules).

```bash
npm install
npm run dev        # API on :3001 + Vite on http://localhost:5173
```

The first start creates `data/library.db` and loads the founding collection plus demo activity.

| Demo account | Email | Password |
| --- | --- | --- |
| Reader | `reader@liberia.library` | `readmore` |
| Librarian | `librarian@liberia.library` | `librarian` |

The sign-in page has one-click buttons to fill these in.

### Production

```bash
npm run build      # type-checks and builds the client into dist/
npm start          # serves the API and the built site on PORT (default 3000)
```

Or with Docker:

```bash
docker build -t liberia-library .
docker run -p 3000:3000 -v library-data:/data -e SECURE_COOKIES=true liberia-library
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` (prod) / `3001` (dev) | HTTP port |
| `DATABASE_PATH` | `data/library.db` | SQLite database file |
| `SEED_DEMO` | `true` | Set to `false` to start with the catalog only (no demo members) |
| `SECURE_COOKIES` | `false` | Set to `true` when served over HTTPS |
| `ADMIN_EMAILS` | — | Comma-separated emails; accounts registered with them become librarians |

> **Before going live:** start with `SEED_DEMO=false` and set `ADMIN_EMAILS` to your email, then
> register with that email — your account becomes a librarian. From then on, librarians can promote
> others from **Desk → Members**.

### Free reading edition on GitHub Pages

GitHub Pages can’t run the server, so `npm run build:pages` builds a read-only edition: the full
catalog, search, collections and the in-browser reader for all bundled books, with no accounts or
lending. `.github/workflows/pages.yml` publishes it on every push to `main` — set
**Settings → Pages → Source** to **GitHub Actions** once.

### Deploy to Render

The repo includes a `render.yaml` blueprint. In Render choose **New → Blueprint**, pick this
repository, enter your email for `ADMIN_EMAILS`, and deploy. It builds the site, keeps the database
on a persistent 1 GB disk (Render's paid Starter plan), and serves it over HTTPS.

`npm run seed -- --reset` wipes the database and loads a fresh copy (`--no-demo` to skip demo data).

## Tests

```bash
npm test           # API, circulation rules, Gutenberg import and text splitting (node:test)
npm run typecheck  # client TypeScript
```

The suite runs each scenario against a fresh in-memory library with a controllable clock, covering
hold queues and expiry, renewal and loan limits, desk checkout, catalog edits keeping the search
index in sync, text upload, account export and deletion, and Gutenberg fetches (mocked).

## How it’s built

```
server/            Express 5 + node:sqlite
  app.js           middleware: security headers, CSRF guard, sessions, holds sweep
  db.js            schema (FTS5 search index kept in sync by triggers)
  lib/circulation.js  lending rules: loans, renewals, holds queue
  lib/text.js      turns a plain-text book into titled chapters
  lib/gutenberg.js Project Gutenberg search + on-demand text download
  routes/          auth, catalog, reader, me, admin
  seed/            founding catalog and demo data
client/            React 19 + React Router + Vite, hand-written CSS
  src/pages/       Home, Browse, BookPage, Reader, MyLibrary, Discover, Desk, …
data/texts/        bundled public-domain texts
tests/             node:test suites
```

## Sources & credits

Bundled texts are public-domain Project Gutenberg e-texts, taken from the NLTK *Gutenberg selections*
corpus (Project Gutenberg’s licence header was removed by that corpus; see gutenberg.org for the
originals). Shakespeare plays are in their original First Folio spelling. Search integrations use
the public [Gutendex](https://gutendex.com) and [Open Library](https://openlibrary.org) APIs.
Book descriptions in the catalog were written for this library.
