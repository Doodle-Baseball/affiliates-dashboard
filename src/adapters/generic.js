/**
 * Generic label-matching adapter.
 *
 * Most affiliate portals — GoAffPro, UpPromote, and hand-rolled ones — render a
 * row of stat tiles with a visible label above or below each number. This
 * adapter logs in with the shared credential handling and then looks up each
 * metric by the *text of its label*, which is what a person reads off the page.
 * There are no hand-written CSS selectors here, so there is nothing guessed.
 *
 * Point a program at it once discovery shows (a) login automation works and
 * (b) the numbers are in the rendered HTML rather than drawn by a canvas or
 * fetched after an interaction:
 *
 *   "adapter": "generic",
 *   "labels": {                      // optional per-program overrides
 *     "clicks":      "clicks|visits|link clicks",
 *     "conversions": "orders|sales|referrals|conversions",
 *     "earnings":    "commission earned|earnings today"
 *   }
 *
 * If a metric's label is not on the page the metric stays null and the snapshot
 * is marked 'partial' — the adapter never fills a gap with 0.
 */
import { openDashboard, findStats, buildStats, detectBlocker } from './base.js';

export const name = 'generic';
export const platform = 'generic (label matching)';

const DEFAULT_LABELS = {
  clicks: 'clicks|visits|link clicks|total clicks|traffic',
  conversions: 'conversions|orders|sales|referrals|purchases',
  earnings: 'earnings|commission|total earnings|commission earned|revenue',
  unpaidEarnings: 'unpaid|pending|outstanding|balance|owed|due',
  paidEarnings: 'paid|withdrawn|settled',
  conversionRate: 'conversion rate|cr\\b',
};

function labelRegexes(program) {
  const overrides = program.labels || {};
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LABELS)) {
    const source = overrides[key] || fallback;
    // Anchored loosely: the label may carry a suffix like "(today)".
    out[key] = new RegExp(`^\\s*(${source})\\b[\\s:()a-z]*$`, 'i');
  }
  return out;
}

export async function fetchStats({ page, credentials, config, date, log = null }) {
  const program = config;
  const currency = program.currency || 'USD';

  const session = await openDashboard({ page, program, credentials, log });

  // Give a JS-rendered dashboard a chance to paint before reading labels.
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const blocker = await detectBlocker(page);
  if (blocker) {
    const error = new Error(`${blocker} interstitial on the dashboard — mark this program manual-only`);
    error.kind = 'blocked';
    throw error;
  }

  const hits = await findStats(page, labelRegexes(program), { scope: program.statsScope || null });
  const stats = buildStats({
    hits,
    currency,
    expectedMetrics: program.expectedMetrics || {},
    extraRaw: {
      url: page.url(),
      title: await page.title().catch(() => null),
      session,
      // Keep the page text so a wrong label guess can be fixed without re-scraping.
      pageText: (await page.locator('body').innerText().catch(() => '')).slice(0, 8000),
    },
  });

  const found = ['clicks', 'conversions', 'earnings', 'unpaidEarnings', 'paidEarnings']
    .filter((key) => stats[key] !== null).length;

  if (found === 0) {
    const error = new Error(
      'no metrics matched any known label on this page — add a "labels" override in config/programs.json or keep this program on manual entry',
    );
    error.kind = 'parse';
    throw error;
  }

  return {
    clicks: stats.clicks,
    conversions: stats.conversions,
    earnings: stats.earnings,
    unpaidEarnings: stats.unpaidEarnings,
    paidEarnings: stats.paidEarnings,
    conversionRate: stats.conversionRate,
    currency: stats.currency,
    status: stats.missing.length ? 'partial' : 'ok',
    warning: stats.missing.length ? `not found on the page: ${stats.missing.join(', ')}` : null,
    raw: { strategy: 'generic label matching', date, ...stats.raw },
  };
}

export default { name, platform, fetchStats };
