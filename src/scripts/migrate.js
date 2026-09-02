import { migrate, closeDb, databaseUrl } from '../db/index.js';

const url = databaseUrl();
console.log(`  database: ${url.startsWith('file:') ? url : url.replace(/\/\/.*@/, '//…@')}`);

const result = await migrate({ log: (m) => console.log(`  ${m}`) });
if (result.applied.length === 0) {
  console.log(`  schema is up to date (${result.total} migration${result.total === 1 ? '' : 's'})`);
}
closeDb();
