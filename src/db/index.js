import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { PATHS } from '../config/paths.js';

/**
 * Database access.
 *
 * libSQL rather than better-sqlite3, for one reason: it speaks the same SQLite
 * dialect against either a local file or a hosted database over HTTP. The
 * schema and every query below are identical in both, so the laptop and the
 * serverless deployment run the same code — the only difference is the URL.
 *
 *   local     DATABASE_URL=file:/…/data/affiliates.sqlite   (the default)
 *   deployed  DATABASE_URL=libsql://…  + DATABASE_AUTH_TOKEN
 *
 * The API is async, unlike better-sqlite3's — a hosted database is a network
 * call, and pretending otherwise is how you end up rewriting this twice.
 */

let client = null;

/** A configuration problem the operator can fix, as opposed to a bug. */
export class ConfigError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    this.status = 500;
  }
}

export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return `file:${PATHS.db}`;
}

/** Did an operator choose this database, or is it just the local default? */
export function databaseUrlIsExplicit() {
  return Boolean(process.env.DATABASE_URL);
}

export function isRemoteDatabase() {
  return !databaseUrl().startsWith('file:');
}

/**
 * Are we inside a serverless function? There, the bundle directory is read-only
 * and nothing written survives the request, so a file-backed database is never
 * the right answer — it is a missing environment variable.
 */
export function isServerless() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT ||
      PATHS.root.startsWith('/var/task'),
  );
}

/**
 * Demo mode: a serverless deployment with no database configured.
 *
 * That combination used to be a 500. It is almost always someone who has just
 * deployed and has not set DATABASE_URL yet, and showing them a dead page is
 * a poor answer. Instead the instance runs an in-memory database seeded with
 * obviously-sample figures, so the dashboard can be looked at and clicked
 * through immediately. The UI says so in a banner that cannot be missed, and
 * nothing is saved — set DATABASE_URL and it becomes a real dashboard.
 */
export function isDemoMode() {
  return isServerless() && !databaseUrlIsExplicit();
}

export function getDb() {
  if (client) return client;

  if (isDemoMode()) {
    client = createClient({ url: ':memory:' });
    return client;
  }

  const url = databaseUrl();

  if (url.startsWith('file:')) {
    // Only the *unset* case is an error. An operator who deliberately points
    // DATABASE_URL at a file on a serverless host has made a choice — an
    // ephemeral /tmp database for a throwaway test is a legitimate one — and
    // gets a warning rather than a refusal.
    if (isServerless() && databaseUrlIsExplicit()) {
      console.warn(
        '[db] DATABASE_URL is a file on a serverless host: this database is per-instance ' +
          'and is discarded when the instance goes away. Nothing you enter will persist.',
      );
    }
    const dir = path.dirname(url.slice('file:'.length));
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      throw new ConfigError(
        `Cannot create the database directory at ${dir} (${error.code || error.message}). ` +
          'Set DATABASE_URL to a writable location or a hosted libSQL database.',
        'DATABASE_UNWRITABLE',
      );
    }
  }

  client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  return client;
}

/** libSQL rows are array-like; the rest of the app wants plain objects. */
export function toRows(result) {
  return (result?.rows || []).map((row) => ({ ...row }));
}

export function toRow(result) {
  const rows = toRows(result);
  return rows.length ? rows[0] : null;
}

export async function query(sql, args = []) {
  return toRows(await getDb().execute({ sql, args }));
}

export async function queryOne(sql, args = []) {
  return toRow(await getDb().execute({ sql, args }));
}

/** Returns the inserted row id as a Number — libSQL hands back a BigInt. */
export async function insert(sql, args = []) {
  const result = await getDb().execute({ sql, args });
  return result.lastInsertRowid === undefined ? null : Number(result.lastInsertRowid);
}

export async function run(sql, args = []) {
  return getDb().execute({ sql, args });
}

/**
 * Apply any migration files not yet recorded, in filename order.
 */
export async function migrate({ log = () => {} } = {}) {
  const db = getDb();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set((await query('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(PATHS.migrations).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(PATHS.migrations, file), 'utf8');
    await db.executeMultiple(sql);
    await run('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    log(`applied migration ${file}`);
  }
  return { applied: pending, total: files.length };
}

export function closeDb() {
  if (client) {
    client.close?.();
    client = null;
  }
}
