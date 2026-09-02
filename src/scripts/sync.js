/**
 * One headless sync run, then exit. This is what cron calls.
 *
 *   npm run sync
 *   npm run sync -- --program=idun_peptides
 *   npm run sync -- --date=2026-09-01
 *
 * Exit codes: 0 every program succeeded, 1 some failed, 2 all failed.
 * Every run appends to logs/sync.log (rotating).
 */
import { loadPrograms, settings } from '../config/index.js';
import { migrate, closeDb } from '../db/index.js';
import { runSync } from '../sync/runner.js';
import { createLogger } from '../lib/logger.js';
import { localDate } from '../lib/dates.js';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--program='))?.split('=')[1] || null;
const date = args.find((a) => a.startsWith('--date='))?.split('=')[1] || null;
const quiet = args.includes('--quiet');

const log = createLogger('sync', { console: !quiet });

async function main() {
  migrate();

  const programs = loadPrograms().filter((p) => !only || p.key === only);
  if (programs.length === 0) {
    log.error(`no program matched --program=${only}`);
    process.exit(2);
  }

  const { attempted, succeeded, results } = await runSync({
    programs,
    trigger: process.env.SYNC_TRIGGER === 'cron' ? 'cron' : 'manual',
    date: date || localDate(new Date(), settings.timezone),
    log,
  });

  if (!quiet) {
    console.log('');
    for (const result of results) {
      const mark = result.status === 'failed' ? 'x' : result.status === 'partial' ? '~' : '+';
      console.log(`  ${mark} ${result.programKey}${result.error ? ` — ${result.error}` : ` (${result.status})`}`);
    }
    console.log(`\n  ${succeeded}/${attempted} succeeded. Log: ${log.file}\n`);
  }

  closeDb();
  process.exit(succeeded === attempted ? 0 : succeeded === 0 ? 2 : 1);
}

main().catch((error) => {
  log.error(`sync crashed: ${error.message}`, { stack: error.stack });
  closeDb();
  process.exit(2);
});
