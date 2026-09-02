/**
 * Sync orchestration.
 *
 * One browser, one fresh context per program (so a poisoned cookie jar on one
 * site cannot leak into another), a concurrency cap, and hard error isolation:
 * a program that throws becomes one `failed` snapshot with the error message
 * attached, and every other program still runs. Nothing here rethrows into the
 * caller's face — the run always finishes and always reports.
 */
import { chromium } from 'playwright';
import { EventEmitter } from 'node:events';
import { getAdapter } from '../adapters/index.js';
import { credentialsFor, missingCredentials, settings } from '../config/index.js';
import { insertSnapshot, startSyncRun, finishSyncRun } from '../db/queries.js';
import { saveSession, hasSavedSession, sessionAgeHours, sessionPath } from '../adapters/base.js';
import { localDate, nowIso } from '../lib/dates.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Run `worker` over `items`, at most `limit` at a time. Never rejects. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function describeError(error) {
  const kind = error?.kind || error?.name || 'error';
  const message = (error?.message || String(error)).replace(/\s+/g, ' ').trim();
  return { kind, message: message.slice(0, 500) };
}

async function syncOneProgram({ browser, program, runId, date, log, emit }) {
  const adapter = getAdapter(program.adapter);
  const credentials = credentialsFor(program);
  const started = Date.now();

  emit('program:start', {
    programKey: program.key,
    displayName: program.displayName,
    adapter: adapter.name,
  });

  const fail = (kind, message) => {
    insertSnapshot({
      syncRunId: runId,
      programKey: program.key,
      date,
      period: 'today',
      currency: program.currency || 'USD',
      source: 'scrape',
      status: 'failed',
      errorMessage: message,
      raw: { kind, adapter: adapter.name, attemptedAt: nowIso() },
    });
    log.warn(`${program.key}: ${message}`, { kind });
    emit('program:done', {
      programKey: program.key,
      displayName: program.displayName,
      status: 'failed',
      kind,
      error: message,
      durationMs: Date.now() - started,
    });
    return { programKey: program.key, status: 'failed', kind, error: message };
  };

  // Cheap checks before spending a browser context on a doomed attempt.
  if (adapter.manualOnly) {
    return fail('manual', program.manualReason
      || 'manual-only: no verified scraper for this program yet — enter today\'s numbers by hand');
  }
  const missing = missingCredentials(program);
  if (missing.length) {
    return fail('credentials', `missing ${missing.join(' and ')} in .env`);
  }

  let context;
  try {
    context = await browser.newContext({
      storageState: hasSavedSession(program.key) ? sessionPath(program.key) : undefined,
      viewport: { width: 1440, height: 1000 },
      userAgent: USER_AGENT,
      locale: 'en-US',
    });
    context.setDefaultTimeout(45_000);
    const page = await context.newPage();

    const age = sessionAgeHours(program.key);
    log.info(
      `${program.key}: syncing via ${adapter.name}` +
        (age === null ? ' (no saved session)' : ` (session ${age.toFixed(1)}h old)`),
    );

    const stats = await adapter.fetchStats({ page, credentials, config: program, date, log });

    // The session is only worth keeping if we got this far.
    await saveSession(context, program.key).catch(() => {});

    const status = stats.status || 'ok';
    const snapshotId = insertSnapshot({
      syncRunId: runId,
      programKey: program.key,
      date,
      period: 'today',
      clicks: stats.clicks ?? null,
      conversions: stats.conversions ?? null,
      earnings: stats.earnings ?? null,
      unpaidEarnings: stats.unpaidEarnings ?? null,
      paidEarnings: stats.paidEarnings ?? null,
      conversionRate: stats.conversionRate ?? null,
      currency: stats.currency || program.currency || 'USD',
      source: 'scrape',
      status,
      errorMessage: stats.warning || null,
      raw: stats.raw ?? null,
    });

    // Adapters may also return other windows (AffiliateWP gives all-time).
    for (const extra of stats.additionalPeriods || []) {
      insertSnapshot({
        syncRunId: runId,
        programKey: program.key,
        date,
        period: extra.period,
        clicks: extra.clicks ?? null,
        conversions: extra.conversions ?? null,
        earnings: extra.earnings ?? null,
        unpaidEarnings: extra.unpaidEarnings ?? null,
        paidEarnings: extra.paidEarnings ?? null,
        conversionRate: extra.conversionRate ?? null,
        currency: extra.currency || program.currency || 'USD',
        source: 'scrape',
        status: extra.status || 'ok',
        errorMessage: extra.warning || null,
        raw: extra.raw ?? null,
      });
    }

    log.info(`${program.key}: ${status}`, {
      clicks: stats.clicks, conversions: stats.conversions, earnings: stats.earnings,
    });
    emit('program:done', {
      programKey: program.key,
      displayName: program.displayName,
      status,
      snapshotId,
      warning: stats.warning || null,
      clicks: stats.clicks ?? null,
      conversions: stats.conversions ?? null,
      earnings: stats.earnings ?? null,
      durationMs: Date.now() - started,
    });
    return { programKey: program.key, status, snapshotId };
  } catch (error) {
    const { kind, message } = describeError(error);
    return fail(kind, message);
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * Run a sync across programs.
 *
 * @param {object} options
 * @param {Array<object>} options.programs  program configs to sync
 * @param {'manual'|'ui'|'cron'} options.trigger
 * @param {string} [options.date]           YYYY-MM-DD the run describes
 * @param {number} [options.concurrency]
 * @param {object} options.log
 * @param {(event: string, payload: object) => void} [options.onEvent]
 * @returns {Promise<{runId:number, results:Array, succeeded:number, attempted:number}>}
 */
export async function runSync({
  programs,
  trigger = 'manual',
  date = null,
  concurrency = settings.syncConcurrency,
  log,
  onEvent = null,
}) {
  const targetDate = date || localDate(new Date(), settings.timezone);
  const emit = (event, payload) => {
    try {
      onEvent?.(event, payload);
    } catch {
      /* a listener blowing up must not take the run with it */
    }
  };

  const runId = startSyncRun({ trigger, programsAttempted: programs.length });
  log.info(`sync run ${runId} started`, { trigger, date: targetDate, programs: programs.length, concurrency });
  emit('run:start', { runId, date: targetDate, trigger, programs: programs.map((p) => ({ key: p.key, displayName: p.displayName, adapter: p.adapter })) });

  let browser = null;
  let results = [];
  try {
    const needsBrowser = programs.some((p) => !getAdapter(p.adapter).manualOnly);
    if (needsBrowser) {
      browser = await chromium.launch({ headless: !settings.headed });
    }

    results = await pool(programs, Math.max(1, concurrency), (program) =>
      syncOneProgram({ browser, program, runId, date: targetDate, log, emit }),
    );
  } catch (error) {
    // Only reached if the browser itself could not start.
    const { message } = describeError(error);
    log.error(`sync run ${runId} could not start a browser: ${message}`);
    for (const program of programs) {
      if (results.some((r) => r?.programKey === program.key)) continue;
      insertSnapshot({
        syncRunId: runId, programKey: program.key, date: targetDate, period: 'today',
        currency: program.currency || 'USD', source: 'scrape', status: 'failed',
        errorMessage: `browser launch failed: ${message}`,
      });
      results.push({ programKey: program.key, status: 'failed', error: message });
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  const succeeded = results.filter((r) => r && r.status !== 'failed').length;
  finishSyncRun(runId, {
    programsSucceeded: succeeded,
    notes: results
      .filter((r) => r && r.status === 'failed')
      .map((r) => `${r.programKey}: ${r.error}`)
      .join(' | ') || null,
  });

  log.info(`sync run ${runId} finished: ${succeeded}/${programs.length} succeeded`);
  emit('run:done', { runId, attempted: programs.length, succeeded, results });

  return { runId, results, succeeded, attempted: programs.length, date: targetDate };
}

/** EventEmitter wrapper, for streaming progress to the UI over SSE. */
export function createSyncStream(options) {
  const emitter = new EventEmitter();
  const promise = runSync({ ...options, onEvent: (event, payload) => emitter.emit(event, payload) });
  return { emitter, promise };
}
