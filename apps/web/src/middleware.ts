import { NextRequest, NextResponse } from "next/server";
import { tokenFromRequest, verifySession } from "@/lib/session";
import { clientIp, limit } from "@/lib/rateLimit";
import {
  applyApiVersionHeaders,
  resolveApiVersion,
  SUPPORTED_API_VERSIONS,
} from "@/lib/apiVersion";

// ---------------------------------------------------------------------------
// Auth gate. A `furlpay_session` cookie is minted on passkey login/registration.
//  - Protected PAGES without a session → redirect to /login.
//  - Protected APIs without a session → 401 JSON.
// Public: marketing/auth pages, auth + webhook + checkout + KYC endpoints
// (webhooks are authenticated by signature, checkout by merchant key).
// ---------------------------------------------------------------------------

const PUBLIC_PAGES = new Set([
  "/",
  "/pricing",
  "/about",
  "/talk-to-us",
  "/changelog",
  "/community",
  "/partners",
  "/use-cases",
  "/careers",
  "/ambassadors",
  "/ambassadors/dashboard", // per-creator dashboard, reached via emailed ?email= link
  "/payouts",
  "/status",
  "/press",
  "/waitlist",
  "/grants",
  "/marketplace",
  "/login",
  "/signup",
  "/actions.json",
  "/sitemap.xml", // SEO — must be crawlable
  "/robots.txt",
  "/~offline", // SW offline fallback — precached by the service worker before login
]);
const PUBLIC_PAGE_PREFIXES = [
  "/docs",
  "/blog",
  "/investing/insights", // FurlPay Research portal — public content, like /blog

  "/legal",
  "/uk", // UK market landing pages (public)
  "/ae", // UAE/Dubai market landing pages (public)
  "/jp", // Japan market landing pages (public)
  "/products", // SEO product landing pages (public)
  "/solutions", // SEO audience/solution landing pages (public)
  "/resources", // guides, tools (fee calculator), glossary (public)
  "/trust", // trust & security center (public)
  "/contact", // contact page (public)
  "/hotels", // programmatic crypto-hotel city landing pages (public)
  "/compare", // SEO comparison pages (public)
  "/integrations", // pSEO framework-integration quickstarts (public)
  "/careers", // job board — per-role pages must be crawlable for Google for Jobs
  "/hackathon", // FurlPay Build Challenge landing + submissions (public)
  "/swag", // FurlPay Swag Center store (public)
  "/newsletter", // subscribe / manage preferences (public)
  "/early-access", // early-access signup landing (public)
  "/developer", // public developer portal + Agent Console demo
  "/pay", // shareable Solana Blink checkout links (unauthenticated by design)
  "/travel", // FurlPay Travels — public discovery & booking funnel (SEO + conversion)
  "/discord", // branded Discord links → external redirects (see next.config redirects)
  "/telegram", // branded Telegram links → external redirects (see next.config redirects)
];
const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/webhooks",
  "/api/checkout",
  "/api/actions", // Solana Actions/Blinks — consumed by unauthenticated Blink clients
  "/api/x402", // agentic pay-per-call APIs — auth IS the payment (HTTP 402)
  "/api/mpp", // Machine Payments Protocol (Stripe/Tempo) — auth IS the payment
  "/api/contact", // public "Talk to us" lead capture
  "/api/support/message", // public chat-bubble → support mailbox (IP rate-limited)
  "/api/hackathon", // public Build Challenge submissions
  "/api/swag", // public Swag Center redemption/order requests
  "/api/newsletter", // public newsletter subscribe / unsubscribe
  "/api/early-access", // public early-access signup (IP rate-limited)
  "/api/careers", // public talent-pipeline interest capture
  "/api/ambassadors", // public creator-program applications
  "/api/agents", // public Agent Console demo data
  "/api/payments/stripe/intent", // merchant checkout — creates a PaymentIntent
  "/api/compliance/kyc", // needed during signup, before a session exists
  "/api/markets", // public market data — powers the research portal's pulse strip
  "/api/insights", // public research metadata
  "/api/travel", // FurlPay Travels — public search/deals/booking demo surface
  "/api/chain", // public chain registry — status, gas, contracts, USDC directory
  "/api/rails", // public payment-rail map — protocol, chains, fees, live status
  "/api/docs/feedback", // anonymous docs page feedback counters (IP rate-limited)
  "/api/transfers/gasless", // Smart Gas: GET quote is public; POST enforces its own session via requireUser
  "/api/payments/fees", // public fee estimator — merchants compare vs card interchange
  "/api/discord", // Discord interactions — auth IS the Ed25519 signature (401 otherwise)
  "/api/telegram", // Telegram webhook — auth IS the secret_token header (401 otherwise)
  "/api/account/fund", // x402 account funding — auth IS the payment (settles or 402s)
  "/api/onramp", // headless on-ramp — publishable-key scoped, embedded by partners
  "/api/offramp", // headless off-ramp — mints a Coinbase-hosted sell URL (Coinbase owns KYC/auth); rate-limited, 503 until CDP creds set
];

// Baseline flood control for every mutating API call — one per-IP budget that
// backstops the ~60 routes without their own limiter. Generous enough that no
// legitimate client hits it (sensitive routes keep their tighter per-route
// budgets), Redis-backed so it holds across instances, fail-open on KV errors.
// Webhooks are exempt: they're signature-authenticated, providers batch
// deliveries from few IPs, and deposit-detect already self-limits higher.
const BASELINE_EXEMPT_PREFIXES = ["/api/webhooks"];
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BASELINE = { limit: 150, windowMs: 60_000 };

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Verify the JWT signature (edge-safe via jose), not just cookie presence.
  // Token comes from the cookie (web) or Authorization: Bearer (mobile app).
  const claims = await verifySession(tokenFromRequest(req));
  const hasSession = Boolean(claims);

  const isApi = pathname.startsWith("/api");

  // API version negotiation (X-Api-Version, date-based). Unknown versions are
  // rejected up front so a client never silently runs against the wrong
  // contract; the resolved version is stamped on every API response below.
  const apiVersion = isApi ? resolveApiVersion(req.headers.get("x-api-version")) : null;
  if (apiVersion && !apiVersion.ok) {
    return NextResponse.json(
      {
        error: "unsupported_api_version",
        requested: apiVersion.requested,
        supported: SUPPORTED_API_VERSIONS,
      },
      { status: 400 }
    );
  }

  if (
    isApi &&
    MUTATING_METHODS.has(req.method) &&
    !BASELINE_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    const rl = await limit(`api-baseline:${clientIp(req)}`, BASELINE);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }
  }
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (isApi) {
    const version = apiVersion && apiVersion.ok ? apiVersion.version : undefined;
    const pass = () =>
      version ? applyApiVersionHeaders(NextResponse.next(), version) : NextResponse.next();
    if (isPublicApi || hasSession) return pass();
    // Agent-initiated escrow calls authenticate with RFC 9421 signatures
    // instead of a session cookie. Pass them through to the route, which
    // verifies the signature against registered agent keys and 401s any
    // invalid/unknown/tampered one (lib/agentTrustGate).
    if (pathname.startsWith("/api/escrow") && req.headers.get("signature-input")) {
      return pass();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Page routes
  const isPublicPage =
    PUBLIC_PAGES.has(pathname) || PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
  if (isPublicPage || hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on app pages + API; skip Next internals and any static asset with a
  // file extension (images, og.png, svgo logos, fonts) so crawlers and social
  // scrapers fetch them directly without hitting the auth redirect.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf|json|xml|txt|mp4|webm|mov|mp3|m4a)).*)",
  ],
};
