import { migrate, closeDb } from '../db/index.js';

const result = migrate({ log: (m) => console.log(`  ${m}`) });
if (result.applied.length === 0) {
  console.log(`  schema is up to date (${result.total} migration${result.total === 1 ? '' : 's'})`);
}
closeDb();
