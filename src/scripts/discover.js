/**
 * DISCOVERY — phase 2. Run this before writing any selector.
 *
 *   npm run discover                 # all programs, visible browser
 *   npm run discover -- --program=idun_peptides
 *   npm run discover -- --manual     # you log in by hand; handles 2FA / Cloudflare
 *   npm run discover -- --headless
 *
 * For each program it: opens the dashboard, reuses a saved session or logs in,
 * fingerprints the platform, dumps the rendered HTML to research/<key>.html,
 * takes a screenshot, extracts every label/number pair it can see, and saves the
 * session cookies so later syncs do not have to log in again.
 *
 * Nothing here writes to the database. It only tells you what each site is.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { chromium } from 'playwright';
import { PATHS } from '../config/paths.js';
import { loadPrograms, credentialsFor, missingCredentials } from '../config/index.js';
import { fingerprint } from '../lib/fingerprint.js';
import { createLogger } from '../lib/logger.js';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--program='))?.split('=')[1] || null;
const manualLogin = args.includes('--manual');
// Headed by default: discovery is a step you watch. --headless for re-runs.
const headless = args.includes('--headless');

const log = createLogger('discover');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

/**
 * Pull every "label -> number" pair the page shows. Affiliate dashboards are
 * mostly a row of labelled stat tiles plus a summary table, and this is the
 * raw material for writing real selectors instead of guessing at them.
 */
async function extractLabelledNumbers(page) {
  return page.evaluate(() => {
    const NUMERIC = /^[\s$€£¥]*[-−(]?[\d][\d.,\s]*\)?\s*%?\s*(USD|EUR|GBP)?\s*$/i;
    const out = [];

    const cssPath = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 6) {
        let part = node.tagName.toLowerCase();
        if (node.id) { parts.unshift(`${part}#${node.id}`); break; }
        const cls = (node.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) part += `.${cls.join('.')}`;
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };

    // 1. Stat tiles: a small container holding one number and one text label.
    for (const el of document.querySelectorAll('div, li, td, section, article, span')) {
      const text = (el.innerText || '').trim();
      if (!text || text.length > 120) continue;
      if (el.children.length > 4) continue;
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length !== 2) continue;
      const [a, b] = lines;
      const aNum = NUMERIC.test(a);
      const bNum = NUMERIC.test(b);
      if (aNum === bNum) continue;
      out.push({ kind: 'tile', label: aNum ? b : a, value: aNum ? a : b, selector: cssPath(el) });
    }

    // 2. Definition-style rows: <th>Label</th><td>123</td> and dl/dt/dd.
    for (const row of document.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('th, td')].map((c) => (c.innerText || '').trim());
      if (cells.length === 2 && NUMERIC.test(cells[1]) && cells[0] && !NUMERIC.test(cells[0])) {
        out.push({ kind: 'row', label: cells[0], value: cells[1], selector: cssPath(row) });
      }
    }
    for (const dt of document.querySelectorAll('dt')) {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === 'DD') {
        const value = (dd.innerText || '').trim();
        if (NUMERIC.test(value)) out.push({ kind: 'dl', label: (dt.innerText || '').trim(), value, selector: cssPath(dd) });
      }
    }

    // De-duplicate on label+value.
    const seen = new Set();
    return out.filter((item) => {
      const k = `${item.label}|${item.value}`;
      if (seen.has(k) || !item.label) return false;
      seen.add(k);
      return true;
    }).slice(0, 60);
  });
}

async function findLoginForm(page) {
  const password = page.locator('input[type="password"]:visible').first();
  if ((await password.count()) === 0) return null;

  const identitySelectors = [
    'input#affwp-login-user-login',
    'input[name="log"]',
    'input[type="email"]:visible',
    'input[name*="email" i]:visible',
    'input[name*="user" i]:visible',
    'input[type="text"]:visible',
  ];
  for (const selector of identitySelectors) {
    const field = page.locator(selector).first();
    if ((await field.count()) > 0 && (await field.isVisible().catch(() => false))) {
      return { identity: field, password };
    }
  }
  return { identity: null, password };
}

async function discoverProgram(browser, program) {
  const result = {
    key: program.key,
    displayName: program.displayName,
    dashboardUrl: program.dashboardUrl,
    startedAt: new Date().toISOString(),
    loginAutomated: null,
    loggedIn: null,
    finalUrl: null,
    title: null,
    platform: null,
    blockers: [],
    labelledNumbers: [],
    files: {},
    error: null,
  };

  const storagePath = path.join(PATHS.storage, `${program.key}.json`);
  const hasSession = fs.existsSync(storagePath);
  const context = await browser.newContext({
    storageState: hasSession ? storagePath : undefined,
    viewport: { width: 1440, height: 1000 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    log.info(`${program.key}: opening ${program.dashboardUrl}${hasSession ? ' (saved session)' : ''}`);
    await page.goto(program.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);

    let form = await findLoginForm(page);

    if (form && manualLogin) {
      console.log(`\n  >> ${program.displayName}: log in by hand in the browser window, then press Enter here.`);
      await ask('     [Enter] when the dashboard is on screen: ');
      result.loginAutomated = false;
      form = await findLoginForm(page);
    } else if (form) {
      const missing = missingCredentials(program);
      if (missing.length) {
        result.loginAutomated = false;
        result.error = `login form present but ${missing.join(' and ')} not set in .env`;
        log.warn(`${program.key}: ${result.error}`);
      } else {
        const credentials = credentialsFor(program);
        log.info(`${program.key}: login form found, attempting sign-in as ${program.loginIdentity}`);
        if (form.identity) await form.identity.fill(credentials.identity);
        await form.password.fill(credentials.password);
        await Promise.race([
          page.keyboard.press('Enter'),
          page.locator('button[type="submit"], input[type="submit"]').first().click({ timeout: 5000 }).catch(() => {}),
        ]);
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2500);
        form = await findLoginForm(page);
        result.loginAutomated = form === null;
      }
    } else {
      result.loggedIn = true;
      result.loginAutomated = hasSession ? 'reused-session' : 'no-login-required';
    }

    if (result.loggedIn === null) result.loggedIn = form === null;

    const html = await page.content();
    const print = fingerprint(html);
    result.platform = print;
    result.blockers = print.blockers;
    result.finalUrl = page.url();
    result.title = await page.title();
    result.labelledNumbers = await extractLabelledNumbers(page);

    fs.mkdirSync(PATHS.research, { recursive: true });
    const htmlFile = path.join(PATHS.research, `${program.key}.html`);
    const shotFile = path.join(PATHS.research, `${program.key}.png`);
    fs.writeFileSync(htmlFile, html);
    await page.screenshot({ path: shotFile, fullPage: true }).catch(() => {});
    result.files = {
      html: path.relative(PATHS.root, htmlFile),
      screenshot: path.relative(PATHS.root, shotFile),
    };

    if (result.loggedIn) {
      fs.mkdirSync(PATHS.storage, { recursive: true });
      await context.storageState({ path: storagePath });
      result.files.session = path.relative(PATHS.root, storagePath);
      log.info(`${program.key}: session saved`);
    }
  } catch (error) {
    result.error = error.message;
    log.error(`${program.key}: ${error.message}`);
  } finally {
    await context.close().catch(() => {});
  }

  result.finishedAt = new Date().toISOString();
  return result;
}

function summarise(results) {
  console.log('\n─── discovery summary ──────────────────────────────────────────\n');
  for (const r of results) {
    const platform = r.platform?.bestGuess || 'unknown';
    const state = r.error ? `ERROR — ${r.error}` : r.loggedIn ? 'logged in' : 'NOT logged in';
    console.log(`  ${r.displayName}`);
    console.log(`    platform     ${platform}${r.platform?.platforms?.length ? ` (${r.platform.platforms.map((p) => p.platform).join(', ')})` : ''}`);
    console.log(`    login        ${state}`);
    if (r.blockers.length) console.log(`    blockers     ${r.blockers.map((b) => b.label).join(', ')}  <-- likely manual-only`);
    console.log(`    stats found  ${r.labelledNumbers.length}`);
    for (const item of r.labelledNumbers.slice(0, 8)) {
      console.log(`                 ${item.label} = ${item.value}`);
    }
    if (r.files.html) console.log(`    html         ${r.files.html}`);
    console.log('');
  }
  console.log('─────────────────────────────────────────────────────────────────\n');
}

async function main() {
  const programs = loadPrograms().filter((p) => !only || p.key === only);
  if (programs.length === 0) {
    console.error(`No program matched --program=${only}`);
    process.exit(1);
  }

  fs.mkdirSync(PATHS.research, { recursive: true });
  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 120 });

  const results = [];
  // Sequential on purpose: discovery is a supervised step, and with --manual you
  // are typing into one window at a time.
  for (const program of programs) {
    results.push(await discoverProgram(browser, program));
  }
  await browser.close();

  const reportFile = path.join(PATHS.research, 'discovery-report.json');
  fs.writeFileSync(reportFile, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  summarise(results);
  console.log(`  Full report: ${path.relative(PATHS.root, reportFile)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
