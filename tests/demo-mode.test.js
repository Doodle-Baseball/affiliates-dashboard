import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Demo mode waives the dashboard password. That is only safe because demo mode
 * implies there is no real data — an in-memory database seeded with invented
 * figures. If the two ever came apart, a deployment holding real earnings would
 * serve them to anyone. These tests pin that relationship.
 */

const ENV_KEYS = ['VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'LAMBDA_TASK_ROOT', 'DATABASE_URL', 'DASHBOARD_PASSWORD', 'NODE_ENV'];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

// Imported lazily so each test sees the env it just set.
const db = async () => import('../src/db/index.js');
const auth = async () => import('../src/server/auth.js');

describe('isDemoMode', () => {
  it('is on for a serverless host with no database configured', async () => {
    process.env.VERCEL = '1';
    expect((await db()).isDemoMode()).toBe(true);
  });

  it('is off as soon as a database is configured', async () => {
    process.env.VERCEL = '1';
    process.env.DATABASE_URL = 'libsql://example.turso.io';
    expect((await db()).isDemoMode()).toBe(false);
  });

  it('is off when a file database is explicitly chosen, even on serverless', async () => {
    process.env.VERCEL = '1';
    process.env.DATABASE_URL = 'file:/tmp/x.sqlite';
    expect((await db()).isDemoMode()).toBe(false);
  });

  it('is off locally, where the default file database is the right answer', async () => {
    expect((await db()).isDemoMode()).toBe(false);
  });
});

describe('the password requirement', () => {
  it('is waived only in demo mode', async () => {
    process.env.VERCEL = '1';
    expect((await auth()).authConfig().required).toBe(false);
  });

  it('is enforced the moment a real database is configured', async () => {
    process.env.VERCEL = '1';
    process.env.DATABASE_URL = 'libsql://example.turso.io';
    expect((await auth()).authConfig().required).toBe(true);
  });

  it('is enforced for a remote database even outside a serverless host', async () => {
    process.env.DATABASE_URL = 'libsql://example.turso.io';
    expect((await auth()).authConfig().required).toBe(true);
  });

  it('is not enforced for a plain local run', async () => {
    expect((await auth()).authConfig().required).toBe(false);
  });

  it('never treats an unset password as enabled auth', async () => {
    process.env.VERCEL = '1';
    expect((await auth()).authConfig().enabled).toBe(false);
  });

  it('enables auth in demo mode too when a password is set', async () => {
    process.env.VERCEL = '1';
    process.env.DASHBOARD_PASSWORD = 'set';
    expect((await auth()).authConfig().enabled).toBe(true);
  });
});
