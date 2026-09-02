# Handoff — adapter status

Last updated at the end of the initial build.

## The honest headline

**No adapter has been run against a live site yet.** The build happened in a
sandboxed environment with no access to the accounts and no passwords, so
discovery — the step that shows what each dashboard's HTML actually looks like —
has not been done. It is built and ready as `npm run discover`; it needs to run
on your machine, with your `.env` filled in.

Nothing here is a guessed CSS selector. Where a scraper exists, it matches on
the **visible text of a metric's label** rather than on class names, which is
the assumption most likely to survive a theme you have not seen. Where no
evidence exists at all, the program sits on the `manual` adapter and says so.

## Status per program

| Program | Adapter | State | What has to happen |
|---|---|---|---|
| IDUN Peptides | `affiliatewp` | **provisional** — written, untested | Run discovery, work the `TODO(verify)` list at the top of `src/adapters/affiliatewp.js` |
| American Peptides | `manual` | manual entry only | Discovery to confirm GoAffPro vs UpPromote, then try `generic` |
| Ameano Peptides | `manual` | manual entry only | Same as above |
| Synthesis Peptides | `manual` | manual entry only | Custom platform — discovery will show whether the stats are in the HTML at all |
| Blue Ridge Peptides | `manual` | manual entry only | Coupon-code tracking; expect no clicks ever, and possibly no click column in the portal |

The dashboard is fully usable today on manual entry alone: every card has an
"enter manually" button, entries land in the same table as scrapes, and they
feed the totals, the table and the 30-day chart identically.

## IDUN / AffiliateWP — the one real scraper

**Why this one was written first:** AffiliateWP is open source, ships stock
affiliate-area templates, and the `/affiliate-area/` path in the brief is its
default. It is the most predictable target of the five.

**How it gets today's numbers.** AffiliateWP's main dashboard tab reports
*all-time* totals, not today's. So the adapter does two things:

- **All-time** from the two stat tables on the main tab (Unpaid Earnings, Paid
  Earnings, Visits, Referrals, Conversion Rate). Stored as a `period: 'alltime'`
  snapshot — free history.
- **Today** by opening `?tab=referrals` and `?tab=visits` and counting the rows
  dated today. Row-level data needs no date-filter URL parameters, which is why
  this was chosen over the graphs tab.

The unpaid/paid balances shown on the card come from the all-time read, because
a balance is a point-in-time figure, not a per-day one.

**What would break it, in likelihood order:**

1. **It isn't AffiliateWP.** The whole adapter is wrong; discovery will say so
   in one line and you point the program at a different adapter.
2. **The Referrals or Visits tab is disabled** on this install. Today's figures
   come back unknown, the snapshot is marked `partial`, and all-time still
   lands. The card shows the warning rather than a fake zero.
3. **A non-US date format** in those tables. `parseLooseDate` handles ISO,
   `September 2, 2026` and `mm/dd/yyyy`. A `dd/mm/yyyy` site would misread days
   1–12 of a month and silently undercount. Check one row against a known order.
4. **The Amount column is the order total, not the commission.** Earnings would
   be ~5x too high at a 20% rate. Verify against one known order.
5. **Login goes through WooCommerce rather than AffiliateWP's own form.** Both
   are handled, but a third-party login plugin would not be.
6. **A theme that renames the labels** ("Visits" → "Clicks"). The label regexes
   already accept common synonyms; add to them if needed.

The referral link uses your email as the affiliate ID, so it arrives
URL-encoded (`%40`). Nothing currently parses that link, but decode before
comparing if you add anything that does.

## The generic adapter

`src/adapters/generic.js` logs in, waits for the page to settle, and looks up
each metric by its label text with per-program overrides available in
`config/programs.json`. It is the fast path for GoAffPro/UpPromote-style
portals once discovery shows that (a) automated login works and (b) the numbers
are in the rendered HTML.

It will **not** work where numbers are drawn into a canvas, loaded only after a
click, or behind an interstitial. In those cases it fails loudly with a message
naming the reason, and the program should stay on `manual`.

## Things that will break any adapter

- **Cloudflare, CAPTCHA or 2FA.** Detected explicitly and reported as
  `manual-only`, not retried forever. This is a "tell you immediately" case, not
  a workaround case.
- **A password change.** The saved cookie jar keeps working until it expires,
  then the login fails with `login rejected`. Update `.env`.
- **A layout change.** The metric goes null and the snapshot is `partial`; the
  other metrics still land. Re-run discovery and adjust the label regex.
- **Rate limiting.** Concurrency is capped at 2 and syncs are meant to run 3x a
  day. Do not raise either without a reason.

## What is not built

- **No `mtd` period is populated.** The schema supports it and the API accepts
  it; nothing writes those rows yet. Add it to an adapter when a portal exposes
  a month-to-date figure worth capturing.
- **No currency conversion.** If two programs ever report different currencies,
  the totals row says so rather than adding them together.
- **No browser tests.** Money parsing, aggregation and date handling are covered
  (87 tests); the adapters are not, because a test against markup nobody has
  seen would only assert my assumptions back at me.

## The first thing to do

```bash
npm run setup
# fill in .env
npm run discover
```

Then read the printed summary. It will tell you, per site, what platform it is
and whether login worked — and that is the point at which four of these five
stop being guesses.
