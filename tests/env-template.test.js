import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * .env.example is tracked in git and this repository is public, so a real value
 * pasted into it is a published secret. This has already happened once. The
 * test exists so it fails in `npm test` instead of on GitHub.
 */
describe('.env.example carries no real values', () => {
  const lines = fs
    .readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  // Settings that are meant to ship with a default. Anything holding a
  // credential must not appear here.
  const ALLOWED_DEFAULTS = new Set(['PORT', 'SYNC_CONCURRENCY', 'HEADED', 'TIMEZONE']);

  const SECRET_KEY = /PASSWORD|TOKEN|SECRET|EMAIL|_KEY$|_URL$/i;

  it('leaves every credential blank', () => {
    const filled = lines
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return { key: key.trim(), value: rest.join('=').trim() };
      })
      .filter(({ key, value }) => value !== '' && !ALLOWED_DEFAULTS.has(key));

    // Report the key names only — never the values, even in a failure message.
    expect(filled.map(({ key }) => key)).toEqual([]);
  });

  it('flags anything that looks like a secret key with a value', () => {
    const leaked = lines
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return { key: key.trim(), value: rest.join('=').trim() };
      })
      .filter(({ key, value }) => SECRET_KEY.test(key) && value !== '')
      .map(({ key }) => key);

    expect(leaked).toEqual([]);
  });

  it('is not itself gitignored — it must stay a committed template', () => {
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).not.toMatch(/^\.env\.example$/m);
  });
});
