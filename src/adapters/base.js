/**
 * BaseAdapter — shared machinery every site adapter builds on.
 *
 * The contract each adapter must satisfy:
 *
 *   async function fetchStats({ page, credentials, config }) -> {
 *     clicks, conversions, earnings, unpaidEarnings, paidEarnings, currency, raw
 *   }
 *
 * Money fields come back in INTEGER MINOR UNITS. A metric the site does not
 * report is `null` — never 0. An adapter may additionally return
 * `additionalPeriods: [{ period, ...sameShape }]` when the site can give more
 * than one window (AffiliateWP, for instance, shows all-time on the main tab
 * and a date-filtered range on the graphs tab).
 *
 * Nothing in here throws on a missing metric. Adapters throw only when the page
 * is unusable (login failed, navigation failed), and the runner turns that into
 * one failed program, never a failed run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config/paths.js';
import { parseMoney, parseCount, parsePercent, toMinorUnits } from '../lib/money.js';

export class AdapterError extends Error {
  constructor(message, { kind = 'adapter', recoverable = false } = {}) {
    super(message);
    this.name = 'AdapterError';
    this.kind = kind; // 'login' | 'navigation' | 'parse' | 'blocked' | 'credentials' | 'adapter'
    this.recoverable = recoverable;
  }
}

/* ------------------------------------------------------------- sessions -- */

export function sessionPath(programKey) {
  return path.join(PATHS.storage, `${programKey}.json`);
}

export function hasSavedSession(programKey) {
  return fs.existsSync(sessionPath(programKey));
}

export async function saveSession(context, programKey) {
  fs.mkdirSync(PATHS.storage, { recursive: true });
  await context.storageState({ path: sessionPath(programKey) });
}

export function clearSession(programKey) {
  const file = sessionPath(programKey);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Age of the saved cookie jar in hours, or null if there isn't one. */
export function sessionAgeHours(programKey) {
  try {
    return (Date.now() - fs.statSync(sessionPath(programKey)).mtimeMs) / 3_600_000;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ page state -- */

/** Is a visible password field on screen? The most reliable "logged out" tell. */
export async function hasLoginForm(page) {
  return (await page.locator('input[type="password"]:visible').count()) > 0;
}

const BLOCK_MARKERS = [
  { kind: 'cloudflare', re: /just a moment|checking your browser|cf-browser-verification|attention required/i },
  { kind: 'captcha', re: /recaptcha|hcaptcha|are you a robot|verify you are human/i },
  { kind: 'twofactor', re: /two[- ]factor|verification code|authenticator app|one[- ]time (pass)?code/i },
];

/**
 * Detect an interstitial that automation cannot get past. Reported plainly so
 * the program can be marked manual-only instead of silently retried forever.
 */
export async function detectBlocker(page) {
  const [title, body] = await Promise.all([
    page.title().catch(() => ''),
    page.locator('body').innerText({ timeout: 5000 }).catch(() => ''),
  ]);
  const haystack = `${title}\n${body.slice(0, 4000)}`;
  for (const marker of BLOCK_MARKERS) {
    if (marker.re.test(haystack)) return marker.kind;
  }
  return null;
}

/* -------------------------------------------------------------- DOM find -- */

/**
 * Find the value belonging to a label, wherever the theme happens to put it.
 *
 * Affiliate dashboards render the same information four or five different ways
 * — a <th>/<td> pair, a <dt>/<dd> pair, a stat tile with the number above the
 * label, or the number in the element right after the label. Matching on the
 * *label text* survives a theme change; matching on a generated class name does
 * not. That is why this is regex-on-label rather than a CSS selector.
 *
 * @param {import('playwright').Page} page
 * @param {RegExp} labelRegex
 * @param {{ scope?: string }} options  scope: optional CSS selector to search inside
 * @returns {Promise<{value: string, label: string, strategy: string, selector: string}|null>}
 */
export async function findStatByLabel(page, labelRegex, { scope = null } = {}) {
  return page.evaluate(
    ({ source, flags, scope: scopeSelector }) => {
      const re = new RegExp(source, flags);
      const root = (scopeSelector && document.querySelector(scopeSelector)) || document;
      const NUMERIC = /[\d]/;

      const text = (el) => (el && (el.innerText ?? el.textContent) ? (el.innerText ?? el.textContent).trim() : '');
      const cssPath = (el) => {
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1 && parts.length < 5) {
          let part = node.tagName.toLowerCase();
          if (node.id) { parts.unshift(`${part}#${node.id}`); break; }
          const cls = (node.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (cls.length) part += `.${cls.join('.')}`;
          parts.unshift(part);
          node = node.parentElement;
        }
        return parts.join(' > ');
      };

      // 1. Table row: <th>Unpaid Earnings</th><td>$120.00</td>
      for (const row of root.querySelectorAll('tr')) {
        const cells = [...row.children].filter((c) => c.tagName === 'TH' || c.tagName === 'TD');
        if (cells.length < 2) continue;
        const label = text(cells[0]);
        if (!re.test(label)) continue;
        const value = text(cells[cells.length - 1]);
        if (NUMERIC.test(value)) {
          return { value, label, strategy: 'table-row', selector: cssPath(row) };
        }
      }

      // 2. Definition list: <dt>Visits</dt><dd>1,204</dd>
      for (const dt of root.querySelectorAll('dt')) {
        if (!re.test(text(dt))) continue;
        const dd = dt.nextElementSibling;
        if (dd && dd.tagName === 'DD' && NUMERIC.test(text(dd))) {
          return { value: text(dd), label: text(dt), strategy: 'definition-list', selector: cssPath(dd) };
        }
      }

      // 3. Stat tile: a small container holding exactly a label line and a number line.
      for (const el of root.querySelectorAll('div, li, section, article, td, span, a')) {
        if (el.children.length > 4) continue;
        const content = text(el);
        if (!content || content.length > 140) continue;
        const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length !== 2) continue;
        const labelLine = lines.find((l) => re.test(l));
        if (!labelLine) continue;
        const valueLine = lines.find((l) => l !== labelLine);
        if (valueLine && NUMERIC.test(valueLine)) {
          return { value: valueLine, label: labelLine, strategy: 'stat-tile', selector: cssPath(el) };
        }
      }

      // 4. Label element with the number in the next sibling, or vice versa.
      for (const el of root.querySelectorAll('span, strong, b, label, p, h1, h2, h3, h4, h5, h6, div, td, th')) {
        if (el.children.length > 0) continue;
        const label = text(el);
        if (!label || label.length > 80 || !re.test(label)) continue;
        for (const sibling of [el.nextElementSibling, el.previousElementSibling]) {
          const value = text(sibling);
          if (value && value.length <= 40 && NUMERIC.test(value) && !re.test(value)) {
            return { value, label, strategy: 'sibling', selector: cssPath(sibling) };
          }
        }
        // The number may live inside the parent, alongside the label text.
        const parent = el.parentElement;
        if (parent) {
          const rest = text(parent).replace(label, '').trim();
          if (rest && rest.length <= 40 && NUMERIC.test(rest)) {
            return { value: rest, label, strategy: 'parent-remainder', selector: cssPath(parent) };
          }
        }
      }

      return null;
    },
    { source: labelRegex.source, flags: labelRegex.flags.replace('g', ''), scope },
  );
}

/**
 * Look up several labelled stats at once.
 * @param {Record<string, RegExp>} fields  e.g. { clicks: /visits|clicks/i }
 * @returns {Promise<Record<string, {value,label,strategy,selector}|null>>}
 */
export async function findStats(page, fields, options) {
  const out = {};
  for (const [key, regex] of Object.entries(fields)) {
    out[key] = await findStatByLabel(page, regex, options);
  }
  return out;
}

/* ---------------------------------------------------------------- login -- */

/**
 * Generic credential login. Adapters override this when a site needs something
 * specific (a named form, a two-step email-then-password flow).
 */
export async function genericLogin(page, credentials, { identitySelectors = [], submitSelectors = [] } = {}) {
  if (!credentials.identity || !credentials.password) {
    throw new AdapterError('no credentials configured in .env', { kind: 'credentials' });
  }

  const password = page.locator('input[type="password"]:visible').first();
  if ((await password.count()) === 0) {
    throw new AdapterError('no password field found on the login page', { kind: 'login' });
  }

  const candidates = [
    ...identitySelectors,
    'input[type="email"]:visible',
    'input[name*="email" i]:visible',
    'input[name*="user" i]:visible',
    'input[name="log"]:visible',
    'input[type="text"]:visible',
  ];
  let filledIdentity = false;
  for (const selector of candidates) {
    const field = page.locator(selector).first();
    if ((await field.count()) > 0 && (await field.isVisible().catch(() => false))) {
      await field.fill(credentials.identity);
      filledIdentity = true;
      break;
    }
  }
  if (!filledIdentity) {
    throw new AdapterError('could not find the username/email field on the login form', { kind: 'login' });
  }

  await password.fill(credentials.password);

  const submits = [...submitSelectors, 'input[type="submit"]:visible', 'button[type="submit"]:visible'];
  let submitted = false;
  for (const selector of submits) {
    const button = page.locator(selector).first();
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
      await button.click({ timeout: 10_000 }).catch(() => {});
      submitted = true;
      break;
    }
  }
  if (!submitted) await password.press('Enter');

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const blocker = await detectBlocker(page);
  if (blocker) {
    throw new AdapterError(`login blocked by ${blocker} — this program is manual-only`, {
      kind: 'blocked',
    });
  }
  if (await hasLoginForm(page)) {
    const message = await page
      .locator('.woocommerce-error, .affwp-errors, [role="alert"], .error, .alert-danger')
      .first()
      .innerText({ timeout: 2000 })
      .catch(() => null);
    throw new AdapterError(
      `login rejected${message ? `: ${message.replace(/\s+/g, ' ').trim().slice(0, 160)}` : ' — still on the login form'}`,
      { kind: 'login' },
    );
  }
}

/**
 * Open the dashboard, reusing a saved session and logging in only when the
 * session has expired. This is the cookie-validity check in practice: rather
 * than trusting an expiry timestamp, it loads the page and looks at what
 * came back.
 */
export async function openDashboard({ page, program, credentials, login = genericLogin, log = null }) {
  const reusedSession = hasSavedSession(program.key);

  await page.goto(program.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1200);

  const blocker = await detectBlocker(page);
  if (blocker) {
    throw new AdapterError(`${blocker} interstitial before login — this program is manual-only`, { kind: 'blocked' });
  }

  if (await hasLoginForm(page)) {
    if (reusedSession) {
      log?.info(`${program.key}: saved session expired, logging in again`);
      clearSession(program.key);
    }
    const loginUrl = program.loginUrl || program.dashboardUrl;
    if (page.url() !== loginUrl) {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    }
    await login(page, credentials, program);
    // Land back on the dashboard: some sites redirect to an account home.
    if (!page.url().startsWith(program.dashboardUrl)) {
      await page.goto(program.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(1000);
    }
    if (await hasLoginForm(page)) {
      throw new AdapterError('still logged out after a successful-looking login', { kind: 'login' });
    }
    return { loggedIn: true, reusedSession: false };
  }

  return { loggedIn: true, reusedSession };
}

/* ------------------------------------------------------------- assembly -- */

/**
 * Turn raw label/value hits into the numeric shape the runner stores.
 * `expectedMetrics` from programs.json decides what "missing" means: a metric
 * the program is known not to track stays null and is not counted as a parse
 * failure, so Blue Ridge's absent clicks never look like a broken adapter.
 */
export function buildStats({ hits, currency = 'USD', expectedMetrics = {}, extraRaw = {} }) {
  const value = (key) => (hits[key] ? hits[key].value : null);

  const clicks = parseCount(value('clicks'));
  const conversions = parseCount(value('conversions'));
  const earnings = toMinorUnits(value('earnings'), { defaultCurrency: currency });
  const unpaidEarnings = toMinorUnits(value('unpaidEarnings'), { defaultCurrency: currency });
  const paidEarnings = toMinorUnits(value('paidEarnings'), { defaultCurrency: currency });
  const scrapedRate = parsePercent(value('conversionRate'));

  const detected =
    parseMoney(value('earnings') ?? value('unpaidEarnings') ?? '', { defaultCurrency: currency })?.currency || currency;

  // Which metrics did we expect to find and fail to?
  const missing = Object.entries({ clicks, conversions, earnings, unpaidEarnings, paidEarnings })
    .filter(([key, v]) => v === null && expectedMetrics[key] !== false)
    .map(([key]) => key);

  return {
    clicks,
    conversions,
    earnings: earnings ?? (unpaidEarnings !== null || paidEarnings !== null ? (unpaidEarnings ?? 0) + (paidEarnings ?? 0) : null),
    unpaidEarnings,
    paidEarnings,
    conversionRate: scrapedRate ?? (clicks && clicks > 0 && conversions !== null ? conversions / clicks : null),
    currency: detected,
    missing,
    raw: {
      hits: Object.fromEntries(
        Object.entries(hits).map(([key, hit]) => [
          key,
          hit ? { value: hit.value, label: hit.label, strategy: hit.strategy, selector: hit.selector } : null,
        ]),
      ),
      ...extraRaw,
    },
  };
}

export { parseMoney, parseCount, parsePercent, toMinorUnits };
