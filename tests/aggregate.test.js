import { describe, it, expect } from 'vitest';
import {
  latestPerProgram, newestPerProgram, sumNullable, combineTotals, dailyEarningsSeries,
} from '../src/lib/aggregate.js';

const snapshot = (over = {}) => ({
  id: 1,
  program_key: 'idun_peptides',
  captured_at: '2026-09-02T09:00:00.000Z',
  local_date: '2026-09-02',
  period: 'today',
  clicks: 10,
  conversions: 1,
  earnings: 2000,
  unpaid_earnings: 2000,
  paid_earnings: 0,
  conversion_rate: 0.1,
  currency: 'USD',
  source: 'scrape',
  status: 'ok',
  error_message: null,
  ...over,
});

describe('latestPerProgram', () => {
  it('keeps only the newest row per program', () => {
    const rows = [
      snapshot({ id: 1, program_key: 'a', captured_at: '2026-09-02T09:00:00.000Z', earnings: 100 }),
      snapshot({ id: 2, program_key: 'a', captured_at: '2026-09-02T15:00:00.000Z', earnings: 300 }),
      snapshot({ id: 3, program_key: 'b', captured_at: '2026-09-02T09:00:00.000Z', earnings: 50 }),
    ];
    const latest = latestPerProgram(rows);
    expect(latest).toHaveLength(2);
    expect(latest.find((r) => r.program_key === 'a').earnings).toBe(300);
  });

  it('breaks a captured_at tie on the higher id, so a manual correction wins', () => {
    const rows = [
      snapshot({ id: 7, program_key: 'a', source: 'scrape', earnings: 100 }),
      snapshot({ id: 8, program_key: 'a', source: 'manual', earnings: 999 }),
    ];
    expect(latestPerProgram(rows)[0].earnings).toBe(999);
  });

  it('returns an empty array for no rows', () => {
    expect(latestPerProgram([])).toEqual([]);
  });

  it('does not let a later failure erase a value already known for the day', () => {
    // Manual entry at 09:00, then the 15:00 cron fails against the same site.
    // The morning's numbers must survive.
    const rows = [
      snapshot({ id: 1, program_key: 'a', captured_at: '2026-09-02T09:00:00.000Z', source: 'manual', status: 'ok', earnings: 4200 }),
      snapshot({ id: 2, program_key: 'a', captured_at: '2026-09-02T15:00:00.000Z', source: 'scrape', status: 'failed', earnings: null, error_message: 'login rejected' }),
    ];
    const latest = latestPerProgram(rows);
    expect(latest).toHaveLength(1);
    expect(latest[0].earnings).toBe(4200);
    expect(latest[0].source).toBe('manual');
  });

  it('falls back to the newest failure when nothing succeeded', () => {
    const rows = [
      snapshot({ id: 1, program_key: 'a', captured_at: '2026-09-02T09:00:00.000Z', status: 'failed', error_message: 'timeout' }),
      snapshot({ id: 2, program_key: 'a', captured_at: '2026-09-02T15:00:00.000Z', status: 'failed', error_message: 'login rejected' }),
    ];
    const latest = latestPerProgram(rows);
    expect(latest).toHaveLength(1);
    expect(latest[0].error_message).toBe('login rejected');
  });

  it('prefers a partial snapshot over a failure', () => {
    const rows = [
      snapshot({ id: 1, program_key: 'a', captured_at: '2026-09-02T09:00:00.000Z', status: 'partial', earnings: 100 }),
      snapshot({ id: 2, program_key: 'a', captured_at: '2026-09-02T15:00:00.000Z', status: 'failed', earnings: null }),
    ];
    expect(latestPerProgram(rows)[0].earnings).toBe(100);
  });
});

describe('newestPerProgram', () => {
  it('reports the most recent attempt even when it failed', () => {
    const rows = [
      snapshot({ id: 1, program_key: 'a', captured_at: '2026-09-02T09:00:00.000Z', status: 'ok', earnings: 4200 }),
      snapshot({ id: 2, program_key: 'a', captured_at: '2026-09-02T15:00:00.000Z', status: 'failed', error_message: 'login rejected' }),
    ];
    const newest = newestPerProgram(rows);
    expect(newest).toHaveLength(1);
    expect(newest[0].status).toBe('failed');
    expect(newest[0].error_message).toBe('login rejected');
  });
});

describe('sumNullable', () => {
  it('sums numbers', () => expect(sumNullable([1, 2, 3])).toBe(6));
  it('ignores nulls but keeps real zeros', () => expect(sumNullable([null, 0, 5])).toBe(5));
  it('returns null when everything is null', () => expect(sumNullable([null, undefined])).toBeNull());
  it('returns null for an empty list', () => expect(sumNullable([])).toBeNull());
  it('returns 0 when every contribution is a real zero', () => expect(sumNullable([0, 0])).toBe(0));
});

describe('combineTotals', () => {
  it('adds the numbers across programs', () => {
    const totals = combineTotals([
      snapshot({ program_key: 'a', clicks: 10, conversions: 1, earnings: 2000, unpaid_earnings: 2000, paid_earnings: 0 }),
      snapshot({ program_key: 'b', clicks: 30, conversions: 3, earnings: 4500, unpaid_earnings: 1500, paid_earnings: 3000 }),
    ]);
    expect(totals.clicks).toBe(40);
    expect(totals.conversions).toBe(4);
    expect(totals.earnings).toBe(6500);
    expect(totals.unpaidEarnings).toBe(3500);
    expect(totals.paidEarnings).toBe(3000);
    expect(totals.conversionRate).toBeCloseTo(0.1, 6);
    expect(totals.programsReporting).toBe(2);
  });

  it('does not let an untracked click count become a zero', () => {
    // Blue Ridge tracks by coupon code, so it reports no clicks at all.
    const totals = combineTotals([
      snapshot({ program_key: 'blue_ridge_peptides', clicks: null, conversions: 2, earnings: 1000 }),
      snapshot({ program_key: 'idun_peptides', clicks: 20, conversions: 1, earnings: 500 }),
    ]);
    expect(totals.clicks).toBe(20); // only the program that tracks clicks contributes
    expect(totals.conversions).toBe(3);
  });

  it('reports null clicks when no program tracks them', () => {
    const totals = combineTotals([
      snapshot({ program_key: 'blue_ridge_peptides', clicks: null, conversions: 2, earnings: 1000 }),
    ]);
    expect(totals.clicks).toBeNull();
    expect(totals.conversionRate).toBeNull();
  });

  it('excludes failed programs from the numbers but counts them', () => {
    const totals = combineTotals([
      snapshot({ program_key: 'a', earnings: 1000, clicks: 5, conversions: 1 }),
      snapshot({ program_key: 'b', status: 'failed', error_message: 'login failed', earnings: null, clicks: null, conversions: null }),
    ]);
    expect(totals.earnings).toBe(1000);
    expect(totals.programsReporting).toBe(1);
    expect(totals.programsFailed).toBe(1);
  });

  it('includes partial rows, which carry some numbers', () => {
    const totals = combineTotals([
      snapshot({ program_key: 'a', status: 'partial', earnings: 1000, clicks: null, conversions: 2 }),
    ]);
    expect(totals.earnings).toBe(1000);
    expect(totals.programsReporting).toBe(1);
  });

  it('never divides by zero clicks', () => {
    const totals = combineTotals([snapshot({ clicks: 0, conversions: 0 })]);
    expect(totals.conversionRate).toBeNull();
  });

  it('flags mixed currencies instead of silently adding them', () => {
    const totals = combineTotals([
      snapshot({ program_key: 'a', currency: 'USD' }),
      snapshot({ program_key: 'b', currency: 'EUR' }),
    ]);
    expect(totals.currency).toBeNull();
    expect(totals.mixedCurrencies).toEqual(['USD', 'EUR']);
  });

  it('handles a day with no data at all', () => {
    const totals = combineTotals([]);
    expect(totals).toMatchObject({ clicks: null, earnings: null, conversionRate: null, programsReporting: 0 });
  });
});

describe('dailyEarningsSeries', () => {
  const dates = ['2026-08-31', '2026-09-01', '2026-09-02'];

  it('emits one aligned value per date per program', () => {
    const rows = [
      snapshot({ program_key: 'a', local_date: '2026-08-31', earnings: 100 }),
      snapshot({ program_key: 'a', local_date: '2026-09-02', earnings: 300 }),
      snapshot({ program_key: 'b', local_date: '2026-09-01', earnings: 50 }),
    ];
    const { series } = dailyEarningsSeries(rows, dates);
    const a = series.find((s) => s.programKey === 'a');
    const b = series.find((s) => s.programKey === 'b');
    expect(a.values).toEqual([100, null, 300]);
    expect(b.values).toEqual([null, 50, null]);
  });

  it('uses the latest snapshot of each day', () => {
    const rows = [
      snapshot({ id: 1, program_key: 'a', local_date: '2026-09-02', captured_at: '2026-09-02T08:00:00.000Z', earnings: 100 }),
      snapshot({ id: 2, program_key: 'a', local_date: '2026-09-02', captured_at: '2026-09-02T20:00:00.000Z', earnings: 450 }),
    ];
    const { series } = dailyEarningsSeries(rows, dates);
    expect(series[0].values).toEqual([null, null, 450]);
  });

  it('leaves a gap rather than a zero when the only snapshot failed', () => {
    const rows = [
      snapshot({ program_key: 'a', local_date: '2026-09-01', status: 'failed', earnings: null }),
      snapshot({ program_key: 'a', local_date: '2026-09-02', earnings: 300 }),
    ];
    const { series } = dailyEarningsSeries(rows, dates);
    expect(series[0].values).toEqual([null, null, 300]);
  });

  it('returns the dates it was given', () => {
    expect(dailyEarningsSeries([], dates).dates).toEqual(dates);
    expect(dailyEarningsSeries([], dates).series).toEqual([]);
  });
});
