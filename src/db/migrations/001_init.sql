-- 001_init: snapshots + sync_runs
--
-- Design notes:
--   * Append-only. A correction is a NEW row with a later captured_at, never an UPDATE.
--     "Latest" always means "highest captured_at for that (program_key, period, local_date)".
--   * Money is stored in MINOR UNITS (integer cents) to avoid float drift. Never store dollars.
--   * A metric that the program does not track is NULL, not 0. Blue Ridge tracks by coupon
--     code and reports no clicks; NULL is what makes the UI render "n/a" instead of "0".
--   * raw_json holds whatever the adapter scraped (label/value pairs, page text, response
--     bodies) so that numbers can be re-derived later if the parsing turns out to be wrong,
--     without re-scraping.

CREATE TABLE IF NOT EXISTS sync_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at          TEXT    NOT NULL,          -- ISO-8601 UTC
  finished_at         TEXT,                      -- NULL while the run is in flight
  programs_attempted  INTEGER NOT NULL DEFAULT 0,
  programs_succeeded  INTEGER NOT NULL DEFAULT 0,
  trigger             TEXT    NOT NULL DEFAULT 'manual'
                        CHECK (trigger IN ('manual', 'ui', 'cron')),
  notes               TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_run_id       INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL,
  program_key       TEXT    NOT NULL,
  captured_at       TEXT    NOT NULL,            -- ISO-8601 UTC, when we read the number
  local_date        TEXT    NOT NULL,            -- YYYY-MM-DD in the configured timezone;
                                                 -- the calendar day this snapshot describes
  period            TEXT    NOT NULL
                      CHECK (period IN ('today', 'mtd', 'alltime')),

  clicks            INTEGER,                     -- NULL = not tracked / not found
  conversions       INTEGER,
  earnings          INTEGER,                     -- minor units
  unpaid_earnings   INTEGER,                     -- minor units
  paid_earnings     INTEGER,                     -- minor units
  conversion_rate   REAL,                        -- fraction, e.g. 0.0325 == 3.25%
  currency          TEXT    NOT NULL DEFAULT 'USD',

  source            TEXT    NOT NULL
                      CHECK (source IN ('scrape', 'manual')),
  status            TEXT    NOT NULL
                      CHECK (status IN ('ok', 'failed', 'partial')),
  error_message     TEXT,                        -- populated when status != 'ok'
  raw_json          TEXT,                        -- raw scraped blob, for re-derivation

  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The hot path: "latest row per program for this day and period".
CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
  ON snapshots (program_key, period, local_date, captured_at DESC);

-- The chart path: 30 days of daily earnings across all programs.
CREATE INDEX IF NOT EXISTS idx_snapshots_period_date
  ON snapshots (period, local_date);

CREATE INDEX IF NOT EXISTS idx_snapshots_run
  ON snapshots (sync_run_id);
