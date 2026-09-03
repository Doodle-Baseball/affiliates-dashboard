import crypto from 'node:crypto';
import { isRemoteDatabase, isDemoMode } from '../db/index.js';

/**
 * Access control.
 *
 * Locally this is off: the server binds to 127.0.0.1 and there is nobody else
 * on the machine. Deployed, it is mandatory — the dashboard shows your earnings
 * and its sync endpoints can drive sign-ins to your affiliate accounts, so an
 * open URL is not an option. The server refuses to start a deployed instance
 * without a password rather than quietly serving one.
 *
 * Two credentials, deliberately separate:
 *   DASHBOARD_PASSWORD  a person, in a browser, gets a signed session cookie
 *   INGEST_TOKEN        your machine's sync run, pushing snapshots up
 * A leaked ingest token can add rows; it cannot read your history.
 */

const COOKIE = 'affdash';
const SESSION_DAYS = 30;

export function isDeployed() {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production' || isRemoteDatabase();
}

export function authConfig() {
  const password = process.env.DASHBOARD_PASSWORD || null;
  const ingestToken = process.env.INGEST_TOKEN || null;
  const secret =
    process.env.AUTH_SECRET ||
    (password ? crypto.createHash('sha256').update(`affdash:${password}`).digest('hex') : null);
  return {
    password,
    ingestToken,
    secret,
    // Demo mode holds nothing but invented figures, so it does not need a
    // password — and demanding one would leave the page dead, which is the
    // whole problem demo mode exists to solve.
    required: isDeployed() && !isDemoMode(),
    enabled: Boolean(password),
  };
}

/** Constant-time compare that tolerates different lengths. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function issueToken(secret, days = SESSION_DAYS) {
  const expires = Date.now() + days * 24 * 60 * 60 * 1000;
  const signature = crypto.createHmac('sha256', secret).update(String(expires)).digest('hex');
  return `${expires}.${signature}`;
}

export function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const [expires, signature] = String(token).split('.');
  if (!expires || !signature) return false;
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', secret).update(expires).digest('hex');
  return safeEqual(signature, expected);
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token, { secure }) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function checkPassword(candidate) {
  const { password } = authConfig();
  return Boolean(password) && safeEqual(candidate ?? '', password);
}

export function checkIngestToken(req) {
  const { ingestToken } = authConfig();
  if (!ingestToken) return false;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  return Boolean(bearer) && safeEqual(bearer, ingestToken);
}

export function isSignedIn(req) {
  const { secret, enabled } = authConfig();
  if (!enabled) return true; // local, no password set
  return verifyToken(readCookie(req), secret);
}

/**
 * Express middleware guarding everything except the endpoints needed to sign in.
 */
export function requireAuth({ open = [] } = {}) {
  return (req, res, next) => {
    const { enabled, required } = authConfig();

    if (required && !enabled) {
      return res.status(500).json({
        error:
          'DASHBOARD_PASSWORD is not set. A deployed dashboard must be password-protected — set it in the environment and redeploy.',
      });
    }
    if (!enabled) return next();
    if (open.some((path) => req.path === path)) return next();
    if (isSignedIn(req)) return next();

    return res.status(401).json({ error: 'not signed in', authRequired: true });
  };
}
