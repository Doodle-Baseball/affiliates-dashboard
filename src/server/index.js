/**
 * Local dashboard server.
 *
 * Binds to 127.0.0.1 only: there is no login, so it must never be reachable
 * from the network. In development it proxies nothing — Vite serves the UI on
 * its own port and calls this API. In production (`npm start`) it serves the
 * built UI from web/dist.
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { PATHS } from '../config/paths.js';
import { settings } from '../config/index.js';
import { migrate } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { createApi } from './api.js';

const log = createLogger('server');
migrate({ log: (m) => log.info(m) });

const app = express();
app.disable('x-powered-by');

// The UI is served from the same origin in production; in dev, Vite's origin
// needs to be allowed through explicitly.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', createApi({ log }));

const dist = path.join(PATHS.root, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
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
        '  npm run build   build web/dist, then `npm start` serves it from here\n\n' +
        `API is up on http://127.0.0.1:${settings.port}/api/dashboard` +
        '</pre>',
    );
  });
}

app.use((error, req, res, next) => {
  log.error(`unhandled: ${error.message}`, { path: req.path, stack: error.stack });
  res.status(500).json({ error: error.message });
});

app.listen(settings.port, '127.0.0.1', () => {
  log.info(`dashboard on http://127.0.0.1:${settings.port}`);
  console.log(`\n  Dashboard: http://127.0.0.1:${settings.port}\n  Logs:      ${log.file}\n`);
});
