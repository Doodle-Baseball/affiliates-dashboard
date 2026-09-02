import { useState, useMemo } from 'react';
import { money, count, percent, rate, relativeTime, isMissing } from '../format.js';

const COLUMNS = [
  { key: 'displayName', label: 'Program', align: 'left' },
  { key: 'clicks', label: 'Clicks' },
  { key: 'conversions', label: 'Conv.' },
  { key: 'conversionRate', label: 'Rate' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'unpaidEarnings', label: 'Unpaid' },
  { key: 'commissionRate', label: 'Comm.' },
  { key: 'cookieWindowDays', label: 'Cookie' },
  { key: 'capturedAt', label: 'Last synced' },
];

/** Nulls always sort to the bottom, in either direction — "unknown" is not "lowest". */
function compare(a, b, key, direction) {
  const av = a[key];
  const bv = b[key];
  if (isMissing(av) && isMissing(bv)) return 0;
  if (isMissing(av)) return 1;
  if (isMissing(bv)) return -1;
  const result = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
  return direction === 'asc' ? result : -result;
}

export default function ProgramTable({ programs, colorFor }) {
  const [sort, setSort] = useState({ key: 'earnings', direction: 'desc' });

  const rows = useMemo(
    () =>
      programs.map((program) => {
        const snapshot = program.snapshot;
        const usable = snapshot && snapshot.status !== 'failed' ? snapshot : null;
        return {
          key: program.key,
          displayName: program.displayName,
          currency: usable?.currency || program.currency || 'USD',
          clicks: usable?.clicks ?? null,
          conversions: usable?.conversions ?? null,
          conversionRate: usable?.conversionRate ?? null,
          earnings: usable?.earnings ?? null,
          unpaidEarnings: usable?.unpaidEarnings ?? null,
          commissionRate: program.commissionRate,
          cookieWindowDays: program.cookieWindowDays,
          capturedAt: snapshot?.capturedAt ?? null,
          failed: !usable,
        };
      }),
    [programs],
  );

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compare(a, b, sort.key, sort.direction)),
    [rows, sort],
  );

  const toggle = (key) =>
    setSort((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'displayName' ? 'asc' : 'desc' },
    );

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                onClick={() => toggle(column.key)}
                aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                scope="col"
              >
                {column.label}
                <span className="caret">
                  {sort.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.key}>
              <td>
                <span className="name">
                  {/* Colour follows the program, not the row position. */}
                  <span className="swatch" style={{ background: colorFor(row.key) }} />
                  {row.displayName}
                </span>
              </td>
              <td className={isMissing(row.clicks) ? 'na' : ''}>{count(row.clicks)}</td>
              <td className={isMissing(row.conversions) ? 'na' : ''}>{count(row.conversions)}</td>
              <td className={isMissing(row.conversionRate) ? 'na' : ''}>{percent(row.conversionRate)}</td>
              <td className={isMissing(row.earnings) ? 'na' : ''}>{money(row.earnings, row.currency)}</td>
              <td className={isMissing(row.unpaidEarnings) ? 'na' : ''}>{money(row.unpaidEarnings, row.currency)}</td>
              <td>{rate(row.commissionRate)}</td>
              <td className={isMissing(row.cookieWindowDays) ? 'na' : ''}>
                {isMissing(row.cookieWindowDays) ? 'n/a' : `${row.cookieWindowDays}d`}
              </td>
              <td className={row.capturedAt ? '' : 'na'}>{relativeTime(row.capturedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
