/**
 * Date helpers. A snapshot belongs to a calendar day in the *user's* timezone,
 * not UTC — otherwise an evening sync in a negative UTC offset lands on tomorrow.
 */

/** ISO-8601 UTC instant, millisecond precision. */
export function nowIso() {
  return new Date().toISOString();
}

/** YYYY-MM-DD for an instant, in the given IANA timezone. */
export function localDate(date = new Date(), timezone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date instanceof Date ? date : new Date(date));
}

/** Inclusive list of the last `days` YYYY-MM-DD strings, oldest first. */
export function lastNDates(days, endDate) {
  const end = endDate ? new Date(`${endDate}T12:00:00Z`) : new Date();
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date out of a table cell without knowing the site's format.
 *
 * WordPress renders dates however the site's settings say, so the same
 * AffiliateWP install can show "September 2, 2026", "2026-09-02" or
 * "09/02/2026". Returns YYYY-MM-DD, or null when nothing date-shaped is there.
 *
 * Ambiguous numeric dates (03/04/2026) are read as US month-first, which is
 * what WordPress defaults to — see the caller's TODO about confirming per site.
 */
export function parseLooseDate(input) {
  if (!input) return null;
  const text = String(input).trim();

  // 2026-09-02 (ISO, possibly with a time after it)
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // September 2, 2026  /  2 September 2026  /  Sep 2, 2026
  const named = text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)
    || text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (named) {
    const monthToken = /^\d/.test(named[1]) ? named[2] : named[1];
    const dayToken = /^\d/.test(named[1]) ? named[1] : named[2];
    const month = MONTHS[monthToken.slice(0, 3).toLowerCase()];
    if (month) {
      return `${named[3]}-${String(month).padStart(2, '0')}-${String(dayToken).padStart(2, '0')}`;
    }
  }

  // 09/02/2026 or 09-02-2026 — month first, WordPress's default.
  const numeric = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (numeric) {
    const [, a, b, year] = numeric;
    const month = Number(a);
    const day = Number(b);
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

/** Does this cell text refer to the given YYYY-MM-DD day? */
export function isSameLocalDate(cellText, isoDate) {
  const parsed = parseLooseDate(cellText);
  return parsed !== null && parsed === isoDate;
}
