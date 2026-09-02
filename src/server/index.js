/**
 * Local dashboard server. Binds to 127.0.0.1 only — there is no login by
 * default, so it must never be reachable from the network. For a deployed
 * instance see api/index.js and DEPLOY.md, where a password is mandatory.
 */
import { settings } from '../config/index.js';
import { createApp } from './app.js';

const app = createApp();

app.listen(settings.port, '127.0.0.1', () => {
  console.log(`\n  Dashboard: http://127.0.0.1:${settings.port}\n  Logs:      logs/server.log\n`);
});
