/**
 * JSON API for the dashboard.
 *
 * Runs in two places, from one file:
 *   • locally — bound to 127.0.0.1, browser syncs available, no password needed
 *   • deployed — password-protected, no browser, snapshots arrive via /ingest
 *
 * Money crosses this boundary in MINOR UNITS, exactly as stored. Formatting is
 * the UI's job; the API never rounds and never turns a null into a 0.
 */
import express from 'express';
import { loadPrograms, settings } from '../config/index.js';
import { getAdapter } from '../adapters/index.js';
import {
  insertSnapshot, snapshotsForDate, snapshotsBetween,
  snapshotHistory, datesWithData, recentSyncRuns, startSyncRun, finishSyncRun,
} from '../db/queries.js';
import {
  combineTotals, latestPerProgram, newestPerProgram, dailyEarningsSeries,
} from '../lib/aggregate.js';
import { localDate, lastNDates, isIsoDate } from '../lib/dates.js';
import {
  authConfig, checkPassword, checkIngestToken, issueToken, sessionCookie,
  clearCookie, requireAuth, isSignedIn, isDeployed,
} from './auth.js';

/** Express 4 does not catch rejected promises; this makes async handlers safe. */
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function today() {
  return localDate(new Date(), settings.timezone);
}

function programSummary(program) {
  const adapter = getAdapter(program.adapter);
  return {
    key: program.key,
    displayName: program.displayName,
    storeUrl: program.storeUrl,
    dashboardUrl: program.dashboardUrl,
    commissionRate: program.commissionRate,
    cookieWindowDays: program.cookieWindowDays ?? null,
    currency: program.currency || 'USD',
    adapter: adapter.name,
    platform: adapter.platform,
    manualOnly: adapter.manualOnly === true,
    tracking: program.tracking || null,
    expectedMetrics: program.expectedMetrics || {},
    notes: program.notes || null,
  };
}

function serialiseSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
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
  };
}

/** Empty string means "I don't have this number" -> null, never 0. */
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const majorToMinor = (value) => {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed * 100);
};

export function createApi({ log }) {
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));

  /* ----------------------------------------------------------- sessions -- */

  api.get('/auth', (req, res) => {
    const { enabled } = authConfig();
    res.json({ authRequired: enabled, signedIn: isSignedIn(req), deployed: isDeployed() });
  });

  api.post('/login', (req, res) => {
    const { enabled, secret } = authConfig();
    if (!enabled) return res.json({ ok: true, authRequired: false });
    if (!checkPassword(req.body?.password)) {
      log.warn('failed sign-in attempt');
      return res.status(401).json({ error: 'That password is not right.' });
    }
    res.setHeader('Set-Cookie', sessionCookie(issueToken(secret), { secure: isDeployed() }));
    res.json({ ok: true });
  });

  api.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', clearCookie());
    res.json({ ok: true });
  });

  /* -------------------------------------------------------------- ingest -- */

  /**
   * Snapshots pushed from a machine that can run a browser.
   *
   * This is how a deployed dashboard gets scraped data: Vercel cannot run
   * Chromium, so `npm run sync -- --push` runs the scrape at home and posts the
   * results here. Authenticated by INGEST_TOKEN, which is write-only — it
   * cannot read history.
   */
  api.post('/ingest', route(async (req, res) => {
    const { ingestToken } = authConfig();
    if (!ingestToken) {
      return res.status(503).json({ error: 'INGEST_TOKEN is not configured on this deployment' });
    }
    if (!checkIngestToken(req)) {
      log.warn('rejected ingest with a bad token');
      return res.status(401).json({ error: 'bad ingest token' });
    }

    const snapshots = Array.isArray(req.body?.snapshots) ? req.body.snapshots : null;
    if (!snapshots || snapshots.length === 0) {
      return res.status(400).json({ error: 'expected a non-empty "snapshots" array' });
    }
    if (snapshots.length > 500) {
      return res.status(413).json({ error: 'too many snapshots in one push (max 500)' });
    }

    const known = new Set(loadPrograms().map((p) => p.key));
    const runId = await startSyncRun({
      trigger: 'cron',
      programsAttempted: new Set(snapshots.map((s) => s.programKey)).size,
      notes: `pushed from ${req.body.origin || 'a local sync'}`,
    });

    const accepted = [];
    const rejected = [];
    for (const snapshot of snapshots) {
      if (!known.has(snapshot.programKey)) {
        rejected.push({ programKey: snapshot.programKey, reason: 'unknown program' });
        continue;
      }
      try {
        // Amounts arrive already in minor units — this is machine-to-machine.
        const id = await insertSnapshot({ ...snapshot, syncRunId: runId });
        accepted.push(id);
      } catch (error) {
        rejected.push({ programKey: snapshot.programKey, reason: error.message });
      }
    }

    await finishSyncRun(runId, {
      programsSucceeded: new Set(
        snapshots.filter((s) => s.status !== 'failed').map((s) => s.programKey),
      ).size,
    });

    log.info(`ingested ${accepted.length} snapshots`, { rejected: rejected.length });
    res.json({ ok: true, runId, accepted: accepted.length, rejected });
  }));

  /* ----------------------------- everything below needs a signed-in user -- */

  api.use(requireAuth({ open: ['/auth', '/login', '/logout', '/ingest'] }));

  api.get('/programs', (req, res) => {
    res.json({ programs: loadPrograms().map(programSummary), timezone: settings.timezone });
  });

  api.get('/dashboard', route(async (req, res) => {
    const date = isIsoDate(req.query.date) ? req.query.date : today();
    const period = ['today', 'mtd', 'alltime'].includes(req.query.period) ? req.query.period : 'today';

    const rows = await snapshotsForDate(date, period);
    const best = latestPerProgram(rows);
    const newest = newestPerProgram(rows);
    const newestByKey = new Map(newest.map((r) => [r.program_key, r]));
    const bestByKey = new Map(best.map((r) => [r.program_key, r]));

    const programs = loadPrograms().map((program) => {
      const value = bestByKey.get(program.key) || null;
      const attempt = newestByKey.get(program.key) || null;
      return {
        ...programSummary(program),
        snapshot: serialiseSnapshot(value),
        // When the value shown came from an earlier entry and the most recent
        // attempt failed, the card needs to say both things.
        lastAttempt: attempt && value && attempt.id !== value.id ? serialiseSnapshot(attempt) : null,
        hasData: Boolean(value && value.status !== 'failed'),
      };
    });

    res.json({
      date,
      period,
      isToday: date === today(),
      timezone: settings.timezone,
      totals: combineTotals(best),
      programs,
      canSync: !isDeployed(),
      lastSyncedAt: newest.length ? newest.map((r) => r.captured_at).sort().slice(-1)[0] : null,
    });
  }));

  api.get('/chart', route(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const endDate = isIsoDate(req.query.date) ? req.query.date : today();
    const dates = lastNDates(days, endDate);
    const rows = await snapshotsBetween(dates[0], dates[dates.length - 1], 'today');
    const { series } = dailyEarningsSeries(rows, dates);

    const names = new Map(loadPrograms().map((p) => [p.key, p.displayName]));
    res.json({
      dates,
      series: series.map((s) => ({ ...s, displayName: names.get(s.programKey) || s.programKey })),
      currency: 'USD',
    });
  }));

  api.get('/history/:programKey', route(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json({
      programKey: req.params.programKey,
      snapshots: (await snapshotHistory(req.params.programKey, { limit })).map(serialiseSnapshot),
    });
  }));

  api.get('/dates', route(async (req, res) => {
    res.json({ dates: await datesWithData(), today: today() });
  }));

  api.get('/runs', route(async (req, res) => {
    res.json({ runs: await recentSyncRuns(20) });
  }));

  /* ------------------------------------------------------- manual entry -- */

  /**
   * Manual entry is a first-class write path, not a patch on top of scraping:
   * same table, same shape, source 'manual'. Amounts arrive as major units
   * (what you type is what you saw) and are converted here.
   */
  api.post('/manual', route(async (req, res) => {
    const body = req.body || {};
    const program = loadPrograms().find((p) => p.key === body.programKey);
    if (!program) return res.status(400).json({ error: `unknown program "${body.programKey}"` });

    const date = isIsoDate(body.date) ? body.date : today();
    const period = ['today', 'mtd', 'alltime'].includes(body.period) ? body.period : 'today';
    const clicks = num(body.clicks);
    const conversions = num(body.conversions);

    try {
      const id = await insertSnapshot({
        programKey: program.key,
        date,
        period,
        clicks: clicks === null ? null : Math.round(clicks),
        conversions: conversions === null ? null : Math.round(conversions),
        earnings: majorToMinor(body.earnings),
        unpaidEarnings: majorToMinor(body.unpaidEarnings),
        paidEarnings: majorToMinor(body.paidEarnings),
        conversionRate: clicks && clicks > 0 && conversions !== null ? conversions / clicks : null,
        currency: body.currency || program.currency || 'USD',
        source: 'manual',
        status: 'ok',
        raw: { enteredBy: 'manual-form', note: body.note || null, submittedAt: new Date().toISOString() },
      });
      log.info(`manual entry for ${program.key} on ${date}`, { snapshotId: id });
      res.json({ ok: true, snapshotId: id, date, period });
    } catch (error) {
      log.error(`manual entry failed: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  }));

  /* --------------------------------------------------------------- sync -- */

  const noBrowserHere = (res) =>
    res.status(501).json({
      error:
        'This deployment cannot run a browser, so it cannot scrape. Run `npm run sync -- --push` on your own machine — it scrapes locally and posts the results here.',
    });

  let activeSync = null;

  api.get('/sync/stream', (req, res) => {
    if (isDeployed()) return noBrowserHere(res);
    if (activeSync) return res.status(409).json({ error: 'a sync is already running' });

    const requested = typeof req.query.programs === 'string' && req.query.programs.length
      ? new Set(req.query.programs.split(','))
      : null;
    const programs = loadPrograms().filter((p) => !requested || requested.has(p.key));
    if (programs.length === 0) return res.status(400).json({ error: 'no matching programs' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);

    import('../sync/runner.js')
      .then(({ createSyncStream }) => {
        const { emitter, promise } = createSyncStream({
          programs,
          trigger: 'ui',
          date: isIsoDate(req.query.date) ? req.query.date : today(),
          log,
        });
        activeSync = promise;
        for (const event of ['run:start', 'program:start', 'program:done']) {
          emitter.on(event, (payload) => send(event, payload));
        }
        return promise.then((result) => send('run:done', result));
      })
      .catch((error) => send('run:error', { error: error.message }))
      .finally(() => {
        clearInterval(keepAlive);
        activeSync = null;
        res.end();
      });

    req.on('close', () => clearInterval(keepAlive));
  });

  api.post('/sync', route(async (req, res) => {
    if (isDeployed()) return noBrowserHere(res);
    if (activeSync) return res.status(409).json({ error: 'a sync is already running' });

    const requested = Array.isArray(req.body?.programs) ? new Set(req.body.programs) : null;
    const programs = loadPrograms().filter((p) => !requested || requested.has(p.key));
    const { createSyncStream } = await import('../sync/runner.js');
    const { promise } = createSyncStream({ programs, trigger: 'ui', date: today(), log });
    activeSync = promise;
    try {
      res.json(await promise);
    } finally {
      activeSync = null;
    }
  }));

  api.get('/sync/status', (req, res) =>
    res.json({ running: activeSync !== null, canSync: !isDeployed() }));

  return api;
}
