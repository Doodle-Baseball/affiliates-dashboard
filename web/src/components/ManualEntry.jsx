import { useEffect, useState } from 'react';
import { humanDate } from '../format.js';

const FIELDS = [
  { key: 'clicks', label: 'Clicks', step: '1', help: null },
  { key: 'conversions', label: 'Conversions', step: '1', help: null },
  { key: 'earnings', label: 'Earnings', step: '0.01', prefix: true },
  { key: 'unpaidEarnings', label: 'Unpaid balance', step: '0.01', prefix: true },
  { key: 'paidEarnings', label: 'Paid to date', step: '0.01', prefix: true },
];

/**
 * Manual entry. Amounts are typed in whole currency — what you read off the
 * portal is what you type — and converted to minor units server-side.
 *
 * Leaving a field blank stores NULL, not 0. That distinction is the whole
 * point for a program like Blue Ridge that never reports clicks.
 */
export default function ManualEntry({ program, date, onClose, onSaved }) {
  const [values, setValues] = useState(() => {
    const snapshot = program.snapshot;
    const major = (minor) => (minor === null || minor === undefined ? '' : (minor / 100).toFixed(2));
    const plain = (value) => (value === null || value === undefined ? '' : String(value));
    return {
      clicks: snapshot && snapshot.status !== 'failed' ? plain(snapshot.clicks) : '',
      conversions: snapshot && snapshot.status !== 'failed' ? plain(snapshot.conversions) : '',
      earnings: snapshot && snapshot.status !== 'failed' ? major(snapshot.earnings) : '',
      unpaidEarnings: snapshot && snapshot.status !== 'failed' ? major(snapshot.unpaidEarnings) : '',
      paidEarnings: snapshot && snapshot.status !== 'failed' ? major(snapshot.paidEarnings) : '',
      note: '',
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clicksUntracked = program.expectedMetrics?.clicks === false;

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSaved({ programKey: program.key, date, period: 'today', ...values });
    } catch (submitError) {
      setError(submitError.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Enter figures for ${program.displayName}`}>
        <h2>{program.displayName}</h2>
        <p className="modal-sub">Figures for {humanDate(date)}</p>

        <p className="form-note">
          Leave a box empty for anything the portal doesn&apos;t show — it is stored as
          &ldquo;not tracked&rdquo; rather than as a zero.
          {clicksUntracked && ' This program tracks by coupon code, so it never reports clicks.'}
        </p>

        <form onSubmit={submit}>
          <div className="field-row">
            {FIELDS.slice(0, 2).map((field) => (
              <div className="field" key={field.key}>
                <label htmlFor={`f-${field.key}`}>{field.label}</label>
                <input
                  id={`f-${field.key}`}
                  type="number"
                  step={field.step}
                  min="0"
                  inputMode="numeric"
                  placeholder={clicksUntracked && field.key === 'clicks' ? 'not tracked' : ''}
                  value={values[field.key]}
                  onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
                />
              </div>
            ))}
          </div>

          {FIELDS.slice(2).map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={`f-${field.key}`}>{field.label} ({program.currency || 'USD'})</label>
              <input
                id={`f-${field.key}`}
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={values[field.key]}
                onChange={(event) => setValues((v) => ({ ...v, [field.key]: event.target.value }))}
              />
            </div>
          ))}

          <div className="field">
            <label htmlFor="f-note">Note (optional)</label>
            <input
              id="f-note"
              type="text"
              placeholder="e.g. read off the portal at 9am"
              value={values.note}
              onChange={(event) => setValues((v) => ({ ...v, note: event.target.value }))}
            />
          </div>

          {error && (
            <div className="error-box"><div className="msg"><strong>Could not save. </strong>{error}</div></div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save figures'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
