/**
 * Manual adapter — for programs that scraping cannot reach.
 *
 * This is not a stub. It is the honest answer for a site behind Cloudflare, a
 * 2FA prompt, or a layout nobody has looked at yet: the sync records a clear
 * "needs manual entry" status for that program, the other four carry on, and
 * the dashboard card shows an "enter manually" button that opens the form
 * pre-filled for it.
 *
 * A program stays on this adapter until `npm run discover` proves a real one
 * will work.
 */
export const name = 'manual';
export const platform = 'manual entry';
export const manualOnly = true;

export async function fetchStats({ config }) {
  const reason =
    config.manualReason ||
    'no verified scraper for this program yet — run `npm run discover` or enter the numbers by hand';
  const error = new Error(reason);
  error.kind = 'manual';
  throw error;
}

export default { name, platform, manualOnly, fetchStats };
