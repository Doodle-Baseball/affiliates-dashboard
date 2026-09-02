/**
 * JSON API for the dashboard. No auth by design — the server binds to
 * 127.0.0.1 only, and there is no account system to protect.
 *
 * Money crosses this boundary in MINOR UNITS, exactly as stored. Formatting is
 * the UI's job; the API never rounds and never turns a null into a 0.
 */
import express from 'express';
import { loadPrograms, settings } from '../config/index.js';
import { getAdapter } from '../adapters/index.js';
import {
  insertSnapshot, latestSnapshotsForDate, snapshotsForDate, snapshotsBetween,
  snapshotHistory, datesWithData, recentSyncRuns,
} from '../db/queries.js';
import {
  combineTotals, latestPerProgram, newestPerProgram, dailyEarningsSeries,
} from '../lib/aggregate.js';
import { localDate, lastNDates, isIsoDate } from '../lib/dates.js';
import { createSyncStream } from '../sync/runner.js';

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

/** Shape one snapshot row for the client. */
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

export function createApi({ log }) {
  const api = express.Router();
  api.use(express.json({ limit: '256kb' }));

  /* ----------------------------------------------------------- programs -- */

  api.get('/programs', (req, res) => {
    res.json({ programs: loadPrograms().map(programSummary), timezone: settings.timezone });
  });

  /* ---------------------------------------------------------- dashboard -- */

  api.get('/dashboard', (req, res) => {
    const date = isIsoDate(req.query.date) ? req.query.date : today();
    const period = ['today', 'mtd', 'alltime'].includes(req.query.period) ? req.query.period : 'today';

    const rows = snapshotsForDate(date, period);
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
      lastSyncedAt: newest.length
        ? newest.map((r) => r.captured_at).sort().slice(-1)[0]
        : null,
    });
  });

  /* -------------------------------------------------------------- chart -- */

  api.get('/chart', (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const endDate = isIsoDate(req.query.date) ? req.query.date : today();
    const dates = lastNDates(days, endDate);
    const rows = snapshotsBetween(dates[0], dates[dates.length - 1], 'today');
    const { series } = dailyEarningsSeries(rows, dates);

    const names = new Map(loadPrograms().map((p) => [p.key, p.displayName]));
    res.json({
      dates,
      series: series.map((s) => ({ ...s, displayName: names.get(s.programKey) || s.programKey })),
      currency: 'USD',
    });
  });

  /* ------------------------------------------------------------ history -- */

  api.get('/history/:programKey', (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json({
      programKey: req.params.programKey,
      snapshots: snapshotHistory(req.params.programKey, { limit }).map(serialiseSnapshot),
    });
  });

  api.get('/dates', (req, res) => {
    res.json({ dates: datesWithData(), today: today() });
  });

  api.get('/runs', (req, res) => {
    res.json({ runs: recentSyncRuns(20) });
  });

  /* ------------------------------------------------------- manual entry -- */

  /**
   * Manual entry is a first-class write path, not a patch on top of scraping:
   * same table, same shape, source 'manual'. Amounts arrive as major units
   * (what you type is what you saw) and are converted here.
   */
  api.post('/manual', (req, res) => {
    const body = req.body || {};
    const program = loadPrograms().find((p) => p.key === body.programKey);
    if (!program) return res.status(400).json({ error: `unknown program "${body.programKey}"` });

    const date = isIsoDate(body.date) ? body.date : today();
    const period = ['today', 'mtd', 'alltime'].includes(body.period) ? body.period : 'today';

    // Empty string means "I don't have this number" -> null, never 0.
    const num = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const money = (value) => {
      const parsed = num(value);
      return parsed === null ? null : Math.round(parsed * 100);
    };

    const clicks = num(body.clicks);
    const conversions = num(body.conversions);

    try {
      const id = insertSnapshot({
        programKey: program.key,
        date,
        period,
        clicks: clicks === null ? null : Math.round(clicks),
        conversions: conversions === null ? null : Math.round(conversions),
        earnings: money(body.earnings),
        unpaidEarnings: money(body.unpaidEarnings),
        paidEarnings: money(body.paidEarnings),
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
  });

  /* --------------------------------------------------------------- sync -- */

  let activeSync = null;

  /**
   * Server-sent events so the UI can show each program landing as it finishes,
   * rather than staring at a spinner for the whole run.
   */
  api.get('/sync/stream', (req, res) => {
    if (activeSync) {
      res.status(409).json({ error: 'a sync is already running' });
      return;
    }

    const requested = typeof req.query.programs === 'string' && req.query.programs.length
      ? new Set(req.query.programs.split(','))
      : null;
    const programs = loadPrograms().filter((p) => !requested || requested.has(p.key));
    if (programs.length === 0) {
      res.status(400).json({ error: 'no matching programs' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);

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

    promise
      .then((result) => send('run:done', result))
      .catch((error) => send('run:error', { error: error.message }))
      .finally(() => {
        clearInterval(keepAlive);
        activeSync = null;
        res.end();
      });

    req.on('close', () => clearInterval(keepAlive));
  });

  /** Non-streaming sync, for scripts and for clients that don't want SSE. */
  api.post('/sync', async (req, res) => {
    if (activeSync) return res.status(409).json({ error: 'a sync is already running' });
    const requested = Array.isArray(req.body?.programs) ? new Set(req.body.programs) : null;
    const programs = loadPrograms().filter((p) => !requested || requested.has(p.key));

    const { promise } = createSyncStream({
      programs, trigger: 'ui', date: today(), log,
    });
    activeSync = promise;
    try {
      res.json(await promise);
    } catch (error) {
      res.status(500).json({ error: error.message });
    } finally {
      activeSync = null;
    }
  });

  api.get('/sync/status', (req, res) => res.json({ running: activeSync !== null }));

  return api;
}
