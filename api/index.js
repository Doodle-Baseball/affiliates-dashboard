/**
 * Vercel serverless entry point.
 *
 * Vercel routes every /api/* request here (see vercel.json) and hands the
 * request straight to the Express app, which is the same app that runs
 * locally. What differs on Vercel is enforced elsewhere:
 *
 *   • the database must be remote — DATABASE_URL=libsql://…, because a
 *     serverless filesystem does not persist
 *   • a password is mandatory — src/server/auth.js refuses to serve without one
 *   • no browser exists here, so /api/sync answers 501 and points at
 *     `npm run sync -- --push`, which scrapes on your machine and posts results
 *     to /api/ingest
 *
 * Static files are served by Vercel's CDN, not by Express, so this app skips
 * them entirely.
 */
import { createApp } from '../src/server/app.js';

export default createApp({ serveStatic: false });
