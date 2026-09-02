import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { issueToken, verifyToken, readCookie } from '../src/server/auth.js';

const SECRET = 'a-test-secret';

describe('session tokens', () => {
  it('accepts a token it just issued', () => {
    expect(verifyToken(issueToken(SECRET), SECRET)).toBe(true);
  });

  it('rejects a token signed with a different secret', () => {
    // This is the case that matters: changing DASHBOARD_PASSWORD must
    // invalidate every session issued under the old one.
    expect(verifyToken(issueToken(SECRET), 'another-secret')).toBe(false);
  });

  it('rejects an expired token', () => {
    const expired = issueToken(SECRET, -1);
    expect(verifyToken(expired, SECRET)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const token = issueToken(SECRET);
    const [expires] = token.split('.');
    expect(verifyToken(`${expires}.${'0'.repeat(64)}`, SECRET)).toBe(false);
  });

  it('rejects a tampered expiry', () => {
    const token = issueToken(SECRET);
    const [, signature] = token.split('.');
    // Push the expiry far out while keeping the old signature.
    expect(verifyToken(`${Date.now() + 10 ** 12}.${signature}`, SECRET)).toBe(false);
  });

  it.each([
    ['', 'empty'],
    ['garbage', 'unstructured'],
    ['abc.def', 'non-numeric expiry'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('rejects %s (%s)', (token) => {
    expect(verifyToken(token, SECRET)).toBe(false);
  });

  it('rejects any token when no secret is configured', () => {
    expect(verifyToken(issueToken(SECRET), null)).toBe(false);
  });
});

describe('readCookie', () => {
  const req = (cookie) => ({ headers: cookie === undefined ? {} : { cookie } });

  it('finds the session cookie among others', () => {
    expect(readCookie(req('other=1; affdash=abc.def; more=2'))).toBe('abc.def');
  });

  it('handles a lone cookie', () => {
    expect(readCookie(req('affdash=xyz'))).toBe('xyz');
  });

  it('url-decodes the value', () => {
    expect(readCookie(req('affdash=a%2Eb'))).toBe('a.b');
  });

  it('returns null when absent', () => {
    expect(readCookie(req('other=1'))).toBeNull();
    expect(readCookie(req())).toBeNull();
  });

  it('does not match a cookie whose name merely ends with the same text', () => {
    expect(readCookie(req('notaffdash=nope'))).toBeNull();
  });
});
