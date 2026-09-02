/**
 * One headless sync run, then exit. This is what cron calls.
 *
 *   npm run sync                              one run against the local database
 *   npm run sync -- --program=idun_peptides
 *   npm run sync -- --date=2026-09-01
 *   npm run sync -- --push                    also push the results to a deployed dashboard
 *
 * Exit codes: 0 every program succeeded, 1 some failed, 2 all failed.
 * Every run appends to logs/sync.log (rotating).
 *
 * On --push: the scrape happens here, because this machine has a browser, and
 * the resulting snapshots are POSTed to DASHBOARD_URL/api/ingest with
 * INGEST_TOKEN. That is how a deployed dashboard gets scraped data without
 * needing to run Chromium itself. (If you would rather skip the round trip,
 * point DATABASE_URL at the same hosted database and the rows land there
 * directly — no push needed.)
 */
import { loadPrograms, settings } from '../config/index.js';
import { migrate, closeDb } from '../db/index.js';
import { runSync } from '../sync/runner.js';
import { snapshotsForRun } from '../db/queries.js';
import { createLogger } from '../lib/logger.js';
import { localDate } from '../lib/dates.js';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--program='))?.split('=')[1] || null;
const date = args.find((a) => a.startsWith('--date='))?.split('=')[1] || null;
const quiet = args.includes('--quiet');
const push = args.includes('--push');

const log = createLogger('sync', { console: !quiet });

/** POST this run's snapshots to a deployed dashboard. */
async function pushRun(runId) {
  const base = (process.env.DASHBOARD_URL || '').replace(/\/$/, '');
  const token = process.env.INGEST_TOKEN;
  if (!base || !token) {
    log.error('--push needs DASHBOARD_URL and INGEST_TOKEN in .env');
    return false;
  }

  const rows = await snapshotsForRun(runId);
  const snapshots = rows.map((row) => ({
    programKey: row.program_key,
    capturedAt: row.captured_at,
    date: row.local_date,
    period: row.period,
    clicks: row.clicks,
    conversions: row.conversions,
    earnings: row.earnings,
    unpaidEarnings: row.unpaid_earnings,
    paidEarnings: row.paid_earnings,
    conversionRate: row.conversion_rate,
    currency: row.currency,
    source: row.source,
    status: row.status,
    errorMessage: row.error_message,
    raw: row.raw_json,
  }));

  try {
    const response = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ snapshots, origin: 'npm run sync -- --push' }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      log.error(`push rejected (${response.status}): ${body.error || response.statusText}`);
      return false;
    }
    log.info(`pushed ${body.accepted} snapshots to ${base}`, {
      rejected: body.rejected?.length || 0,
    });
    return true;
  } catch (error) {
    log.error(`push failed: ${error.message}`);
    return false;
  }
}

async function main() {
  await migrate();

  const programs = loadPrograms().filter((p) => !only || p.key === only);
  if (programs.length === 0) {
    log.error(`no program matched --program=${only}`);
    process.exit(2);
  }

  const { runId, attempted, succeeded, results } = await runSync({
    programs,
    trigger: process.env.SYNC_TRIGGER === 'cron' ? 'cron' : 'manual',
    date: date || localDate(new Date(), settings.timezone),
    log,
  });

  let pushed = null;
  if (push) pushed = await pushRun(runId);

  if (!quiet) {
    console.log('');
    for (const result of results) {
      const mark = result.status === 'failed' ? 'x' : result.status === 'partial' ? '~' : '+';
      console.log(`  ${mark} ${result.programKey}${result.error ? ` — ${result.error}` : ` (${result.status})`}`);
    }
    if (pushed !== null) console.log(`\n  push: ${pushed ? 'delivered' : 'FAILED — see the log'}`);
    console.log(`\n  ${succeeded}/${attempted} succeeded. Log: ${log.file || 'stdout'}\n`);
  }

  closeDb();
  process.exit(succeeded === attempted ? 0 : succeeded === 0 ? 2 : 1);
}

main().catch((error) => {
  log.error(`sync crashed: ${error.message}`, { stack: error.stack });
  closeDb();
  process.exit(2);
});
