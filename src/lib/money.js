/**
 * Money and number parsing for scraped dashboard text.
 *
 * Affiliate dashboards render money as free text and every platform does it
 * differently: "$1,234.56", "1.234,56 €", "USD 0.00", "(12.50)" for a negative,
 * "1 234,56 kr". Everything here converts to INTEGER MINOR UNITS (cents), which
 * is what the database stores.
 */

// Order matters: a bare "$" is ambiguous, so every qualified symbol ("C$",
// "A$", "US$") and every ISO code gets a chance to match before it.
const SYMBOLS = [
  [/CAD|C\s?\$/i, 'CAD'],
  [/AUD|A\s?\$/i, 'AUD'],
  [/US\s?\$|USD/i, 'USD'],
  [/EUR|€/i, 'EUR'],
  [/GBP|£/i, 'GBP'],
  [/SEK|\bkr\b/i, 'SEK'],
  [/JPY|¥/i, 'JPY'],
  [/\$/, 'USD'],
];

// Currencies whose minor unit is the same as the major unit.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

export function currencyExponent(currency) {
  return ZERO_DECIMAL.has(String(currency || '').toUpperCase()) ? 0 : 2;
}

export function detectCurrency(input) {
  const text = String(input ?? '');
  for (const [pattern, code] of SYMBOLS) {
    if (pattern.test(text)) return code;
  }
  return null;
}

/**
 * Work out which of "." and "," is the decimal separator.
 * Returns '.' , ',' or null (no decimal part).
 */
function decimalSeparator(numeric) {
  const lastDot = numeric.lastIndexOf('.');
  const lastComma = numeric.lastIndexOf(',');

  if (lastDot === -1 && lastComma === -1) return null;

  // Both present: whichever comes last is the decimal point, the other groups thousands.
  if (lastDot !== -1 && lastComma !== -1) return lastDot > lastComma ? '.' : ',';

  const sep = lastDot !== -1 ? '.' : ',';
  const index = lastDot !== -1 ? lastDot : lastComma;
  const occurrences = numeric.split(sep).length - 1;

  // "1.234.567" — repeated, so it groups thousands.
  if (occurrences > 1) return null;

  const digitsAfter = numeric.length - index - 1;
  // Exactly three digits after a single separator is ambiguous ("1,234" / "1.234").
  // Money is far more often grouped than given to three decimals, so: thousands.
  if (digitsAfter === 3) return null;
  if (digitsAfter === 0) return null; // trailing separator, e.g. "1,234." — ignore it
  return sep;
}

/**
 * Parse a money string into minor units.
 *
 * @returns {{ amount: number, currency: string|null, text: string }|null}
 *          null when the input contains no digits at all (missing metric —
 *          the caller should store NULL, never 0).
 */
export function parseMoney(input, { defaultCurrency = null } = {}) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const exp = currencyExponent(defaultCurrency);
    return { amount: Math.round(input * 10 ** exp), currency: defaultCurrency, text: String(input) };
  }

  const text = String(input).replace(/ | /g, ' ').trim();
  if (!text) return null;

  const currency = detectCurrency(text) || defaultCurrency;

  // Negative if there's a leading minus, a unicode minus, or accountant parentheses.
  const negative = /^\s*\(.*\)\s*$/.test(text) || /[-−]\s*[\d$€£¥]/.test(text) || /^\s*[-−]/.test(text);

  // Keep only digits and separators. Spaces used as thousands separators disappear here.
  const numeric = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(numeric)) return null;

  const sep = decimalSeparator(numeric);
  let whole;
  let fraction = '';
  if (sep === null) {
    whole = numeric.replace(/[.,]/g, '');
  } else {
    const index = numeric.lastIndexOf(sep);
    whole = numeric.slice(0, index).replace(/[.,]/g, '');
    fraction = numeric.slice(index + 1).replace(/[.,]/g, '');
  }

  const exp = currencyExponent(currency);
  const paddedFraction = (fraction + '0'.repeat(exp)).slice(0, exp);
  // Round rather than truncate when the source carries more precision than the currency.
  const extra = fraction.slice(exp);
  let amount = Number(whole || '0') * 10 ** exp + Number(paddedFraction || '0');
  if (extra && Number(extra[0]) >= 5) amount += 1;

  if (!Number.isFinite(amount)) return null;
  return { amount: negative ? -amount : amount, currency: currency || null, text };
}

/** Minor units for a money string, or null. Convenience wrapper. */
export function toMinorUnits(input, options) {
  const parsed = parseMoney(input, options);
  return parsed ? parsed.amount : null;
}

/** Minor units back to a major-unit number, for display and for tests. */
export function fromMinorUnits(amount, currency = 'USD') {
  if (amount === null || amount === undefined) return null;
  return amount / 10 ** currencyExponent(currency);
}

/**
 * Parse an integer count ("1,204 clicks", "12"). Returns null when there is no
 * number — a missing metric must stay NULL so the UI can show "n/a".
 */
export function parseCount(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  const text = String(input).replace(/ | /g, ' ');
  const match = text.replace(/[^\d.,\-−]/g, '').match(/[-−]?[\d.,]+/);
  if (!match || !/\d/.test(match[0])) return null;
  const digits = match[0].replace(/[.,]/g, '');
  const value = Number(digits.replace(/−/, '-'));
  if (!Number.isFinite(value)) return null;
  return /^[-−]/.test(match[0]) ? -value : value;
}

/**
 * Parse a percentage into a fraction: "3.25%" -> 0.0325, "0%" -> 0.
 */
export function parsePercent(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input / 100 : null;
  const text = String(input).replace(/ | /g, ' ');
  if (!/\d/.test(text)) return null;
  const parsed = parseMoney(text.replace('%', ''), { defaultCurrency: 'XXX' });
  if (!parsed) return null;
  // parseMoney gave us hundredths; percent needs the major value / 100.
  return parsed.amount / 100 / 100;
}

/** Format minor units for display: 123456 -> "$1,234.56". */
export function formatMoney(amount, currency = 'USD', locale = 'en-US') {
  if (amount === null || amount === undefined) return null;
  const value = fromMinorUnits(amount, currency);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(currencyExponent(currency))} ${currency}`;
  }
}
