/**
 * Display formatting. The single rule that matters: null is "n/a", never 0.
 * A program that does not track clicks must not look like a program that got
 * no clicks.
 */
export const NA = 'n/a';

export function isMissing(value) {
  return value === null || value === undefined;
}

/** Minor units -> "$1,234.56". */
export function money(minorUnits, currency = 'USD', { compact = false } = {}) {
  if (isMissing(minorUnits)) return NA;
  const value = minorUnits / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: compact && Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function count(value) {
  if (isMissing(value)) return NA;
  return new Intl.NumberFormat('en-US').format(value);
}

export function percent(fraction, digits = 2) {
  if (isMissing(fraction)) return NA;
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** 0.2 -> "20%" — commission rates are whole-ish, so no trailing zeros. */
export function rate(fraction) {
  if (isMissing(fraction)) return NA;
  const value = fraction * 100;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function relativeTime(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function clockTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function humanDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export function shortDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/**
 * Series color by fixed program index — identity, never rank. Filtering or
 * re-sorting the table must never repaint a program.
 */
export function seriesColor(index) {
  return `var(--series-${(index % 5) + 1})`;
}
