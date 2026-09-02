import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config/paths.js';

const MAX_BYTES = 2 * 1024 * 1024; // rotate at 2 MB
const KEEP = 5;

function rotateIfNeeded(file) {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
  } catch {
    return; // no file yet
  }
  for (let i = KEEP - 1; i >= 1; i -= 1) {
    const from = `${file}.${i}`;
    const to = `${file}.${i + 1}`;
    if (fs.existsSync(from)) fs.renameSync(from, to);
  }
  fs.renameSync(file, `${file}.1`);
}

/**
 * Logger that writes to logs/<name>.log (rotating) and mirrors to the console.
 * Every sync run appends here so a cron failure is diagnosable after the fact.
 */
export function createLogger(name = 'sync', { console: toConsole = true, file: toFile = true } = {}) {
  // A serverless filesystem is read-only, so file logging has to be optional;
  // there, the platform's own log drain captures stdout instead.
  let file = null;
  if (toFile) {
    try {
      fs.mkdirSync(PATHS.logs, { recursive: true });
      file = path.join(PATHS.logs, `${name}.log`);
    } catch {
      file = null;
    }
  }

  function write(level, message, meta) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...(meta ? { meta } : {}),
    });
    if (file) {
      try {
        rotateIfNeeded(file);
        fs.appendFileSync(file, `${line}\n`);
      } catch {
        /* logging must never take down a request */
      }
    }
    if (toConsole) {
      const prefix = { info: '  ', warn: '! ', error: 'x ', debug: '. ' }[level] || '  ';
      const suffix = meta ? ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}` : '';
      process.stdout.write(`${prefix}${message}${suffix}\n`);
    }
  }

  return {
    file,
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
    debug: (m, meta) => write('debug', m, meta),
  };
}
