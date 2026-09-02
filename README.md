# Affiliate earnings dashboard

One local page showing today's clicks, conversions, earnings and unpaid balance
across five affiliate programs. Data comes from **authenticated scraping** —
none of these platforms expose an API to affiliates — with **manual entry** as a
first-class fallback for any site that scraping can't reach.

> **Status: phase 1 (scaffold) + phase 2 tooling.** The database, config,
> parsers and discovery tool are done and tested. Adapters, the sync
> orchestrator and the UI come next, once discovery has shown what each site
> actually runs. See `HANDOFF.md` (added in phase 6) for per-adapter status.

## Setup

```bash
npm install
npx playwright install chromium   # one-off browser download
npm run setup                     # creates .env, data/, logs/, runs migrations
```

Then fill in `.env` (it is gitignored — passwords never enter the repo):

```
AFFILIATE_EMAIL=you@example.com
AFFILIATE_USERNAME=adamdan6688
AMERICAN_PEPTIDES_PASSWORD=...
AMEANO_PEPTIDES_PASSWORD=...
IDUN_PEPTIDES_PASSWORD=...
SYNTHESIS_PEPTIDES_PASSWORD=...
BLUE_RIDGE_PEPTIDES_PASSWORD=...
```

`npm run setup` is safe to re-run and will tell you which values are still missing.

## First-run login (discovery)

```bash
npm run discover                            # all five, visible browser
npm run discover -- --program=idun_peptides # just one
npm run discover -- --manual                # you type the login yourself (2FA, Cloudflare)
```

For each program this opens the dashboard, logs in, saves the session cookies to
`data/storage/<key>.json`, dumps the rendered HTML to `research/<key>.html`,
screenshots it, lists every label/number pair it can see, and writes
`research/discovery-report.json`.

Later syncs reuse the saved session and only log in again when it has expired.
`data/`, `research/` and `logs/` are all gitignored — they contain live cookies
and your account figures.

## Layout

```
config/programs.json    every non-secret fact about a program
src/config/             config + credential loading
src/db/                 connection, migrations, query layer
src/db/migrations/      versioned SQL, applied in filename order
src/lib/money.js        money/count/percent parsing -> integer minor units
src/lib/aggregate.js    pure snapshot aggregation (no I/O — this is what tests cover)
src/lib/fingerprint.js  "what platform is this site running"
src/adapters/           one file per platform  (phase 3)
src/scripts/            setup, migrate, discover, sync
tests/                  money parser + aggregation
```

## Adding a sixth program

1. Add one entry to `config/programs.json`.
2. Add its password to `.env` under the `passwordEnv` name you chose.
3. Run `npm run discover -- --program=<key>` and read the HTML dump.
4. If it runs a platform that already has an adapter, point `adapter` at it and
   you are done. Otherwise drop one file in `src/adapters/`.

Nothing else changes.

## Tests

```bash
npm test
```

Covers the money parser (US and European formatting, negatives, sub-cent
rounding, "not tracked" vs zero) and the aggregation logic (latest-wins,
null-preserving sums, failed programs excluded from totals).
