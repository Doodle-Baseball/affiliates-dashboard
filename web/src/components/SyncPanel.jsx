import { money } from '../format.js';

/**
 * Live per-program sync progress. Programs land one at a time as the runner
 * finishes them, so a slow site never hides the four that already succeeded.
 */
export default function SyncPanel({ progress, colorFor }) {
  const entries = Object.values(progress.programs);
  if (entries.length === 0) return null;

  return (
    <div className="sync-panel">
      <p className="eyebrow">
        Syncing — {entries.filter((e) => e.state === 'done').length} of {entries.length} finished
      </p>
      {entries.map((entry) => (
        <div className="sync-row" key={entry.programKey}>
          {entry.state === 'running' ? (
            <span className="spinner" />
          ) : (
            <span
              className="dot"
              style={{
                width: 8, height: 8, borderRadius: '50%', flex: 'none',
                background:
                  entry.status === 'failed' ? 'var(--critical)'
                    : entry.status === 'partial' ? 'var(--warning)'
                      : entry.state === 'done' ? 'var(--good)'
                        : 'var(--axis)',
              }}
            />
          )}
          <span className="name" style={{ color: colorFor(entry.programKey) === undefined ? undefined : 'inherit' }}>
            {entry.displayName}
          </span>
          <span className="msg">
            {entry.state === 'pending' && 'queued'}
            {entry.state === 'running' && 'signing in…'}
            {entry.state === 'done' && entry.status === 'failed' && entry.error}
            {entry.state === 'done' && entry.status !== 'failed' && (
              entry.earnings !== null && entry.earnings !== undefined
                ? `${money(entry.earnings)} · ${entry.conversions ?? 0} conv.`
                : entry.status
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
