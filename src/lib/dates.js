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
