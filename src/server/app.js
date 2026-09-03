/**
 * The Express app, with no listener attached.
 *
 * Two entry points import this: src/server/index.js binds it to 127.0.0.1 for
 * local use, and api/index.js hands it to Vercel as a serverless function.
 * Keeping the app free of any listen() call is what lets one codebase do both.
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { PATHS } from '../config/paths.js';
import { migrate, isDemoMode } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { createApi } from './api.js';
import { loadPrograms } from '../config/index.js';
import { isDeployed } from './auth.js';

/**
 * Migrations run once per process, on the first request that needs them.
 * Serverless instances come and go, and this is idempotent, so it costs one
 * round trip per cold start and removes a step you can forget.
 */
function migrateOnce(log) {
  let started = null;
  return () => {
    if (!started) {
      started = migrate({ log: (m) => log.info(m) })
        .then(async () => {
          // The demo database lives in memory, so every cold start begins
          // empty and has to be filled before the first request is answered.
          if (!isDemoMode()) return;
          const { isEmpty, seedDemoData } = await import('../db/demo.js');
          if (await isEmpty()) {
            await seedDemoData(loadPrograms());
            log.info('demo mode: seeded sample data (nothing here is real)');
          }
        })
        .catch((error) => {
          started = null; // let the next request retry rather than wedging
          throw error;
        });
    }
    return started;
  };
}

export function createApp({ serveStatic = true } = {}) {
  // Serverless filesystems are read-only, so file logging is local-only.
  const log = createLogger('server', { file: !isDeployed(), console: true });
  const ensureMigrated = migrateOnce(log);

  const app = express();
  app.disable('x-powered-by');

  // In dev the UI is served by Vite on another port and needs to be let through.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/api', (req, res, next) => {
    ensureMigrated().then(() => next()).catch(next);
  });
  app.use('/api', createApi({ log }));

  if (serveStatic) {
    const dist = path.join(PATHS.root, 'web', 'dist');
    if (fs.existsSync(dist)) {
      app.use(express.static(dist, { index: false }));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(dist, 'index.html'));
      });
    } else {
      app.get('/', (req, res) => {
        res.type('html').send(
          '<pre style="font:14px ui-monospace,monospace;padding:2rem;line-height:1.6">' +
            'The UI has not been built yet.\n\n' +
            '  npm run dev     start the API and the Vite dev server together\n' +
            '  npm run build   build web/dist, then `npm start` serves it from here\n' +
            '</pre>',
        );
      });
    }
  }

  app.use((error, req, res, next) => {
    log.error(`unhandled: ${error.message}`, { path: req.path, stack: error.stack });
    if (res.headersSent) return next(error);
    // A ConfigError carries a code the UI can turn into setup instructions,
    // rather than showing the operator a stack trace they cannot act on.
    res.status(error.status || 500).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  });

  return app;
}
