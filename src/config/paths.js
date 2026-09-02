import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  programsFile: path.join(ROOT, 'config', 'programs.json'),
  // Everything below is gitignored — it holds live cookies, account HTML and logs.
  data: path.join(ROOT, 'data'),
  db: path.join(ROOT, 'data', 'affiliates.sqlite'),
  storage: path.join(ROOT, 'data', 'storage'), // one Playwright storageState file per program
  research: path.join(ROOT, 'research'),       // discovery HTML dumps
  logs: path.join(ROOT, 'logs'),
  migrations: path.join(ROOT, 'src', 'db', 'migrations'),
};
