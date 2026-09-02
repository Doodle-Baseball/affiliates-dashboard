import { money, count, percent, isMissing } from '../format.js';

function Total({ label, value, foot, missing }) {
  return (
    <div className="total">
      <p className="eyebrow">{label}</p>
      <p className={`value num${missing ? ' na' : ''}`}>{value}</p>
      {foot && <p className="foot">{foot}</p>}
    </div>
  );
}

/**
 * The combined figures, as stat tiles rather than a chart — four numbers is a
 * headline, not a comparison.
 */
export default function Totals({ totals, programCount, isToday }) {
  const currency = totals.currency || 'USD';
  const noClickTracking = isMissing(totals.clicks);

  return (
    <>
      <div className="totals">
        <Total
          label={isToday ? 'Earnings today' : 'Earnings'}
          value={money(totals.earnings, currency)}
          missing={isMissing(totals.earnings)}
          foot={
            isMissing(totals.unpaidEarnings)
              ? `${totals.programsReporting} of ${programCount} programs reporting`
              : `${money(totals.unpaidEarnings, currency)} unpaid balance`
          }
        />
        <Total
          label="Conversions"
          value={count(totals.conversions)}
          missing={isMissing(totals.conversions)}
          foot={
            isMissing(totals.earnings) || isMissing(totals.conversions) || totals.conversions === 0
              ? null
              : `${money(Math.round(totals.earnings / totals.conversions), currency)} average`
          }
        />
        <Total
          label="Clicks"
          value={count(totals.clicks)}
          missing={noClickTracking}
          foot={noClickTracking ? 'no program reported clicks' : null}
        />
        <Total
          label="Blended rate"
          value={percent(totals.conversionRate)}
          missing={isMissing(totals.conversionRate)}
          foot={isMissing(totals.conversionRate) ? 'needs tracked clicks' : 'conversions ÷ clicks'}
        />
      </div>

      {(totals.programsFailed > 0 || totals.mixedCurrencies) && (
        <p className="notice">
          {totals.mixedCurrencies ? (
            <>
              <span className="dot" style={{ background: 'var(--warning)' }} />
              Programs reported in {totals.mixedCurrencies.join(' and ')} — totals above are not
              currency-converted.
            </>
          ) : (
            <>
              <span className="dot" style={{ background: 'var(--critical)' }} />
              {totals.programsFailed} program{totals.programsFailed === 1 ? '' : 's'} did not report.
              These totals cover the {totals.programsReporting} that did.
            </>
          )}
        </p>
      )}
    </>
  );
}
