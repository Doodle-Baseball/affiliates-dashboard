# Deploying to Vercel

## What actually runs where, and why

Vercel runs serverless functions. Two things this project does cannot happen
there, no matter how it is configured:

- **The filesystem does not persist.** A SQLite file written during one request
  is gone by the next. So the database has to be hosted.
- **Chromium cannot run in a function.** Playwright plus a browser blows past
  the bundle size limit, and a five-site login-and-scrape takes minutes against
  a function timeout measured in seconds.

So the work is split, and each half runs where it can:

```
   your machine                          Vercel
   ────────────                          ──────
   npm run sync                          dashboard UI
     └ Playwright logs in, scrapes       API (read + manual entry)
     └ writes snapshots  ─────────────►  reads the same hosted database
       (directly, or via /api/ingest)
```

You open one URL on your phone in the morning and see all five programs.
The scraping happens at home on cron. **Manual entry works entirely on Vercel**,
so a program no scraper can reach is still a form you fill from anywhere.

---

## 0. What you get before configuring anything

Deploy with no environment variables at all and the dashboard **loads** rather
than erroring. A serverless instance with no `DATABASE_URL` runs in **demo
mode**: an in-memory database seeded with obviously-sample figures, so you can
click through the cards, the table, the chart and the manual-entry form
immediately. A banner across the top says the data is not real and nothing is
saved, and every instance regenerates the same figures.

Demo mode waives the dashboard password, which is only safe because there is
nothing real behind it. **The moment `DATABASE_URL` is set, the password becomes
mandatory again** — a deployment holding your actual earnings will not serve a
single request without `DASHBOARD_PASSWORD`.

Everything below turns the demo into your real dashboard.

## 1. Create the database

Any libSQL/Turso database works, and the free tier is more than enough — this
stores a few hundred rows a month.

```bash
brew install tursodatabase/tap/turso   # or: curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup
turso db create affiliates
turso db show affiliates --url          # -> libsql://affiliates-you.turso.io
turso db tokens create affiliates       # -> the auth token
```

Create the schema in it from your machine:

```bash
DATABASE_URL='libsql://affiliates-you.turso.io' \
DATABASE_AUTH_TOKEN='...' \
npm run migrate
```

## 2. Pick your two secrets

```bash
node -e "console.log('DASHBOARD_PASSWORD=' + require('crypto').randomBytes(9).toString('base64url'))"
node -e "console.log('INGEST_TOKEN=' + require('crypto').randomBytes(24).toString('hex'))"
```

`DASHBOARD_PASSWORD` is what you type to open the dashboard. `INGEST_TOKEN` is
what your machine uses to push snapshots — it is write-only and cannot read your
history, so a leak of it exposes nothing.

**The deployment refuses to serve without `DASHBOARD_PASSWORD`.** It returns a
500 explaining why rather than quietly publishing your earnings.

## 3. Deploy

```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL production          # libsql://…
vercel env add DATABASE_AUTH_TOKEN production
vercel env add DASHBOARD_PASSWORD production
vercel env add INGEST_TOKEN production
vercel --prod
```

Or connect the GitHub repo at vercel.com/new and set the same four variables
under Settings → Environment Variables. `vercel.json` already routes `/api/*` to
the function and everything else to the built UI, and `npm run build` is the
build command.

## 4. Point your machine at it

In your local `.env`:

```
DASHBOARD_URL=https://your-app.vercel.app
INGEST_TOKEN=<the same token>
```

Then either:

**Push over HTTP** — your machine never needs the database credentials:

```bash
npm run sync -- --push
```

**Or write straight to the shared database** — simpler, one less moving part.
Put `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in your local `.env` too, and plain
`npm run sync` writes where the dashboard reads.

Cron, three times a day:

```cron
0 8,14,21 * * *  cd /path/to/affiliates-dashboard && SYNC_TRIGGER=cron /usr/local/bin/npm run sync -- --push --quiet >> logs/cron.log 2>&1
```

---

## What the deployed dashboard will not do

- **No "Sync all" button.** It has no browser. The UI replaces the button with
  "synced from your machine", and `/api/sync` answers 501 with that explanation
  rather than failing obscurely.
- **No discovery.** `npm run discover` is a local, supervised step by design.
- **No cookie jars.** Saved affiliate sessions live on your machine only, which
  is where you want them.

## If you would rather deploy the whole thing, scraping included

Vercel is the wrong shape for that; a container host is the right one. On
Fly.io, Railway, Render or any small VPS, the project runs **unchanged** —
SQLite on a mounted volume, Playwright installed, cron in the container, no
split and no ingest endpoint. Set `DASHBOARD_PASSWORD` there too; the same auth
applies to any deployment. That is a smaller change than this one, not a bigger
one — say the word and I will write the Dockerfile.

## Troubleshooting

| Symptom | Cause |
|---|---|
| 500: `DASHBOARD_PASSWORD is not set` | Set it in Vercel env vars and redeploy |
| Dashboard loads but is empty | The database is fresh — run a sync, or enter a day by hand |
| `SQLITE_CANTOPEN` / read-only filesystem | `DATABASE_URL` is missing, so it fell back to a local file |
| Sign-in works, then fails next day | `DASHBOARD_PASSWORD` changed; sessions are signed with it, so they all invalidate |
| `push rejected (401)` | `INGEST_TOKEN` differs between your `.env` and Vercel |
