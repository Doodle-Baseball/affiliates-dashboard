/**
 * Sample data for demo mode.
 *
 * Used only when a serverless deployment has no database configured, where the
 * alternative is an error page. These numbers are invented — the UI labels them
 * as such in a banner — and exist so the dashboard can be looked at and clicked
 * through before anyone has signed up for anything.
 *
 * The generator is deterministic, seeded from the program key and the date, so
 * every serverless instance produces the same figures and the page does not
 * change shape as requests land on different instances.
 */
import { insertSnapshot, startSyncRun, finishSyncRun } from './queries.js';
import { query } from './index.js';
import { lastNDates } from '../lib/dates.js';

const SHAPE = {
  american_peptides: { earnings: 3200, clicks: 210, rate: 0.028 },
  ameano_peptides: { earnings: 1500, clicks: 96, rate: 0.021 },
  idun_peptides: { earnings: 6400, clicks: 340, rate: 0.035 },
  synthesis_peptides: { earnings: 2100, clicks: 130, rate: 0.024 },
  // Coupon-code tracking: no clicks, ever. The demo has to show that too,
  // because "n/a rather than 0" is the behaviour most worth seeing.
  blue_ridge_peptides: { earnings: 900, clicks: null, rate: null },
};

/** Deterministic 0..1 from a string — same input, same figure, every instance. */
function hashUnit(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

export async function isEmpty() {
  const rows = await query('SELECT COUNT(*) AS n FROM snapshots');
  return Number(rows[0]?.n || 0) === 0;
}

export async function seedDemoData(programs, { days = 30, today } = {}) {
  const dates = lastNDates(days, today);

  for (const date of dates) {
    const runId = await startSyncRun({ trigger: 'cron', programsAttempted: programs.length });
    let succeeded = 0;

    for (const program of programs) {
      const shape = SHAPE[program.key];
      if (!shape) continue;

      // One program is missing two days, so the chart shows a real gap rather
      // than a suspiciously complete line.
      if (program.key === 'ameano_peptides' && (date === dates[17] || date === dates[18])) continue;

      // Synthesis gets no successful row today, so today's failure below is
      // the only thing known about it and the card actually renders as failed.
      // (A later failure never replaces an earlier success — that is the
      // point of the rule — so seeding both would just hide the failure.)
      if (program.key === 'synthesis_peptides' && date === dates[dates.length - 1]) continue;

      const wobble = 0.55 + hashUnit(`${program.key}:${date}`) * 0.95;
      const earnings = Math.round(shape.earnings * wobble);
      const clicks = shape.clicks === null ? null : Math.round(shape.clicks * wobble);
      const conversions = Math.max(0, Math.round((clicks ?? 40) * (shape.rate ?? 0.03)));

      await insertSnapshot({
        syncRunId: runId,
        programKey: program.key,
        date,
        period: 'today',
        clicks,
        conversions,
        earnings,
        unpaidEarnings: earnings * 6,
        paidEarnings: earnings * 12,
        conversionRate: clicks ? conversions / clicks : null,
        currency: program.currency || 'USD',
        source: program.adapter === 'manual' ? 'manual' : 'scrape',
        status: 'ok',
        capturedAt: `${date}T15:04:00.000Z`,
        raw: { demo: true },
      });
      succeeded += 1;
    }
    await finishSyncRun(runId, { programsSucceeded: succeeded });
  }

  // Today's two imperfect states, which are the ones the dashboard most needs
  // to show well: one outright failure, and one partial scrape that found some
  // metrics and not others.
  const lastDate = dates[dates.length - 1];
  const runId = await startSyncRun({ trigger: 'ui', programsAttempted: 2 });
  await insertSnapshot({
    syncRunId: runId,
    programKey: 'synthesis_peptides',
    date: lastDate,
    period: 'today',
    currency: 'USD',
    source: 'scrape',
    status: 'failed',
    errorMessage: 'login blocked by cloudflare — this program is manual-only',
    capturedAt: `${lastDate}T16:20:00.000Z`,
    raw: { demo: true },
  });
  await insertSnapshot({
    syncRunId: runId,
    programKey: 'american_peptides',
    date: lastDate,
    period: 'today',
    clicks: 188,
    conversions: 5,
    earnings: 2980,
    unpaidEarnings: 21400,
    paidEarnings: null,
    conversionRate: 5 / 188,
    currency: 'USD',
    source: 'scrape',
    status: 'partial',
    errorMessage: 'not found on the page: paidEarnings',
    capturedAt: `${lastDate}T16:20:00.000Z`,
    raw: { demo: true },
  });
  await finishSyncRun(runId, { programsSucceeded: 1 });
}
