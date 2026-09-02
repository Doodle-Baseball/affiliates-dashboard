/**
 * Platform fingerprinting from raw dashboard HTML.
 *
 * Which platform a site runs decides which adapter it gets, and two sites on the
 * same platform share one adapter with different config. This is evidence
 * gathering only — it reports what it saw, it does not guess.
 */

const SIGNATURES = [
  { platform: 'affiliatewp', label: 'AffiliateWP (WordPress)', patterns: [/affwp[-_]/i, /affiliate-wp/i, /affwp_/i, /affiliate-area/i] },
  { platform: 'goaffpro', label: 'GoAffPro', patterns: [/goaffpro/i, /goaffpro\.com/i] },
  { platform: 'uppromote', label: 'UpPromote (Secomapp)', patterns: [/uppromote/i, /secomapp/i] },
  { platform: 'refersion', label: 'Refersion', patterns: [/refersion/i] },
  { platform: 'tapfiliate', label: 'Tapfiliate', patterns: [/tapfiliate/i] },
  { platform: 'leaddyno', label: 'LeadDyno', patterns: [/leaddyno/i] },
  { platform: 'postaffiliatepro', label: 'Post Affiliate Pro', patterns: [/qualityunit/i, /pap[_-]?trk/i] },
  { platform: 'shopify', label: 'Shopify storefront', patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /shopify-features/i] },
  { platform: 'woocommerce', label: 'WooCommerce', patterns: [/woocommerce/i, /wc-ajax/i] },
  { platform: 'wordpress', label: 'WordPress', patterns: [/wp-content/i, /wp-includes/i] },
];

const BLOCKERS = [
  { kind: 'cloudflare', label: 'Cloudflare challenge', patterns: [/cf-browser-verification/i, /Just a moment\.\.\./i, /challenge-platform/i, /cf_chl/i] },
  { kind: 'captcha', label: 'CAPTCHA', patterns: [/recaptcha/i, /hcaptcha/i, /turnstile/i] },
  { kind: 'twofactor', label: 'Two-factor prompt', patterns: [/two[- ]factor/i, /verification code/i, /authenticator app/i, /one[- ]time (pass)?code/i] },
];

function matches(html, patterns) {
  return patterns.filter((p) => p.test(html)).map((p) => p.source);
}

export function fingerprint(html) {
  const platforms = [];
  for (const sig of SIGNATURES) {
    const hits = matches(html, sig.patterns);
    if (hits.length) platforms.push({ platform: sig.platform, label: sig.label, hits });
  }
  const blockers = [];
  for (const b of BLOCKERS) {
    const hits = matches(html, b.patterns);
    if (hits.length) blockers.push({ kind: b.kind, label: b.label, hits });
  }

  // A storefront/CMS signature is weaker evidence than a dedicated affiliate
  // platform, so rank the affiliate platforms first.
  const generic = new Set(['shopify', 'woocommerce', 'wordpress']);
  const ranked = [...platforms].sort(
    (a, b) => (generic.has(a.platform) ? 1 : 0) - (generic.has(b.platform) ? 1 : 0) || b.hits.length - a.hits.length,
  );

  return {
    platforms: ranked,
    bestGuess: ranked.length ? ranked[0].platform : null,
    blockers,
    looksLoggedOut: /type=["']password["']/i.test(html) || /\bLost your password\b/i.test(html),
  };
}
