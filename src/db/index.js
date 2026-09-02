import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PATHS } from '../config/paths.js';

let db = null;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(PATHS.db), { recursive: true });
  db = new Database(PATHS.db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * Apply any migration files not yet recorded. Files run in filename order and
 * each runs inside a transaction, so a broken migration leaves no half state.
 */
export function migrate({ log = () => {} } = {}) {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set(
    database.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  );
  const files = fs
    .readdirSync(PATHS.migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f));
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(PATHS.migrations, file), 'utf8');
    const run = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    });
    run();
    log(`applied migration ${file}`);
  }
  return { applied: pending, total: files.length };
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
