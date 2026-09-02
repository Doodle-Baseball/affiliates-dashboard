import { describe, it, expect } from 'vitest';
import {
  parseMoney, toMinorUnits, fromMinorUnits, parseCount, parsePercent,
  detectCurrency, formatMoney,
} from '../src/lib/money.js';

describe('parseMoney — US formatting', () => {
  it('parses a comma-grouped dollar amount', () => {
    expect(parseMoney('$1,234.56')).toMatchObject({ amount: 123456, currency: 'USD' });
  });
  it('parses a bare decimal', () => {
    expect(toMinorUnits('12.50')).toBe(1250);
  });
  it('parses zero', () => {
    expect(toMinorUnits('$0.00')).toBe(0);
  });
  it('parses a whole-dollar amount with no decimals', () => {
    expect(toMinorUnits('$42')).toBe(4200);
  });
  it('handles surrounding label text', () => {
    expect(toMinorUnits('Unpaid earnings: $1,020.00 USD')).toBe(102000);
  });
});

describe('parseMoney — European formatting', () => {
  it('parses dot-grouped, comma-decimal euros', () => {
    expect(parseMoney('1.234,56 €')).toMatchObject({ amount: 123456, currency: 'EUR' });
  });
  it('parses a space-grouped amount', () => {
    expect(toMinorUnits('1 234,56 €')).toBe(123456);
  });
  it('parses a non-breaking-space-grouped amount', () => {
    expect(toMinorUnits('1 234,56 €')).toBe(123456);
  });
  it('treats a lone three-digit group as thousands, not decimals', () => {
    expect(toMinorUnits('1.234')).toBe(123400);
    expect(toMinorUnits('1,234')).toBe(123400);
  });
  it('treats a lone two-digit group as decimals', () => {
    expect(toMinorUnits('1,50')).toBe(150);
    expect(toMinorUnits('1.50')).toBe(150);
  });
  it('handles repeated grouping separators', () => {
    expect(toMinorUnits('1.234.567,89')).toBe(123456789);
    expect(toMinorUnits('1,234,567.89')).toBe(123456789);
  });
});

describe('parseMoney — signs and edge cases', () => {
  it('reads a leading minus as negative', () => {
    expect(toMinorUnits('-$25.00')).toBe(-2500);
  });
  it('reads accountant parentheses as negative', () => {
    expect(toMinorUnits('($25.00)')).toBe(-2500);
  });
  it('rounds sub-cent precision rather than truncating', () => {
    expect(toMinorUnits('$1.0050')).toBe(101);
    expect(toMinorUnits('$1.0049')).toBe(100);
  });
  it('resolves the three-digit ambiguity as grouping, not thousandths', () => {
    // "$1.005" could be $1005 or $1.005. Money is grouped far more often than
    // it is given to three decimals, so grouping wins.
    expect(toMinorUnits('$1.005')).toBe(100500);
  });
  it('returns null for a missing metric rather than 0', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
    expect(parseMoney('—')).toBeNull();
  });
  it('never confuses "not tracked" with zero', () => {
    expect(toMinorUnits('N/A')).toBeNull();
    expect(toMinorUnits('$0')).toBe(0);
  });
  it('respects zero-decimal currencies', () => {
    expect(parseMoney('¥1,234')).toMatchObject({ amount: 1234, currency: 'JPY' });
  });
  it('accepts a number input', () => {
    expect(toMinorUnits(12.34, { defaultCurrency: 'USD' })).toBe(1234);
  });
  it('falls back to the configured currency when the page shows no symbol', () => {
    expect(parseMoney('1,000.00', { defaultCurrency: 'USD' })).toMatchObject({ amount: 100000, currency: 'USD' });
  });
});

describe('detectCurrency', () => {
  it.each([
    ['$10', 'USD'], ['USD 10', 'USD'], ['10 €', 'EUR'], ['EUR 10', 'EUR'],
    ['£10', 'GBP'], ['C$10', 'CAD'], ['10 kr', 'SEK'], ['¥10', 'JPY'], ['10', null],
  ])('detects %s as %s', (input, expected) => {
    expect(detectCurrency(input)).toBe(expected);
  });
});

describe('parseCount', () => {
  it('parses a grouped integer', () => expect(parseCount('1,204')).toBe(1204));
  it('strips trailing labels', () => expect(parseCount('1,204 clicks')).toBe(1204));
  it('parses zero', () => expect(parseCount('0')).toBe(0));
  it('returns null for untracked metrics', () => {
    expect(parseCount('n/a')).toBeNull();
    expect(parseCount('')).toBeNull();
    expect(parseCount(null)).toBeNull();
  });
});

describe('parsePercent', () => {
  it('converts a percentage to a fraction', () => expect(parsePercent('3.25%')).toBeCloseTo(0.0325, 6));
  it('handles whole percentages', () => expect(parsePercent('12%')).toBeCloseTo(0.12, 6));
  it('handles zero', () => expect(parsePercent('0%')).toBe(0));
  it('returns null when absent', () => expect(parsePercent('n/a')).toBeNull());
});

describe('round-trip and formatting', () => {
  it('round-trips through minor units', () => {
    expect(fromMinorUnits(toMinorUnits('$1,234.56'), 'USD')).toBe(1234.56);
  });
  it('formats minor units for display', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
  });
  it('formats null as null', () => {
    expect(formatMoney(null, 'USD')).toBeNull();
  });
});
