import { useEffect, useMemo, useRef, useState } from 'react';
import { money, shortDate } from '../format.js';

/**
 * Daily earnings over the last N days, in two views.
 *
 * Why small multiples rather than five lines on one plot: five overlapping
 * series fail the colour-separation checks outright — in dark mode the
 * magenta/aqua pair measures ΔE 1.6 under deuteranopia, i.e. the same line.
 * Faceting is the fix. Each panel carries one series, so identity comes from
 * the panel's title and colour is decoration rather than the only cue. It also
 * reads better: these programs differ by 5x, and on a shared plot the small
 * ones flatten against the axis.
 *
 * Hand-drawn SVG rather than a chart library so the marks follow the spec —
 * 2px lines, hairline solid grid, one y-axis, and a *gap* where a day has no
 * snapshot instead of a line dropping to zero. A day nobody synced is unknown,
 * not a day with no earnings.
 */

function niceCeiling(value) {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Split a series into runs of consecutive non-null points, so gaps stay gaps. */
function segments(values) {
  const runs = [];
  let current = [];
  values.forEach((value, index) => {
    if (value === null || value === undefined) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push({ index, value });
    }
  });
  if (current.length) runs.push(current);
  return runs;
}

function useWidth(ref, initial = 800) {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/* ------------------------------------------------------------- one panel -- */

function Panel({ series, dates, max, color, currency }) {
  const ref = useRef(null);
  const width = useWidth(ref, 220);
  const [hover, setHover] = useState(null);

  const PAD = { top: 10, right: 6, bottom: 18, left: 6 };
  const HEIGHT = 108;
  const plotWidth = Math.max(40, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (dates.length === 1 ? plotWidth / 2 : (i / (dates.length - 1)) * plotWidth);
  const y = (v) => PAD.top + plotHeight - (v / max) * plotHeight;

  const values = series.values;
  const latest = [...values].reverse().find((v) => v !== null && v !== undefined);
  const points = values.filter((v) => v !== null && v !== undefined);
  const total = points.reduce((sum, v) => sum + v, 0);

  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - PAD.left) / plotWidth;
    const index = Math.round(ratio * (dates.length - 1));
    if (index < 0 || index >= dates.length) return setHover(null);
    setHover(index);
  };

  return (
    <div className="panel" ref={ref}>
      <div className="panel-head">
        <span className="panel-name">
          <span className="swatch" style={{ background: color }} />
          {series.displayName}
        </span>
        <span className="panel-total num">{money(total, currency, { compact: true })}</span>
      </div>

      <div className="panel-plot">
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          height={HEIGHT}
          className="chart-svg"
          role="img"
          aria-label={`${series.displayName}: daily earnings, ${money(total, currency)} over the window`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <line
            x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)}
            stroke="var(--axis)" strokeWidth="1" shapeRendering="crispEdges"
          />
          <line
            x1={PAD.left} x2={width - PAD.right} y1={y(max)} y2={y(max)}
            stroke="var(--grid)" strokeWidth="1" shapeRendering="crispEdges"
          />
          {segments(values).map((run, i) =>
            run.length === 1 ? (
              <circle key={i} cx={x(run[0].index)} cy={y(run[0].value)} r="3" fill={color}
                stroke="var(--surface)" strokeWidth="2" />
            ) : (
              <path
                key={i}
                d={run.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.index)},${y(p.value)}`).join(' ')}
                fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              />
            ),
          )}
          {hover !== null && values[hover] !== null && values[hover] !== undefined && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)}
                stroke="var(--axis)" strokeWidth="1" shapeRendering="crispEdges" />
              <circle cx={x(hover)} cy={y(values[hover])} r="4"
                fill={color} stroke="var(--surface)" strokeWidth="2" />
            </>
          )}
        </svg>

        {hover !== null && (
          <div
            className="tooltip compact"
            style={{ left: Math.min(Math.max(x(hover) - 60, 0), Math.max(0, width - 128)), top: -4 }}
          >
            <div className="t-date">{shortDate(dates[hover])}</div>
            <div className="t-row">
              <span className="l">earnings</span>
              <span className="v">
                {values[hover] === null || values[hover] === undefined
                  ? 'no snapshot'
                  : money(values[hover], currency)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="panel-foot">
        latest {latest === undefined ? 'n/a' : money(latest, currency)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- combined view -- */

function Combined({ totals, dates, currency }) {
  const ref = useRef(null);
  const width = useWidth(ref, 860);
  const [hover, setHover] = useState(null);

  const PAD = { top: 14, right: 18, bottom: 26, left: 58 };
  const HEIGHT = 240;
  const plotWidth = Math.max(120, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = niceCeiling(Math.max(0, ...totals.filter((v) => v !== null)));
  const x = (i) => PAD.left + (dates.length === 1 ? plotWidth / 2 : (i / (dates.length - 1)) * plotWidth);
  const y = (v) => PAD.top + plotHeight - (v / max) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
  const labelEvery = Math.max(1, Math.ceil(dates.length / 6));

  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - PAD.left) / plotWidth;
    const index = Math.round(ratio * (dates.length - 1));
    setHover(index < 0 || index >= dates.length ? null : index);
  };

  return (
    <div className="chart-holder" ref={ref}>
      <svg
        className="chart-svg" viewBox={`0 0 ${width} ${HEIGHT}`} height={HEIGHT}
        role="img" aria-label="Combined daily earnings across all programs"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)}
              stroke="var(--grid)" strokeWidth="1" shapeRendering="crispEdges" />
            <text x={PAD.left - 10} y={y(tick)} dy="0.32em" textAnchor="end"
              fontSize="11" fill="var(--ink-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {money(tick, currency, { compact: true })}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)}
          stroke="var(--axis)" strokeWidth="1" shapeRendering="crispEdges" />
        {dates.map((date, index) =>
          index % labelEvery === 0 || index === dates.length - 1 ? (
            <text key={date} x={x(index)} y={HEIGHT - 8} textAnchor="middle"
              fontSize="11" fill="var(--ink-muted)">{shortDate(date)}</text>
          ) : null,
        )}
        {segments(totals).map((run, i) => (
          <path key={i}
            d={run.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.index)},${y(p.value)}`).join(' ')}
            fill="none" stroke="var(--series-1)" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {hover !== null && totals[hover] !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)}
              stroke="var(--axis)" strokeWidth="1" shapeRendering="crispEdges" />
            <circle cx={x(hover)} cy={y(totals[hover])} r="4.5"
              fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover !== null && totals[hover] !== null && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover) + 14, 8), Math.max(8, width - 170)), top: PAD.top }}>
          <div className="t-date">{shortDate(dates[hover])}</div>
          <div className="t-row">
            <span className="l">all programs</span>
            <span className="v">{money(totals[hover], currency)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- shell -- */

export default function EarningsChart({ chart, colorFor, currency = 'USD' }) {
  const [view, setView] = useState('program');

  const dates = chart?.dates || [];
  const series = chart?.series || [];

  // One y-scale across every panel, so the panels are comparable to each other.
  const sharedMax = useMemo(() => {
    const values = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
    return niceCeiling(values.length ? Math.max(...values) : 0);
  }, [series]);

  // A day's total counts the programs that reported; a day nobody reported
  // stays null so the combined line breaks rather than dipping to zero.
  const totals = useMemo(
    () =>
      dates.map((_, index) => {
        const values = series.map((s) => s.values[index]).filter((v) => v !== null && v !== undefined);
        return values.length ? values.reduce((sum, v) => sum + v, 0) : null;
      }),
    [dates, series],
  );

  if (!chart || dates.length === 0 || series.length === 0) {
    return <div className="empty">No history yet — sync, or enter a day by hand.</div>;
  }

  return (
    <div>
      <div className="chart-toolbar">
        <div className="segmented" role="group" aria-label="Chart view">
          <button type="button" aria-pressed={view === 'program'} onClick={() => setView('program')}>
            By program
          </button>
          <button type="button" aria-pressed={view === 'combined'} onClick={() => setView('combined')}>
            Combined
          </button>
        </div>
        <span className="chart-scale">
          {shortDate(dates[0])} – {shortDate(dates[dates.length - 1])}
          {view === 'program'
            ? ` · shared scale, 0 – ${money(sharedMax, currency, { compact: true })}`
            : ' · all programs summed'}
        </span>
      </div>

      {view === 'program' ? (
        <div className="panels">
          {series.map((s) => (
            <Panel
              key={s.programKey}
              series={s}
              dates={dates}
              max={sharedMax}
              color={colorFor(s.programKey)}
              currency={currency}
            />
          ))}
        </div>
      ) : (
        <Combined totals={totals} dates={dates} currency={currency} />
      )}
    </div>
  );
}
