# Affiliate earnings dashboard

One local page showing today's clicks, conversions, earnings and unpaid balance
across five affiliate programs.

None of these platforms give **affiliates** an API — AffiliateWP, GoAffPro,
UpPromote and Refersion all expose REST APIs to the *merchant*, and an affiliate
gets an HTML dashboard behind a login form. So the data layer is authenticated
scraping with Playwright, and **manual entry is a first-class path**, not a
fallback bolted on: same table, same shape, same charts.

Runs on `127.0.0.1` with no account system by default. It can also be deployed —
see **[DEPLOY.md](DEPLOY.md)**, where a password is mandatory and the scraping
stays on your machine, because a serverless host cannot run a browser.

---

## Setup

```bash
npm install
npx playwright install chromium    # one-off browser download
npm run setup                      # creates .env, data/, logs/; runs migrations
```

Fill in `.env` — it is gitignored, and nothing writes secrets anywhere else:

```
AFFILIATE_EMAIL=you@example.com
AFFILIATE_USERNAME=adamdan6688
AMERICAN_PEPTIDES_PASSWORD=...
AMEANO_PEPTIDES_PASSWORD=...
IDUN_PEPTIDES_PASSWORD=...
SYNTHESIS_PEPTIDES_PASSWORD=...
BLUE_RIDGE_PEPTIDES_PASSWORD=...
```

Optional: `PORT` (default 4317), `TIMEZONE` (defaults to the machine's — it
decides which calendar day a snapshot belongs to), `SYNC_CONCURRENCY` (default
2), `HEADED=1` to watch the browser work.

`npm run setup` is idempotent and prints which values are still missing.

Then:

```bash
npm run dev        # API on :4317, UI on :4316 with hot reload
# or
npm start          # builds the UI and serves everything from :4317
```

---

## First run: discovery

**Do this before trusting any scraper.** It is also how the login cookies get
saved.

```bash
npm run discover                             # all five, visible browser
npm run discover -- --program=idun_peptides  # one at a time
npm run discover -- --manual                 # you type the login (2FA, Cloudflare)
npm run discover -- --headless               # re-runs, no window
```

For each program it opens the dashboard, logs in (or waits while you do),
fingerprints the platform, and writes:

| Output | What it's for |
|---|---|
| `research/<key>.html` | the rendered dashboard — read this before writing a selector |
| `research/<key>.png` | full-page screenshot |
| `research/discovery-report.json` | platform verdict, blockers, every label→number pair found |
| `data/storage/<key>.json` | the saved cookie jar, reused by later syncs |

The summary it prints tells you, per site, which platform it detected, whether
automated login worked, and whether a Cloudflare/CAPTCHA/2FA wall is in the way.
**If a site is blocked, it says so plainly — leave that program on the `manual`
adapter rather than building a workaround.**

Later syncs reuse the cookie jar and only log in again when the saved session
has expired (checked by loading the page and looking at what comes back, not by
trusting an expiry timestamp).

`data/`, `research/` and `logs/` are gitignored — they hold live cookies and
your account figures.

### After discovery: turning a program into a scraper

1. Read `research/discovery-report.json` for that program.
2. If it runs a platform that already has an adapter (`affiliatewp`), set
   `"adapter": "affiliatewp"` in `config/programs.json`.
3. If the numbers are plain text in the HTML with visible labels, try
   `"adapter": "generic"` and add label overrides if the defaults miss:
   ```json
   "adapter": "generic",
   "labels": { "earnings": "commission earned|earnings today" }
   ```
4. If it needs bespoke navigation, add `src/adapters/<platform>.js` exporting
   `fetchStats({ page, credentials, config })`.
5. Anything blocked or JS-canvas-rendered stays on `"adapter": "manual"`.

---

## Syncing

```bash
npm run sync                              # one headless run, then exit
npm run sync -- --program=idun_peptides
npm run sync -- --date=2026-09-01
npm run sync -- --push                    # also push results to a deployed dashboard
```

Programs run in parallel with a **concurrency cap of 2**. Each gets its own
browser context, so one site's broken cookie jar cannot affect another. A
program that fails is recorded as one `failed` snapshot with its error message
and the rest of the run continues — a single broken site never costs you the
other four.

Exit codes: `0` all succeeded, `1` some failed, `2` all failed. Every run
appends to `logs/sync.log`, which rotates at 2 MB and keeps 5 files.

### Cron — three times a day

```cron
# Affiliate sync at 08:00, 14:00 and 21:00 local time
0 8,14,21 * * *  cd /path/to/affiliates-dashboard && SYNC_TRIGGER=cron /usr/local/bin/npm run sync -- --quiet >> logs/cron.log 2>&1
```

Use an absolute path to `npm` — cron's `PATH` is minimal. On macOS, grant cron
(or your terminal) Full Disk Access, or the run cannot read the project.

Three a day is the right shape for these sites: the morning run is the one you
read, and the later two fill in the day's history so the 30-day chart has real
shape. A failed morning run is visible on the card, and you can fill it in by
hand — a manual entry is never overwritten by a later failed sync.

---

## How the data is stored

SQLite, two tables, **append-only** — every snapshot is kept, so history
accrues for free and a correction is a new row rather than an overwrite.

Access goes through libSQL, which speaks the same SQLite dialect against either
a local file or a hosted database. The schema and every query are identical in
both, so your laptop and a deployment run the same code and differ only by URL:

```
local     (nothing set)              -> data/affiliates.sqlite
deployed  DATABASE_URL=libsql://…    -> hosted, shared between both
```

**`snapshots`** — one row per program per sync

| column | notes |
|---|---|
| `program_key`, `captured_at` | when the number was read (ISO-8601 UTC) |
| `local_date` | the calendar day the snapshot *describes*, in your timezone |
| `period` | `today` / `mtd` / `alltime` |
| `clicks`, `conversions` | nullable |
| `earnings`, `unpaid_earnings`, `paid_earnings` | **integer minor units** (cents) |
| `conversion_rate` | fraction — `0.0325` is 3.25% |
| `source` | `scrape` or `manual` |
| `status` | `ok` / `partial` / `failed` |
| `error_message` | what went wrong, shown on the card |
| `raw_json` | the raw scraped blob |

**`sync_runs`** — `started_at`, `finished_at`, `programs_attempted`,
`programs_succeeded`, `trigger`, `notes`.

Three rules the whole app depends on:

- **Money is integer cents.** No float ever touches a stored amount.
- **`NULL` is not `0`.** A metric the program does not track stays null and
  renders as `n/a`. Blue Ridge tracks by coupon code and reports no clicks —
  that must never look like "zero clicks today". Sums preserve this: a total is
  null only when every program reported null.
- **A failure does not erase what you know.** The value shown for a day is the
  newest snapshot that actually carries numbers; a later failed sync is recorded
  and shown as a warning, but does not replace a morning's manual entry.

`raw_json` exists so that if the parsing turns out to be wrong, the numbers can
be re-derived from what was on the page without re-scraping.

---

## Adding a sixth program

1. One entry in `config/programs.json`:
   ```json
   {
     "key": "new_store",
     "displayName": "New Store",
     "dashboardUrl": "https://partners.newstore.com/",
     "commissionRate": 0.15,
     "cookieWindowDays": 60,
     "currency": "USD",
     "adapter": "manual",
     "passwordEnv": "NEW_STORE_PASSWORD",
     "loginIdentity": "email",
     "expectedMetrics": { "clicks": true, "conversions": true, "earnings": true }
   }
   ```
2. Add `NEW_STORE_PASSWORD` to `.env`.
3. `npm run discover -- --program=new_store`, read the HTML.
4. Point `adapter` at an existing one, or add one file to `src/adapters/`.

Nothing else changes. The UI, API, chart, table and colour assignment all read
from config.

---

## Layout

```
config/programs.json     every non-secret fact about a program
src/config/              config + credential loading
src/db/                  connection, migrations, query layer
src/lib/money.js         money/count/percent parsing -> integer minor units
src/lib/aggregate.js     pure snapshot aggregation (no I/O — what the tests cover)
src/lib/dates.js         timezone-aware days, tolerant date parsing
src/lib/fingerprint.js   which platform is this site running
src/adapters/base.js     sessions, login, blocker detection, findStatByLabel
src/adapters/*.js        one file per platform
src/sync/runner.js       parallel runner, concurrency cap, error isolation
src/server/app.js        the Express app, with no listener attached
src/server/index.js      binds it to 127.0.0.1 for local use
src/server/auth.js       password sessions + the write-only ingest token
api/index.js             the same app, as a Vercel serverless function
src/scripts/             setup, migrate, discover, sync
web/                     React UI (Vite)
tests/                   money parser, aggregation, date parsing
```

## Tests

```bash
npm test
```

103 tests over the money parser (US and European formatting, negatives, sub-cent
rounding, `C$` vs `$`, "not tracked" vs zero), the aggregation logic
(latest-wins, null-preserving sums, failures excluded from totals and not
clobbering known values) date handling, and the session tokens (expiry, tampering, secret rotation).
No browser tests.

## API

All on `http://127.0.0.1:4317`. Money is in minor units.

| Endpoint | Purpose |
|---|---|
| `GET /api/dashboard?date=` | totals + per-program cards for a day |
| `GET /api/chart?days=30` | daily earnings series per program |
| `GET /api/programs` | config as the UI sees it |
| `GET /api/history/:key` | every snapshot for one program |
| `GET /api/dates` | days that have data, for the date picker |
| `GET /api/runs` | recent sync runs |
| `POST /api/manual` | manual entry (amounts in whole currency) |
| `GET /api/sync/stream` | run a sync, stream per-program progress (SSE) |
| `POST /api/sync` | run a sync, respond when finished (local only) |
| `POST /api/login` | exchange the dashboard password for a session |
| `POST /api/ingest` | accept snapshots pushed from a machine that has a browser |

## Current adapter status

See **[HANDOFF.md](HANDOFF.md)** for which adapters scrape, which are
manual-only, and what would break each one.
