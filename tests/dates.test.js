import { describe, it, expect } from 'vitest';
import { localDate, lastNDates, isIsoDate, parseLooseDate, isSameLocalDate } from '../src/lib/dates.js';

describe('localDate', () => {
  it('uses the given timezone, not UTC, to decide the day', () => {
    // 01:30 UTC on the 3rd is still the 2nd in New York.
    const instant = new Date('2026-09-03T01:30:00.000Z');
    expect(localDate(instant, 'UTC')).toBe('2026-09-03');
    expect(localDate(instant, 'America/New_York')).toBe('2026-09-02');
  });

  it('handles a timezone ahead of UTC', () => {
    const instant = new Date('2026-09-02T23:30:00.000Z');
    expect(localDate(instant, 'Asia/Tokyo')).toBe('2026-09-03');
  });
});

describe('lastNDates', () => {
  it('returns the window oldest-first, inclusive of the end date', () => {
    const dates = lastNDates(3, '2026-09-02');
    expect(dates).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('crosses a month boundary', () => {
    expect(lastNDates(2, '2026-09-01')).toEqual(['2026-08-31', '2026-09-01']);
  });

  it('handles a single day', () => {
    expect(lastNDates(1, '2026-09-02')).toEqual(['2026-09-02']);
  });
});

describe('isIsoDate', () => {
  it.each([
    ['2026-09-02', true], ['2026-9-2', false], ['not a date', false],
    ['', false], [null, false], [undefined, false],
  ])('%s -> %s', (input, expected) => expect(isIsoDate(input)).toBe(expected));
});

describe('parseLooseDate', () => {
  // WordPress renders dates however the site's settings say, so an AffiliateWP
  // referrals table can show any of these for the same day.
  it.each([
    ['2026-09-02', '2026-09-02'],
    ['2026-09-02 14:00:00', '2026-09-02'],
    ['September 2, 2026', '2026-09-02'],
    ['Sep 2, 2026 10:14 am', '2026-09-02'],
    ['2 September 2026', '2026-09-02'],
    ['09/02/2026', '2026-09-02'],
    ['9/2/2026', '2026-09-02'],
  ])('parses %s', (input, expected) => expect(parseLooseDate(input)).toBe(expected));

  it('returns null when there is no date', () => {
    expect(parseLooseDate('Pending')).toBeNull();
    expect(parseLooseDate('')).toBeNull();
    expect(parseLooseDate(null)).toBeNull();
  });

  it('reads an ambiguous numeric date as month-first, matching WordPress defaults', () => {
    // Documented limitation: a dd/mm/yyyy site needs an explicit format setting.
    expect(parseLooseDate('03/04/2026')).toBe('2026-03-04');
  });
});

describe('isSameLocalDate', () => {
  it('matches across formats', () => {
    expect(isSameLocalDate('September 2, 2026', '2026-09-02')).toBe(true);
    expect(isSameLocalDate('09/02/2026', '2026-09-02')).toBe(true);
  });
  it('rejects a different day', () => {
    expect(isSameLocalDate('September 1, 2026', '2026-09-02')).toBe(false);
  });
  it('rejects unparseable text rather than matching loosely', () => {
    expect(isSameLocalDate('Pending', '2026-09-02')).toBe(false);
  });
});
