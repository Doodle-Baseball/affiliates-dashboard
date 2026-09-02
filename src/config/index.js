import fs from 'node:fs';
import dotenv from 'dotenv';
import { PATHS } from './paths.js';

dotenv.config({ path: `${PATHS.root}/.env` });

/**
 * Load config/programs.json. Non-secret only — never put a password in here.
 */
export function loadPrograms() {
  const raw = fs.readFileSync(PATHS.programsFile, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.programs)) {
    throw new Error('config/programs.json: expected a "programs" array');
  }

  const seen = new Set();
  for (const p of parsed.programs) {
    if (!p.key) throw new Error('config/programs.json: every program needs a "key"');
    if (seen.has(p.key)) throw new Error(`config/programs.json: duplicate key "${p.key}"`);
    seen.add(p.key);
    if (!p.dashboardUrl) throw new Error(`config/programs.json: ${p.key} needs a "dashboardUrl"`);
    if (!p.adapter) throw new Error(`config/programs.json: ${p.key} needs an "adapter"`);
  }
  return parsed.programs;
}

export function getProgram(key) {
  const program = loadPrograms().find((p) => p.key === key);
  if (!program) throw new Error(`Unknown program key: ${key}`);
  return program;
}

/**
 * Credentials for one program, assembled from .env. Returns nulls rather than
 * throwing so that a missing password degrades to one failed adapter, not a
 * crashed sync run.
 */
export function credentialsFor(program) {
  return {
    email: process.env.AFFILIATE_EMAIL || null,
    username: process.env.AFFILIATE_USERNAME || null,
    password: program.passwordEnv ? process.env[program.passwordEnv] || null : null,
    // Which of email/username this site's login form expects.
    identity:
      program.loginIdentity === 'username'
        ? process.env.AFFILIATE_USERNAME || null
        : process.env.AFFILIATE_EMAIL || null,
  };
}

export function missingCredentials(program) {
  const c = credentialsFor(program);
  const missing = [];
  if (!c.identity) missing.push(program.loginIdentity === 'username' ? 'AFFILIATE_USERNAME' : 'AFFILIATE_EMAIL');
  if (!c.password) missing.push(program.passwordEnv);
  return missing;
}

export const settings = {
  port: Number(process.env.PORT) || 4317,
  timezone: process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  syncConcurrency: Math.max(1, Number(process.env.SYNC_CONCURRENCY) || 2),
  headed: process.env.HEADED === '1' || process.env.HEADED === 'true',
};
