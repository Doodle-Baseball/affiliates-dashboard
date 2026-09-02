/**
 * Pure aggregation over snapshot rows. No database, no I/O — this is the layer
 * the tests exercise.
 *
 * Rules that matter:
 *   * Snapshots are append-only, so "the value for a program on a day" is the
 *     row with the greatest captured_at.
 *   * null means "not tracked / not found", 0 means "tracked, and it was zero".
 *     Summing must never turn a null into a 0: if no program reported a metric,
 *     the total for that metric is null too.
 *   * Failed snapshots contribute their status, not their numbers.
 */

/**
 * Reduce many rows to the newest row per program_key.
 * @param {Array<object>} rows snapshot rows (any order)
 */
export function latestPerProgram(rows) {
  const byProgram = new Map();
  for (const row of rows) {
    const current = byProgram.get(row.program_key);
    if (!current || String(row.captured_at) > String(current.captured_at) ||
        (String(row.captured_at) === String(current.captured_at) && row.id > current.id)) {
      byProgram.set(row.program_key, row);
    }
  }
  return [...byProgram.values()];
}

/** Sum that preserves null: returns null only when every contribution is null. */
export function sumNullable(values) {
  let total = null;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

/**
 * Combined "today" totals across programs.
 * Only rows with status 'ok' or 'partial' contribute numbers.
 * Mixed currencies are reported rather than silently added together.
 */
export function combineTotals(rows) {
  const usable = rows.filter((r) => r.status === 'ok' || r.status === 'partial');

  const clicks = sumNullable(usable.map((r) => r.clicks));
  const conversions = sumNullable(usable.map((r) => r.conversions));
  const earnings = sumNullable(usable.map((r) => r.earnings));
  const unpaidEarnings = sumNullable(usable.map((r) => r.unpaid_earnings));
  const paidEarnings = sumNullable(usable.map((r) => r.paid_earnings));

  const currencies = [...new Set(usable.map((r) => r.currency).filter(Boolean))];

  return {
    clicks,
    conversions,
    earnings,
    unpaidEarnings,
    paidEarnings,
    // Blended rate is only meaningful when clicks are actually tracked, and
    // dividing by zero clicks is not "0%", it is "no rate yet".
    conversionRate: clicks && clicks > 0 && conversions !== null ? conversions / clicks : null,
    currency: currencies.length === 1 ? currencies[0] : null,
    mixedCurrencies: currencies.length > 1 ? currencies : null,
    programsReporting: usable.length,
    programsFailed: rows.filter((r) => r.status === 'failed').length,
  };
}

/**
 * Daily earnings per program for a chart.
 * @param {Array<object>} rows snapshots (period 'today') across a date range
 * @param {Array<string>} dates ordered YYYY-MM-DD list to emit
 * @returns {{ dates: string[], series: Array<{ programKey: string, values: Array<number|null> }> }}
 */
export function dailyEarningsSeries(rows, dates) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.local_date)) byDate.set(row.local_date, []);
    byDate.get(row.local_date).push(row);
  }

  const perProgram = new Map();
  for (const date of dates) {
    const latest = latestPerProgram(byDate.get(date) || []);
    for (const row of latest) {
      if (!perProgram.has(row.program_key)) perProgram.set(row.program_key, new Map());
      if (row.status === 'failed') continue;
      perProgram.get(row.program_key).set(date, row.earnings);
    }
  }

  return {
    dates,
    series: [...perProgram.entries()].map(([programKey, values]) => ({
      programKey,
      values: dates.map((date) => (values.has(date) ? values.get(date) : null)),
    })),
  };
}
