/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// Security headers — the web-architecture equivalent of a mobile app's
// hardening (TLS-only, anti-tamper, anti-clickjacking). Applied to every
// response. The CSP allow-lists the app's known integrations (Google Fonts /
// Identity, Stripe, Persona) and nothing else.
// ---------------------------------------------------------------------------
const csp = [
  "default-src 'self'",
  // Next.js streams inline bootstrap scripts; integrations load their own SDKs.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://accounts.google.com https://apis.google.com https://*.withpersona.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  // XHR/fetch to our own API + integration + market-data / RPC endpoints.
  "connect-src 'self' https: wss:",
  // Embedded checkout / KYC / sign-in / scheduling surfaces.
  "frame-src 'self' https://js.stripe.com https://*.withpersona.com https://accounts.google.com https://calendly.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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

const nextConfig = {
  reactStrictMode: true,
  // Compile the shared TypeScript compliance package from the monorepo.
  transpilePackages: [
    "@furlpay/compliance",
    "@furlpay/types",
    "@furlpay/account-kit",
    "@furlpay/ui",
    "@furlpay/security",
    "@furlpay/ledger",
  ],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Retired blog post — send any lingering links to the blog.
      { source: "/blog/i-decompiled-robinhood-redotpay-indmoney", destination: "/blog", permanent: true },
      // Branded Discord links (temporary redirects so the target can change
      // without stale caching). /discord → join the community server;
      // /discord/bot → add the Furlpay bot to your own server.
      { source: "/discord", destination: "https://discord.gg/PUExXrMt3z", permanent: false },
      {
        source: "/discord/bot",
        destination: "https://discord.com/oauth2/authorize?client_id=1523364052116705400",
        permanent: false,
      },
      // Branded Telegram links.
      { source: "/telegram", destination: "https://t.me/FurlpayBot", permanent: false },
      { source: "/telegram/group", destination: "https://t.me/FurlPay", permanent: false },
      { source: "/telegram/channel", destination: "https://t.me/furlpayofficial", permanent: false },
    ];
  },
};

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
  return withSerwist(nextConfig);
};
