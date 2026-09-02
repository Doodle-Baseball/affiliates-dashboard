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

export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return `file:${PATHS.db}`;
}

export function isRemoteDatabase() {
  return !databaseUrl().startsWith('file:');
}

export function getDb() {
  if (client) return client;
  const url = databaseUrl();
  if (url.startsWith('file:')) {
    // Serverless filesystems are read-only outside /tmp, so a local file URL
    // there is a configuration mistake worth catching early.
    fs.mkdirSync(path.dirname(url.slice('file:'.length)), { recursive: true });
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
