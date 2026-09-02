/**
 * AffiliateWP adapter (IDUN Peptides, and any other WordPress/WooCommerce store
 * running AffiliateWP at /affiliate-area/).
 *
 * ── Confidence and what is still unverified ─────────────────────────────────
 * This is written against AffiliateWP's stock affiliate-area templates, which
 * are stable across installs and rarely themed beyond CSS. Everything below is
 * matched on *visible label text*, not on generated class names, so a restyled
 * theme should still parse.
 *
 * TODO(verify) — run `npm run discover -- --program=idun_peptides` and check:
 *   1. The dashboard really is AffiliateWP (research/idun_peptides.html should
 *      contain "affwp-affiliate-dashboard"). If it is a different platform,
 *      point config at another adapter rather than patching this one.
 *   2. Whether the affiliate area logs in through AffiliateWP's own form
 *      (#affwp-login-user-login) or through WooCommerce's (#username). Both are
 *      handled below; confirm which one fires.
 *   3. That the tabs ?tab=referrals and ?tab=visits exist and are enabled.
 *      Some installs hide them, in which case today's figures fall back to the
 *      graphs tab and this adapter reports 'partial'.
 *   4. The date format in the Referrals/Visits tables. parseLooseDate handles
 *      ISO, "September 2, 2026" and mm/dd/yyyy; a dd/mm/yyyy site would be
 *      misread and needs a dateFormat option adding to programs.json.
 *   5. Whether the referral Amount column is the commission or the order total.
 *      It should be the commission — confirm against one known order.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 * AffiliateWP's main tab reports ALL-TIME totals, not today's, so:
 *   • all-time  <- the two stat tables on the main dashboard tab (high confidence)
 *   • today     <- counting rows dated today in the Referrals and Visits tabs
 *                  (row-level data, so it needs no date-filter parameters)
 * If the per-tab tables are unavailable the adapter still returns all-time and
 * marks today as unknown, rather than inventing a zero.
 */
import {
  AdapterError, openDashboard, genericLogin, findStats, buildStats,
} from './base.js';
import { toMinorUnits, parseCount } from '../lib/money.js';
import { isSameLocalDate } from '../lib/dates.js';

export const name = 'affiliatewp';
export const platform = 'AffiliateWP';

/** Labels AffiliateWP uses on the main dashboard tab. */
const ALLTIME_FIELDS = {
  clicks: /^\s*(visits|total visits|clicks)\s*$/i,
  conversions: /^\s*(total|paid|unpaid)?\s*referrals\s*$/i,
  unpaidEarnings: /^\s*unpaid\s+earnings\s*$/i,
  paidEarnings: /^\s*paid\s+earnings\s*$/i,
  earnings: /^\s*(total\s+)?earnings\s*$/i,
  conversionRate: /^\s*conversion\s+rate\s*$/i,
};

async function affiliateWpLogin(page, credentials, program) {
  // AffiliateWP ships its own login form; a WooCommerce store often shows the
  // Woo one instead. Try the AffiliateWP ids first, then fall through.
  return genericLogin(page, credentials, {
    identitySelectors: [
      'input#affwp-login-user-login',
      'input[name="affwp_user_login"]',
      'input#username',
      'input[name="log"]',
    ],
    submitSelectors: [
      'input#affwp-login-submit',
      'input[name="affwp_login_submit"]',
      'button[name="login"]',
      'button[type="submit"]',
    ],
  }).catch((error) => {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError(`AffiliateWP login failed: ${error.message}`, { kind: 'login' });
  });
}

function tabUrl(program, tab) {
  const url = new URL(program.dashboardUrl);
  url.searchParams.set('tab', tab);
  return url.toString();
}

/**
 * Read a tab's data table as arrays of cells, keyed by its header labels.
 * Returns [] when the tab has no table (feature disabled on this install).
 */
async function readTabTable(page, program, tab) {
  await page.goto(tabUrl(program, tab), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    // Pick the table with the most body rows — the data table, not a layout one.
    const table = tables.sort(
      (a, b) => b.querySelectorAll('tbody tr').length - a.querySelectorAll('tbody tr').length,
    )[0];
    if (!table) return [];

    const headers = [...table.querySelectorAll('thead th, thead td')].map((th) =>
      (th.innerText || '').trim().toLowerCase(),
    );
    const rows = [...table.querySelectorAll('tbody tr')];
    return rows
      .map((tr) => {
        const cells = [...tr.querySelectorAll('td, th')].map((td) => (td.innerText || '').trim());
        if (cells.length === 0) return null;
        const record = {};
        cells.forEach((value, i) => {
          record[headers[i] || `col${i}`] = value;
        });
        record._cells = cells;
        return record;
      })
      .filter(Boolean);
  });
}

/** Find a column by header name, falling back to scanning every cell. */
function column(row, patterns) {
  for (const [key, value] of Object.entries(row)) {
    if (key === '_cells') continue;
    if (patterns.some((p) => p.test(key))) return value;
  }
  return null;
}

const DATE_HEADERS = [/^date$/i, /date/i, /^time$/i];
const AMOUNT_HEADERS = [/^amount$/i, /amount/i, /^earnings$/i, /commission/i];
const STATUS_HEADERS = [/^status$/i];

/**
 * Count today's referrals and visits from the row-level tabs.
 * Rejected referrals are excluded — they are not earnings.
 */
function summariseToday(referralRows, visitRows, date, currency) {
  let conversions = null;
  let earnings = null;
  let clicks = null;
  const matchedReferrals = [];

  if (referralRows !== null) {
    conversions = 0;
    earnings = 0;
    for (const row of referralRows) {
      const dateCell = column(row, DATE_HEADERS) ?? row._cells.find((c) => isSameLocalDate(c, date));
      if (!dateCell || !isSameLocalDate(dateCell, date)) continue;
      const status = (column(row, STATUS_HEADERS) || '').toLowerCase();
      if (status.includes('reject')) continue;
      conversions += 1;
      const amount = toMinorUnits(column(row, AMOUNT_HEADERS), { defaultCurrency: currency });
      if (amount !== null) earnings += amount;
      matchedReferrals.push(row._cells);
    }
  }

  if (visitRows !== null) {
    clicks = 0;
    for (const row of visitRows) {
      const dateCell = column(row, DATE_HEADERS) ?? row._cells.find((c) => isSameLocalDate(c, date));
      if (dateCell && isSameLocalDate(dateCell, date)) clicks += 1;
    }
  }

  return { conversions, earnings, clicks, matchedReferrals };
}

/**
 * @param {{ page: import('playwright').Page, credentials: object, config: object }} args
 */
export async function fetchStats({ page, credentials, config, date, log = null }) {
  const program = config;
  const currency = program.currency || 'USD';

  const session = await openDashboard({
    page,
    program,
    credentials,
    login: affiliateWpLogin,
    log,
  });

  // --- all-time, from the two stat tables on the main tab -------------------
  const html = await page.content();
  if (!/affwp[-_]/i.test(html)) {
    // Not fatal — the labels may still match — but worth recording.
    log?.warn(`${program.key}: page has no AffiliateWP markers; selectors may not apply`);
  }

  const hits = await findStats(page, ALLTIME_FIELDS);
  const allTime = buildStats({
    hits,
    currency,
    expectedMetrics: program.expectedMetrics || {},
    extraRaw: { tab: 'dashboard', url: page.url(), affiliateWpMarkers: /affwp[-_]/i.test(html) },
  });

  // Unpaid + paid is the more trustworthy total when both are present, because
  // some installs label a different number "Earnings".
  if (allTime.unpaidEarnings !== null && allTime.paidEarnings !== null) {
    allTime.earnings = allTime.unpaidEarnings + allTime.paidEarnings;
  }

  // --- today, from the row-level tabs --------------------------------------
  let referralRows = null;
  let visitRows = null;
  const tabErrors = {};

  try {
    referralRows = await readTabTable(page, program, 'referrals');
  } catch (error) {
    tabErrors.referrals = error.message;
  }
  try {
    visitRows = await readTabTable(page, program, 'visits');
  } catch (error) {
    tabErrors.visits = error.message;
  }

  const today = summariseToday(
    referralRows && referralRows.length >= 0 ? referralRows : null,
    // A visits tab that exists but is empty legitimately means zero clicks today.
    visitRows && visitRows.length >= 0 ? visitRows : null,
    date,
    currency,
  );

  const todayUnknown = today.conversions === null && today.earnings === null && today.clicks === null;

  return {
    // The primary return is today's window, which is what the dashboard shows.
    clicks: today.clicks,
    conversions: today.conversions,
    earnings: today.earnings,
    // Balances are point-in-time, not per-day: today's row carries the current
    // unpaid/paid balance so the card can show "pending" without a second query.
    unpaidEarnings: allTime.unpaidEarnings,
    paidEarnings: allTime.paidEarnings,
    conversionRate:
      today.clicks && today.clicks > 0 && today.conversions !== null
        ? today.conversions / today.clicks
        : null,
    currency: allTime.currency || currency,
    status: todayUnknown ? 'partial' : 'ok',
    warning: todayUnknown
      ? 'all-time totals captured, but the referrals/visits tabs were unreadable so today is unknown'
      : allTime.missing.length
        ? `all-time metrics not found: ${allTime.missing.join(', ')}`
        : null,
    raw: {
      strategy: 'main-tab all-time + referrals/visits row counting',
      date,
      session,
      allTime: { ...allTime, raw: undefined },
      allTimeHits: allTime.raw.hits,
      todayReferralRows: today.matchedReferrals,
      referralRowCount: referralRows ? referralRows.length : null,
      visitRowCount: visitRows ? visitRows.length : null,
      tabErrors,
    },
    // The all-time window is genuinely useful history, so store it too.
    additionalPeriods: [
      {
        period: 'alltime',
        clicks: allTime.clicks,
        conversions: allTime.conversions,
        earnings: allTime.earnings,
        unpaidEarnings: allTime.unpaidEarnings,
        paidEarnings: allTime.paidEarnings,
        conversionRate: allTime.conversionRate,
        currency: allTime.currency || currency,
        status: allTime.missing.length >= 4 ? 'partial' : 'ok',
        raw: { hits: allTime.raw.hits, tab: 'dashboard' },
      },
    ],
  };
}

export default { name, platform, fetchStats };
