import { query, queryOne, insert, run } from './index.js';
import { nowIso, localDate } from '../lib/dates.js';
import { settings } from '../config/index.js';
import { latestPerProgram } from '../lib/aggregate.js';

/* ------------------------------------------------------------------ runs -- */

export async function startSyncRun({ trigger = 'manual', programsAttempted = 0, notes = null } = {}) {
  return insert(
    `INSERT INTO sync_runs (started_at, programs_attempted, trigger, notes)
     VALUES (?, ?, ?, ?)`,
    [nowIso(), programsAttempted, trigger, notes],
  );
}

export async function finishSyncRun(id, { programsSucceeded = 0, notes = null } = {}) {
  await run(
    `UPDATE sync_runs
        SET finished_at = ?, programs_succeeded = ?, notes = COALESCE(?, notes)
      WHERE id = ?`,
    [nowIso(), programsSucceeded, notes, id],
  );
}

export async function getSyncRun(id) {
  return queryOne('SELECT * FROM sync_runs WHERE id = ?', [id]);
}

export async function recentSyncRuns(limit = 20) {
  return query('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?', [limit]);
}

/* ------------------------------------------------------------- snapshots -- */

/**
 * Insert one snapshot. Append-only: corrections are new rows, never updates.
 * Money fields must already be in minor units.
 */
export async function insertSnapshot(snapshot) {
  const {
    syncRunId = null,
    programKey,
    capturedAt = nowIso(),
    date = null,
    period = 'today',
    clicks = null,
    conversions = null,
    earnings = null,
    unpaidEarnings = null,
    paidEarnings = null,
    conversionRate = null,
    currency = 'USD',
    source,
    status,
    errorMessage = null,
    raw = null,
  } = snapshot;

  if (!programKey) throw new Error('insertSnapshot: programKey is required');
  if (!['scrape', 'manual'].includes(source)) throw new Error(`insertSnapshot: bad source "${source}"`);
  if (!['ok', 'failed', 'partial'].includes(status)) throw new Error(`insertSnapshot: bad status "${status}"`);

  return insert(
    `INSERT INTO snapshots (
       sync_run_id, program_key, captured_at, local_date, period,
       clicks, conversions, earnings, unpaid_earnings, paid_earnings,
       conversion_rate, currency, source, status, error_message, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      syncRunId,
      programKey,
      capturedAt,
      date || localDate(new Date(capturedAt), settings.timezone),
      period,
      clicks,
      conversions,
      earnings,
      unpaidEarnings,
      paidEarnings,
      conversionRate,
      currency,
      source,
      status,
      errorMessage,
      raw === null || raw === undefined ? null : typeof raw === 'string' ? raw : JSON.stringify(raw),
    ],
  );
}

/** All snapshots for one calendar day and period (every revision, newest first). */
export async function snapshotsForDate(date, period = 'today') {
  return query(
    `SELECT * FROM snapshots
      WHERE local_date = ? AND period = ?
      ORDER BY captured_at DESC, id DESC`,
    [date, period],
  );
}

/** The newest snapshot per program for one calendar day. */
export async function latestSnapshotsForDate(date, period = 'today') {
  return latestPerProgram(await snapshotsForDate(date, period));
}

/** Snapshots across an inclusive date range, for the trend chart. */
export async function snapshotsBetween(startDate, endDate, period = 'today') {
  return query(
    `SELECT * FROM snapshots
      WHERE period = ? AND local_date BETWEEN ? AND ?
      ORDER BY local_date ASC, captured_at ASC, id ASC`,
    [period, startDate, endDate],
  );
}

/** Full revision history for one program — "my parsing was wrong" recovery. */
export async function snapshotHistory(programKey, { limit = 100 } = {}) {
  return query(
    `SELECT * FROM snapshots
      WHERE program_key = ?
      ORDER BY captured_at DESC, id DESC
      LIMIT ?`,
    [programKey, limit],
  );
}

/** Distinct days that have any snapshot, newest first — powers the date picker. */
export async function datesWithData(limit = 400) {
  return query(
    `SELECT local_date, COUNT(*) AS snapshots
       FROM snapshots
      GROUP BY local_date
      ORDER BY local_date DESC
      LIMIT ?`,
    [limit],
  );
}

/** Every snapshot written by one sync run — used to push a local run upstream. */
export async function snapshotsForRun(runId) {
  return query('SELECT * FROM snapshots WHERE sync_run_id = ? ORDER BY id ASC', [runId]);
}
