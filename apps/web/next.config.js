/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// Security headers — the web-architecture equivalent of a mobile app's
// hardening (TLS-only, anti-tamper, anti-clickjacking). Applied to every
// response. The CSP allow-lists the app's known integrations (Google Fonts /
// Identity, Stripe, Persona) and nothing else.
// ---------------------------------------------------------------------------
// `form-action` must name every origin a form on our pages may POST to.
//
// /api/support/sso works by rendering a self-submitting form that POSTs a JWT to
// https://<subdomain>.zendesk.com/access/jwt — Zendesk's endpoint accepts only a
// form POST, and CORS blocks XHR. With a bare `form-action 'self'` the browser
// BLOCKS that submission: the page renders, the inline script calls submit(),
// and nothing happens. The visitor waits on "Opening FurlPay Support…" forever.
//
// Nothing catches that today because the route 404s until it is configured and
// no UI links to it, so the failure would have appeared on the first day the
// integration was switched on, in production, with no local repro.
//
// So the origin is added ONLY when the integration is actually configured. While
// ZENDESK_SUBDOMAIN is unset — the state of every environment today — the policy
// is byte-for-byte what it was, and no wildcard is introduced for a dormant
// feature. The value is validated to the same charset the route enforces before
// it is interpolated: an env var reaches a security header here, and a stray
// space or semicolon would rewrite the policy rather than extend it.
const zendeskSubdomain = process.env.ZENDESK_SUBDOMAIN;
const zendeskFormAction =
  zendeskSubdomain && /^[a-z0-9-]+$/.test(zendeskSubdomain)
    ? ` https://${zendeskSubdomain}.zendesk.com`
    : "";

// 'unsafe-eval' is DEVELOPMENT-ONLY (audit P2-1). React Refresh / the dev
// overlay evaluate code at runtime; a production Next.js build does not, and
// none of the script origins below require it (Stripe.js, Google Identity,
// Persona and Cal.com publish CSPs without it). Leaving it in production turned
// any HTML-injection sink into arbitrary script execution on the origin that
// holds the session cookie and the passkey ceremonies. 'unsafe-inline' remains
// until the pages move to per-request nonces with 'strict-dynamic' — tracked in
// docs/release/PRODUCTION_REMEDIATION_STATUS.md, not silently dropped.
const scriptEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

const csp = [
  "default-src 'self'",
  // Next.js streams inline bootstrap scripts; integrations load their own SDKs.
  // app.cal.com serves the Cal.com booking embed (embed.js). It is a script
  // origin rather than a frame origin alone because Cal's embed injects and
  // sizes the booking iframe itself — see ScheduleCallButton.tsx.
  `script-src 'self' 'unsafe-inline'${scriptEval} https://js.stripe.com https://accounts.google.com https://apis.google.com https://*.withpersona.com https://www.googletagmanager.com https://app.cal.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  // XHR/fetch to our own API + integration + market-data / RPC endpoints.
  "connect-src 'self' https: wss:",
  // Embedded checkout / KYC / sign-in / scheduling surfaces. pw-auth.circle.com
  // is Circle's PIN iframe for user-controlled wallets (/circle-wallet); the
  // Web SDK hard-codes that origin and checks it on every postMessage.
  "frame-src 'self' https://js.stripe.com https://*.withpersona.com https://accounts.google.com https://app.cal.com https://pw-auth.circle.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self'${zendeskFormAction}`,
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Allow-popups so Google Identity's sign-in popup still works.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    // Camera/mic for video KYC, geolocation for compliance, payment for card
    // flows — same-origin only; everything else denied.
    value:
      "camera=(self), microphone=(self), geolocation=(self), payment=(self), usb=(), browsing-topics=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

// Container build (Dockerfile at the repo root). OPT-IN via NEXT_OUTPUT so the
// Vercel production build is byte-for-byte unchanged: Vercel does its own
// packaging and does not need `standalone`. The tracing root is the monorepo
// root because @furlpay/* workspace packages and the hoisted node_modules live
// there — traced from apps/web alone, the server would start and then fail on
// the first import of a workspace package.
const standalone = process.env.NEXT_OUTPUT === "standalone";

// Settlement OS URL aliases. A real 308 before rendering (a page-level
// redirect streams as 200 behind app/loading.tsx). Mirrors STEP_ALIASES and
// SETTLEMENT_REDIRECTS in src/lib/settlement/routes.ts — routes.spec.ts fails if
// the two drift.
const SETTLEMENT_REDIRECTS = [
  ...Object.entries({
    business: "business-information",
    "verify-identity": "identity",
    details: "business-details",
    "compliance-risk": "compliance",
    "treasury-setup": "treasury",
    "settlement-configuration": "settlement",
    "review-activate": "review",
  }).map(([from, to]) => ({ source: `/settlement/onboarding/${from}`, destination: `/settlement/onboarding/${to}`, permanent: true })),
  { source: "/settlement/rules", destination: "/settlement/treasury/rules", permanent: true },
  { source: "/settlement/activity", destination: "/settlement/payments/transactions", permanent: true },
];

const nextConfig = {
  ...(standalone
    ? { output: "standalone", outputFileTracingRoot: require("path").join(__dirname, "../..") }
    : {}),
  reactStrictMode: true,
  // forbidden() / unauthorized() from next/navigation: lets a server layout
  // answer a real 403 (app/forbidden.tsx) instead of a 200 that says "no".
  // Used by the /analytics admin gate.
  experimental: { authInterrupts: true },
  // Metaplex ships ESM that webpack mis-bundles server-side; load it via
  // Node require at runtime instead (cNFT ticket minting, lib/travel/cnft.ts).
  // Was experimental.serverComponentsExternalPackages until Next 15 promoted it
  // to a stable top-level option under this name.
  serverExternalPackages: [
    "@metaplex-foundation/mpl-bubblegum",
    "@metaplex-foundation/umi",
    "@metaplex-foundation/umi-bundle-defaults",
  ],
  // Compile the shared TypeScript compliance package from the monorepo.
  transpilePackages: [
    "@furlpay/compliance",
    "@furlpay/types",
    "@furlpay/account-kit",
    "@furlpay/ui",
    "@furlpay/security",
    "@furlpay/ledger",
    "@furlpay/control-plane",
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // The 2026 stablecoin report was served at /research/<slug> in
      // production before the research library moved reports to
      // /reports/<slug>. That path now belongs to /research/[desk] and would
      // 404, so the shared link is sent to the canonical page.
      {
        source: "/research/global-stablecoin-report-2026",
        destination: "/reports/global-stablecoin-report-2026",
        permanent: true,
      },
      // The partnership page lives at /partnerships. Exact match only, so the
      // logo assets under /partners/* are untouched.
      { source: "/partners", destination: "/partnerships", permanent: true },
      // Retired blog post — send any lingering links to the blog.
      { source: "/blog/i-decompiled-robinhood-redotpay-indmoney", destination: "/blog", permanent: true },
      // The hotel-map engineering post was retired in favour of the
      // traveller-facing guide to the same surface. It was live and in the
      // sitemap, so this points at the replacement rather than at /blog —
      // a reader following an old link wanted the map, not an index.
      {
        source: "/blog/furlpay-hotel-map-luxury-properties-openstreetmap-book-in-usdc",
        destination: "/blog/explore-hotels-resorts-villas-on-the-world-map",
        permanent: true,
      },
      // Branded Discord links (temporary redirects so the target can change
      // without stale caching). /discord → join the community server;
      // /discord/bot → add the Furlpay bot to your own server.
      { source: "/discord", destination: "https://discord.gg/PUExXrMt3z", permanent: false },
      {
        source: "/discord/bot",
        destination: "https://discord.com/oauth2/authorize?client_id=1523364052116705400",
        permanent: false,
      },
      // Short, shareable event link for social bios and print. Temporary so the
      // canonical /events/<slug> page stays the one URL that accrues ranking and
      // so the short link can be repointed at next year's edition.
      { source: "/token2049", destination: "/events/token2049-singapore-2026", permanent: false },
      // Branded Telegram links.
      { source: "/telegram", destination: "https://t.me/FurlpayBot", permanent: false },
      { source: "/telegram/group", destination: "https://t.me/FurlPay", permanent: false },
      { source: "/telegram/channel", destination: "https://t.me/furlpayofficial", permanent: false },
      ...SETTLEMENT_REDIRECTS,
    ];
  },
};

// Bundle analyzer — opt-in via ANALYZE=true (e.g. `ANALYZE=true npm run build`),
// writes interactive treemaps to .next/analyze/. Client bundles carry viem;
// this is the tool that keeps that under control.
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

// Serwist (service worker / PWA) — compiles src/sw.ts into public/sw.js at
// build time and auto-registers it. ESM-only package, hence the dynamic import.
module.exports = async () => {
  const { default: withSerwistInit } = await import("@serwist/next");
  const withSerwist = withSerwistInit({
    swSrc: "src/sw.ts",
    swDest: "public/sw.js",
    // Dev builds skip the SW entirely — caching would mask hot reloads.
    disable: process.env.NODE_ENV === "development",
    // The offline fallback page must be precached for fallbacks{} in sw.ts to
    // serve it. Fresh revision per build so updates propagate.
    additionalPrecacheEntries: [
      { url: "/~offline", revision: Date.now().toString(36) },
    ],
  });
  return withBundleAnalyzer(withSerwist(nextConfig));
};

// Exposed for src/lib/settlement/__tests__/routes.spec.ts (drift check).
module.exports.settlementRedirects = SETTLEMENT_REDIRECTS;
