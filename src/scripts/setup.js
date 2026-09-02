/**
 * One-shot setup: create the gitignored working directories, run migrations,
 * and report which credentials are still missing. Safe to re-run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config/paths.js';
import { loadPrograms, missingCredentials, settings } from '../config/index.js';
import { migrate, closeDb } from '../db/index.js';

console.log('\nAffiliates dashboard — setup\n');

for (const dir of [PATHS.data, PATHS.storage, PATHS.research, PATHS.logs]) {
  fs.mkdirSync(dir, { recursive: true });
  console.log(`  dir   ${path.relative(PATHS.root, dir)}/`);
}

if (!fs.existsSync(path.join(PATHS.root, '.env'))) {
  fs.copyFileSync(path.join(PATHS.root, '.env.example'), path.join(PATHS.root, '.env'));
  console.log('\n  created .env from .env.example — fill in your passwords before syncing');
}

console.log('');
const result = migrate({ log: (m) => console.log(`  db    ${m}`) });
if (result.applied.length === 0) console.log('  db    schema already up to date');

const programs = loadPrograms();
console.log(`\n  ${programs.length} programs configured, timezone ${settings.timezone}\n`);

let anyMissing = false;
for (const program of programs) {
  const missing = missingCredentials(program);
  const adapter = program.adapter === 'manual' ? 'manual entry' : `adapter: ${program.adapter}`;
  if (missing.length) {
    anyMissing = true;
    console.log(`  ○ ${program.displayName.padEnd(22)} ${adapter}  — missing ${missing.join(', ')}`);
  } else {
    console.log(`  ● ${program.displayName.padEnd(22)} ${adapter}`);
  }
}

if (anyMissing) {
  console.log('\n  Fill the missing values in .env, then run `npm run discover` to log in once.');
} else {
  console.log('\n  All credentials present. Next: `npm run discover`.');
}
console.log('');

closeDb();
