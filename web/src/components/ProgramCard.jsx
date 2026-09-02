import { money, count, rate, relativeTime, clockTime, isMissing } from '../format.js';

function StatusPill({ program }) {
  const snapshot = program.snapshot;
  if (!snapshot) {
    return (
      <span className="status none">
        <span className="dot" />
        {program.manualOnly ? 'manual only' : 'no data'}
      </span>
    );
  }
  if (snapshot.status === 'failed') {
    return <span className="status failed"><span className="dot" />sync failed</span>;
  }
  if (snapshot.source === 'manual') {
    return <span className="status manual"><span className="dot" />entered by hand</span>;
  }
  if (snapshot.status === 'partial') {
    return <span className="status partial"><span className="dot" />partial</span>;
  }
  return <span className="status ok"><span className="dot" />synced</span>;
}

function Metric({ label, value, missing, lead }) {
  return (
    <div className={`metric${lead ? ' lead' : ''}`}>
      <div className="k">{label}</div>
      <div className={`v num${missing ? ' na' : ''}`}>{value}</div>
    </div>
  );
}

/**
 * One program's day. A failed sync shows the error text and an "enter
 * manually" button — the failure is a prompt to act, not a dead end.
 */
export default function ProgramCard({ program, color, onManual }) {
  const snapshot = program.snapshot;
  const currency = snapshot?.currency || program.currency || 'USD';
  const failed = !snapshot || snapshot.status === 'failed';
  const clicksUntracked = program.expectedMetrics?.clicks === false;

  return (
    <article className={`card${failed ? ' is-failed' : ''}`} style={{ '--series': color }}>
      <div className="card-head">
        <div>
          <h3>{program.displayName}</h3>
          <p className="meta">
            {rate(program.commissionRate)} commission
            {program.cookieWindowDays ? ` · ${program.cookieWindowDays}-day cookie` : ' · cookie window unknown'}
          </p>
        </div>
        <StatusPill program={program} />
      </div>

      {failed ? (
        <div className="error-box">
          <div className="msg">
            <strong>{program.manualOnly ? 'Manual entry needed. ' : 'Sync failed. '}</strong>
            {snapshot?.errorMessage || 'This program has not reported for this day.'}
          </div>
          <div>
            <button type="button" className="btn btn-sm" onClick={() => onManual(program)}>
              Enter manually
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="metrics">
            <Metric
              label="Earnings"
              value={money(snapshot.earnings, currency)}
              missing={isMissing(snapshot.earnings)}
              lead
            />
            <Metric
              label="Unpaid balance"
              value={money(snapshot.unpaidEarnings, currency)}
              missing={isMissing(snapshot.unpaidEarnings)}
              lead
            />
            <Metric
              label="Conversions"
              value={count(snapshot.conversions)}
              missing={isMissing(snapshot.conversions)}
            />
            <Metric
              label="Clicks"
              value={count(snapshot.clicks)}
              missing={isMissing(snapshot.clicks)}
            />
          </div>

          {clicksUntracked && (
            <p className="stale" style={{ marginTop: -4 }}>
              Tracks by coupon code, so clicks are never reported.
            </p>
          )}

          {snapshot.status === 'partial' && snapshot.errorMessage && (
            <div className="error-box" style={{ background: 'var(--surface-sunk)', borderColor: 'var(--hairline)' }}>
              <div className="msg">{snapshot.errorMessage}</div>
            </div>
          )}
        </>
      )}

      <div className="card-foot">
        <span>
          {snapshot
            ? `${snapshot.status === 'failed' ? 'Last attempt' : snapshot.source === 'manual' ? 'Entered' : 'Synced'} ${relativeTime(snapshot.capturedAt)}`
            : 'Never synced'}
          {snapshot && clockTime(snapshot.capturedAt) ? ` · ${clockTime(snapshot.capturedAt)}` : ''}
        </span>
        <span style={{ display: 'flex', gap: 10 }}>
          {!failed && (
            <button type="button" className="btn btn-sm" onClick={() => onManual(program)}>
              Edit
            </button>
          )}
          <a href={program.dashboardUrl} target="_blank" rel="noreferrer">Open ↗</a>
        </span>
      </div>

      {program.lastAttempt?.status === 'failed' && (
        <p className="stale">
          <span className="status failed" style={{ border: 'none', padding: 0 }}>
            <span className="dot" />
          </span>
          Last sync attempt failed: {program.lastAttempt.errorMessage}
        </p>
      )}
    </article>
  );
}
