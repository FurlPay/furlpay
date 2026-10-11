import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { isFrozenRoute, featureGateResponse } from "@/lib/featureGate";
import {
  canRefreshSession,
  sessionCookieFromRequest,
  setSessionCookieForRequest,
  signSession,
  tokenFromRequest,
  verifySession,
  type SessionClaims,
} from "@/lib/session";
import { limit, rateLimitIdentity } from "@/lib/rateLimit";
import {
  applyApiVersionHeaders,
  resolveApiVersion,
  SUPPORTED_API_VERSIONS,
} from "@/lib/apiVersion";
import { CORRELATION_HEADER, ensureCorrelationId } from "@/lib/correlation";
import { checkOrigin, ORIGIN_VERIFY_HEADER } from "@/lib/originVerify";
import { configuredPublicOrigin, publicOrigin } from "@/lib/publicOrigin";
import { classifyRequest, recordActiveCountry, recordApiRequest, recordPageView } from "@/lib/analytics/telemetry";
import { trustedClientCountry, trustedClientIp } from "@/lib/clientIp";
import { devAutoLoginEnabled } from "@/lib/devAutoLogin";

// Where an unauthenticated page request goes. Always /login, except in LOCAL
// DEVELOPMENT with FURLPAY_DEV_AUTO_LOGIN=1, where it goes to the dev-only
// auto sign-in (app/api/auth/dev-session), which answers 404 in any production
// build. Public origin, not req.nextUrl: on ECS that is the bind address.
function loginRedirect(req: NextRequest, next: string): NextResponse {
  const url = new URL(devAutoLoginEnabled() ? "/api/auth/dev-session" : "/login", publicOrigin(req));
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

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
  // Marketing page. It is also the one page whose whole purpose is to be read
  // by people deciding whether to trust us — behind /login it is unreachable
  // by them AND uncrawlable, which silently voids its metadata and JSON-LD.
  "/our-founders",
  "/talk-to-us",
  "/changelog",
  "/community",
  "/partners", // redirects to /partnerships (next.config.js)
  "/partnerships", // public partnership page + inquiry form
  "/use-cases",
  "/careers",
  "/ambassadors",
  "/ambassadors/dashboard", // per-creator dashboard, reached via emailed ?email= link
  // Payroll invite: the token is in the URL fragment, which a login redirect
  // would drop. The page keeps it and calls an authenticated API (401 → /login).
  "/payroll/join",
  "/payouts",
  "/status",
  "/press",
  "/waitlist",
  "/downloads", // where every store + desktop badge on the landing page points
  // The FURL token reference page. Its whole purpose is to be readable by people
  // deciding whether to trust the token and by anyone verifying a mint address —
  // behind /login it is unreachable by them AND uncrawlable, which would leave a
  // scam lookalike outranking the real address.
  "/token",
  // The bridge page states that no bridge exists. Public for the same reason
  // /token is: someone checking whether a cross-chain FURL offer is real must be
  // able to read it without an account.
  "/bridge",
  // Short link to the TOKEN2049 event page. next.config.js redirects() answers
  // it before middleware runs, so this only matters if that rule is removed —
  // and then the app/token2049 fallback must redirect, not hit the login wall.
  "/token2049",
  // Published research and its PDF are available without a session or email.
  "/research/global-stablecoin-report-2026",
  "/reports/global-stablecoin-report-2026",
  "/reports/global-stablecoin-report-2026.pdf",
  // The same report with images downsampled (5.6 MB vs 15.6 MB) for mobile
  // readers. Same content, same access as the full PDF above; exact path only.
  "/reports/global-stablecoin-report-2026-lite.pdf",
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
  "/.well-known", // OAuth 2.1 discovery metadata (RFC 8414 / 9728) + assetlinks
  "/p/", // hosted merchant checkout: payers are anonymous; the page reads only the public link/intent views
  "/l/", // verified app links: redirect to the same path (app/l/[...path]); the target gates itself

  "/investing/insights", // FurlPay Research portal — public content, like /blog

  "/legal",
  "/uk", // UK market landing pages (public)
  "/ae", // UAE/Dubai market landing pages (public)
  "/jp", // Japan market landing pages (public)
  "/products", // SEO product landing pages (public)
  "/solutions", // SEO audience/solution landing pages (public)
  "/resources", // guides, tools (fee calculator), glossary (public)
  // The learn glossary (USDC, GENIUS Act, MiCA, CCTP, travel rule...) is a
  // static page per term with no user data. It is in the sitemap, and until
  // 2026-10-02 every one of its 20 URLs 307'd to /login — the site's most
  // search-relevant explainer content was invisible to every crawler.
  "/learn",
  // FurlPay Research library: hub, desks and the email-verification landing.
  "/research",
  "/trust", // trust & security center (public)
  "/contact", // contact page (public)
  "/support", // support center — public help content; the tickets API stays session-gated
  "/hotels", // programmatic crypto-hotel city landing pages (public)
  "/compare", // SEO comparison pages (public)
  "/integrations", // pSEO framework-integration quickstarts (public)
  "/careers", // job board — per-role pages must be crawlable for Google for Jobs
  // Events hub + one page per event. Public for the same reason /our-founders
  // and /token are: the page exists to be read by people deciding whether to
  // meet us, and by the crawlers that surface it when they search the event.
  // A prefix, so /events/<slug> is reachable too — this was gated before, which
  // meant the hub, its Event JSON-LD and its OG cards were all dead in prod.
  "/events",
  // Research and webinar hubs + their detail pages. Public for the same
  // reason /events is: the whole point is to be read, and by the crawlers
  // that surface it. Prefixes, so /reports/<slug> is reachable too.
  "/reports",
  "/webinars",
  "/hackathon", // FurlPay Build Challenge landing + submissions (public)
  "/swag", // FurlPay Swag Center store (public)
  "/newsletter", // subscribe / manage preferences (public)
  "/early-access", // early-access signup landing (public)
  "/developer", // public developer portal + Agent Console demo
  // Shareable checkout links (/pay/x402…), unauthenticated by design. WITH the
  // trailing slash: a bare "/pay" prefix also matched /payroll/*, /payments and
  // /paynow, silently making every "pay…" page public.
  "/pay/",
  "/travel", // FurlPay Travels — public discovery & booking funnel (SEO + conversion)
  "/trips", // FurlPay Trips product page — marketing composition, no user data
  "/onchain", // Onchain Intelligence — public aggregates from /api/onchain (no user ids, truncated addresses)
  // Market data is public: /api/markets* already serves every quote, stat and
  // chart anonymously (rate-limited per IP), so gating the PAGE only stopped
  // people READING published prices — it protected nothing. The one
  // caller-specific field on these screens is the position line, and the route
  // resolves that through optionalUser, so an anonymous reader simply has none.
  // Trading still requires a session; the page offers sign-in instead of a
  // trade sheet that would 401.
  "/markets",
  "/auth/handoff", // native-app → browser session handoff; auth IS the one-time code (redirects to /login otherwise)
  "/discord", // branded Discord links → external redirects (see next.config redirects)
  "/telegram", // public Mini App shell; account data stays behind requireUser APIs
  "/wallet", // FurlPay Wallet handle-reservation landing (pre-launch, public)
];
const PUBLIC_API_PREFIXES = [
  // Generated card images for the Discord price bot. Public market data drawn
  // as a PNG -- the same numbers /api/markets already serves, in a different
  // format. Readable so Discord can fall back to fetching the URL if an
  // attachment upload fails; the normal path uploads the bytes directly.
  // Lead capture for report downloads and webinar registrations. Public by
  // design — a visitor has no account — and each route carries its own
  // per-route rate limit (see routeManifest.spec.ts).
  // Cross-platform analytics ingestion: anonymous visitors and signed-out
  // app sessions report too. Identity, if any, is derived in the route; the
  // route rate-limits and validates every event (lib/analytics/contract.ts).
  "/api/analytics/events",
  "/api/reports",
  // Research downloads: verification + grant redemption. Both authorise by an
  // unguessable single-use token or short-lived grant, not by session.
  "/api/research",
  "/api/webinars",
  "/api/og",
  "/api/auth",
  "/api/webhooks",
  // MCP connector (Claude). The transport route self-authenticates with an
  // OAuth bearer token (401 + WWW-Authenticate on failure) — the middleware's
  // cookie redirect would break discovery. The OAuth endpoints are public by
  // necessity: registration and token exchange happen before a session exists.
  // /api/oauth/authorize is the exception — it calls requireUser itself.
  "/api/mcp",
  "/api/oauth/register",
  "/api/oauth/token",
  "/api/oauth/revoke", // RFC 7009 — a client revoking a leaked token has no session

  "/api/checkout",
  "/api/actions", // Solana Actions/Blinks — consumed by unauthenticated Blink clients
  "/api/x402", // agentic pay-per-call APIs — auth IS the payment (HTTP 402)
  "/api/mpp", // Machine Payments Protocol (Stripe/Tempo) — auth IS the payment
  "/api/contact", // public "Talk to us" lead capture
  "/api/partnerships/inquiries", // public /partners inquiry form (rate-limited, Zod, bot traps)
  "/api/support/message", // public chat-bubble → support mailbox (IP rate-limited)
  // Tier-1 AI deflection for the public chat bubble. The route was written to
  // be public — IP rate limit of 15/min, secret redaction on the question and
  // every history turn — but was never listed here, so it answered
  // "Unauthorized" to the one caller it exists for. It reads nothing
  // user-specific: retrieval runs over the published help centre only, and the
  // model is instructed to answer from those articles or escalate.
  "/api/support/ask",
  // The help-centre index and its search. Publishes only what /docs/help/*
  // already shows anyone. Listed as its own entry rather than widening this to
  // "/api/support" — that prefix would also expose /api/support/tickets, which
  // is session-gated and reads other people's conversations.
  "/api/support/kb",
  "/api/support/sso", // Zendesk JWT handoff — browser flow; the route itself requires a session (redirects to /login) and 404s until configured
  "/api/hackathon", // public Build Challenge submissions
  "/api/swag", // public Swag Center redemption/order requests
  "/api/newsletter", // public newsletter subscribe / unsubscribe
  "/api/early-access", // public early-access signup (IP rate-limited)
  "/api/careers", // public talent-pipeline interest capture
  "/api/ambassadors", // public creator-program applications
  "/api/agents", // public Agent Console demo data
  "/api/payments/stripe/intent", // merchant checkout — creates a PaymentIntent
  "/api/compliance/kyc", // needed during signup, before a session exists
  "/api/compliance/authority-requests", // Sovereign Authority Gate intake portal and token disclosure
  // Scheduled jobs. NOT public: every /api/cron route calls requireCron(),
  // which demands a constant-time match against CRON_SECRET or
  // FURLPAY_CRON_SECRET and returns 503 when neither is configured. The
  // middleware has to stand aside because Vercel Cron authenticates with an
  // `Authorization: Bearer` header and carries no session cookie — without
  // this entry the cookie gate returns 401 before the route's own, stronger
  // check ever runs, and the scheduler silently never fires.
  "/api/cron",
  "/api/health", // load-balancer liveness probe — returns a constant, touches no data (IP rate-limited)
  "/api/markets", // public market data — powers the research portal's pulse strip
  "/api/insights", // public research metadata
  "/api/travel", // FurlPay Travels — public search/deals/booking demo surface
  // Viewport place discovery for the hotel map. `/hotels` is a public page
  // prefix (see PUBLIC_PAGE_PREFIXES), and the destination card's nearby-dining
  // section calls this — behind the cookie gate it answered "Unauthorized" to
  // the anonymous visitor the public map exists for.
  //
  // This is a BILLED Google Places call, so the exposure is deliberate rather
  // than incidental: the route rate-limits to 60/min per IP (tighter than the
  // middleware baseline, per AGENTS.md rule 2), refuses a viewport wider than
  // MAX_DISCOVERY_SPAN, and caps maxResults. The same billed vendor is already
  // reachable anonymously on this page through /api/travel/hotels/preview and
  // /photo, so this adds a call site rather than a new class of exposure.
  "/api/places/discover",
  "/api/chain", // public chain registry — status, gas, contracts, USDC directory
  // FURL token reference data. Publishes only what is already public on Solana
  // (mint identity, supply, authorities, concentration) plus our own published
  // tokenomics and disclosures. Behind the cookie gate it would answer
  // "Unauthorized" to exactly the people it exists for: someone checking a mint
  // address against a scam lookalike, and aggregators reading the disclosures.
  // The mint is fixed in code and both routes rate-limit, so this cannot be used
  // as an open RPC proxy.
  "/api/token",
  "/api/rails", // public payment-rail map — protocol, chains, fees, live status
  "/api/onchain", // public /onchain aggregates — IP rate-limited, one shared 60 s build per (range, chain)
  "/api/docs/feedback", // anonymous docs page feedback counters (IP rate-limited)
  "/api/transfers/gasless", // Smart Gas: GET quote is public; POST enforces its own session via requireUser
  // One-click "lock my account" link from security emails (lib/lockLink.ts).
  // Session-less BY DESIGN: it is for the victim of a takeover, who cannot sign
  // in. Auth is the HMAC over (userId, expiry) in the URL, checked in constant
  // time; the route is rate-limited and can only restrict an account. Until
  // this entry existed the middleware answered 401 to exactly that person.
  "/api/security/lock",
  "/api/payments/fees", // public fee estimator — merchants compare vs card interchange
  "/api/discord", // Discord interactions — auth IS the Ed25519 signature (401 otherwise)
  "/api/check", // public FurlPay Wallet handle availability check (IP rate-limited)
  // NOTE: /api/wallet is intentionally NOT public. /api/wallet/authorize binds a
  // handle to an account and self-gates with requireUser (returns 401 → the
  // consent UI routes to /login). The wallet/link/* routes are authenticated too.
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

/**
 * Hard ceiling on any /api/* request body, enforced before routing.
 *
 * Matches lib/validate.ts's MAX_BODY_BYTES so a request that would be refused
 * by a validated handler is refused identically by an unvalidated one. Kept as
 * its own constant rather than imported because middleware runs on the Edge and
 * must not pull in a module that reaches for Node APIs.
 */
const MAX_API_BODY_BYTES = 100 * 1024;

/**
 * Reviewed exceptions to MAX_API_BODY_BYTES, by EXACT path. Each route must
 * authenticate the body by signature and stream it with its own byte cap
 * (lib/settlement/boundedBody.ts) at no more than the limit given here.
 *
 *   /api/webhooks/allium   Allium Beam multi-record deliveries (up to 500
 *                          records, documented as 1 MB); HMAC-verified.
 */
const LARGE_BODY_ROUTES: Readonly<Record<string, number>> = {
  "/api/webhooks/allium": 1_000_000,
};

// CSRF backstop for cookie-authenticated mutating requests. SameSite=Lax on
// the session cookie is the primary defense (browsers won't attach it to
// cross-site POSTs); this Origin check catches what Lax can't — older
// browsers, subtle Lax bypasses, sandboxed-iframe (`Origin: null`) form posts.
// Scope is deliberately narrow: only requests that authenticate via the
// COOKIE are CSRF-able. Bearer clients (native app), webhooks and x402 calls
// carry no cookie and are untouched. Extension pages POST with the cookie but
// from a chrome-extension:// origin — non-http(s) schemes are allowed through
// (an installed extension with host permissions is outside the CSRF threat
// model; the browser, not the page, vouches for that origin).
export function crossSiteCookieForgery(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false; // non-browser client — no ambient cookie risk
  if (origin === "null") return true; // sandboxed iframe / opaque origin
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return true; // malformed Origin from a browser — reject
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  // The host the browser addressed. Behind CloudFront the Host header is the
  // ORIGIN hostname (the viewer's is not forwarded), so the configured public
  // origin is the reference there; elsewhere the platform-routed Host is. A
  // cross-site attacker controls neither: the victim's browser sets Host, and
  // PUBLIC_API_ORIGIN is deploy configuration.
  const configured = configuredPublicOrigin();
  const reqHost = configured ? new URL(configured).host : req.headers.get("host");
  if (!reqHost) return false;
  // Exact host match, tolerating the www/apex pair (www.furlpay.com ↔ furlpay.com).
  const strip = (h: string) => h.replace(/^www\./, "");
  return strip(parsed.host) !== strip(reqHost);
}

// Sliding web session: when the COOKIE session enters its last 15 minutes,
// re-mint it on the way through (same claims, original auth_time, fresh exp).
// A user working in the dashboard never hits the 1h cliff; an idle tab still
// expires. Bearer sessions never slide here — the native app refreshes itself
// via /api/auth/refresh, and connector (mcp) tokens must use the OAuth
// refresh grant. canRefreshSession() caps the sliding at 30 days.
const SLIDE_WINDOW_SECONDS = 15 * 60;

async function maybeSlideSession(req: NextRequest, claims: SessionClaims | null, res: NextResponse) {
  if (!claims?.exp || !sessionCookieFromRequest(req)) return res;
  if ((claims as { mcp?: boolean }).mcp === true) return res;
  if (claims.exp - Date.now() / 1000 > SLIDE_WINDOW_SECONDS) return res;
  if (!canRefreshSession(claims)) return res;
  const fresh = await signSession({
    sub: claims.sub,
    ...(claims.safe ? { safe: claims.safe } : {}),
    ...(claims.roles ? { roles: claims.roles } : {}),
    ...(claims.guest ? { guest: true } : {}),
    auth_time: claims.auth_time ?? claims.iat,
  });
  setSessionCookieForRequest(req, res, fresh);
  return res;
}

/** 403 page for a signed-in non-admin on /analytics; null when allowed or unknown. */
async function adminPageDenied(req: NextRequest): Promise<NextResponse | null> {
  // Same process, plain HTTP: on ECS the request URL is the bind address
  // behind TLS-terminating proxies, so call the local port; elsewhere the
  // platform origin is correct.
  const base = process.env.ORIGIN_VERIFY_REQUIRED === "true" ? `http://127.0.0.1:${process.env.PORT ?? "3000"}` : publicOrigin(req);
  const headers = new Headers();
  for (const h of ["cookie", "authorization", ORIGIN_VERIFY_HEADER, "user-agent"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  let status: number;
  try {
    status = (await fetch(new URL("/api/ops/analytics/access", base), { headers, cache: "no-store", signal: AbortSignal.timeout(5_000) })).status;
  } catch {
    return null; // unknown: the layout gate decides (and never renders for a non-admin)
  }
  if (status === 401) return loginRedirect(req, req.nextUrl.pathname);
  if (status !== 403) return null;
  return new NextResponse(FORBIDDEN_HTML, { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

const FORBIDDEN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Admin access required · FurlPay</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070A09;color:#fff;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}main{max-width:440px;border:1px solid rgba(255,255,255,.08);background:#0B100E;border-radius:16px;padding:32px;text-align:center}h1{font-size:22px;margin:12px 0 8px}p{color:#9aa3a0;margin:8px 0}a{color:#00E599}</style></head>
<body><main role="main"><h1>Admin access required</h1><p>This area is an internal FurlPay operations tool. Your account does not have access to it.</p><p>Looking for your own spending breakdown? <a href="/spending">Open spending insights</a></p></main></body></html>`;

export async function middleware(req: NextRequest, event?: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  if (isFrozenRoute(pathname)) {
    return featureGateResponse();
  }

  // Origin verification (lib/originVerify.ts): behind CloudFront, a request
  // without the distribution's secret header did not come through our WAF.
  // First, before any session or KV work. A no-op where nothing is declared.
  const origin = checkOrigin(pathname, req.method, req.headers.get(ORIGIN_VERIFY_HEADER));
  if (origin === "misconfigured") {
    return new NextResponse("Service unavailable", { status: 503 });
  }
  if (origin === "reject") {
    return new NextResponse("Not found", { status: 404 });
  }

  // Verify the JWT signature (edge-safe via jose), not just cookie presence.
  // Token comes from the cookie (web) or Authorization: Bearer (mobile app).
  const claims = await verifySession(tokenFromRequest(req));
  const hasSession = Boolean(claims);

  const isApi = pathname.startsWith("/api");

  // Dashboard telemetry (lib/analytics/telemetry.ts): handed to waitUntil so it
  // never delays or fails the request. Counted after origin verification, so a
  // request the origin check refused is not "API traffic".
  if (event) {
    // What counts as API traffic and as a page view: lib/analytics/telemetry.ts
    // classifyRequest (health checks, cron, admin polling, prefetches, bots and
    // assets are excluded).
    const cls = classifyRequest(req);
    if (cls.kind === "api") event.waitUntil(recordApiRequest());
    else if (cls.kind === "page") event.waitUntil(recordPageView(trustedClientIp(req), req.headers.get("user-agent") ?? ""));
    if (claims?.sub && !claims.guest) {
      const geo = recordActiveCountry(claims.sub, trustedClientCountry(req));
      if (geo) event.waitUntil(geo);
    }
  }

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

  // ── Body-size backstop ───────────────────────────────────────────────────
  //
  // THE GAP THIS CLOSES. lib/validate.ts enforces a 100KB cap and its comment
  // explains why: "JSON.parse on a huge body is the cheapest way to burn a
  // function." But the cap only applies to handlers that route through
  // validateBody(), and an audit sweep found 74 route files calling
  // `await req.json()` directly — around thirty of them classified
  // PUBLIC_INTENTIONAL, including the x402 facilitator's /verify and /settle,
  // which are unauthenticated by protocol design and move money.
  //
  // So the cap was real for most routes and absent on exactly the surface an
  // attacker reaches first. A per-route fix would be 74 edits and would be
  // incomplete again with the next route. This is the one place every /api/*
  // request must pass, so the bound belongs here.
  //
  // CONTENT-LENGTH ONLY, AND THAT IS DELIBERATE. Reading the body in middleware
  // would consume the stream the handler needs. Content-Length can be absent or
  // can lie, so this is a BACKSTOP and not a replacement: validateBody() still
  // measures the decoded text for handlers that use it, which is the check that
  // catches a chunked or mis-declared body. Together they bound the common case
  // cheaply and the adversarial case correctly.
  if (isApi && MUTATING_METHODS.has(req.method)) {
    const declared = Number(req.headers.get("content-length") ?? 0);
    const cap = Object.hasOwn(LARGE_BODY_ROUTES, pathname) ? LARGE_BODY_ROUTES[pathname] : MAX_API_BODY_BYTES;
    if (Number.isFinite(declared) && declared > cap) {
      return NextResponse.json(
        {
          error: "payload_too_large",
          message: `Request body exceeds the ${cap} byte limit.`,
        },
        { status: 413 }
      );
    }
  }

  if (
    isApi &&
    MUTATING_METHODS.has(req.method) &&
    !BASELINE_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    const rl = await limit(`api-baseline:${rateLimitIdentity(req)}`, BASELINE);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }
  }
  // CSRF backstop (see crossSiteCookieForgery): a mutating API request that
  // authenticates with the session COOKIE must come from our own origin.
  if (
    isApi &&
    MUTATING_METHODS.has(req.method) &&
    sessionCookieFromRequest(req) &&
    crossSiteCookieForgery(req)
  ) {
    return NextResponse.json({ error: "cross_origin_request_rejected" }, { status: 403 });
  }

  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (isApi) {
    const version = apiVersion && apiVersion.ok ? apiVersion.version : undefined;
    // One correlation id per request: forwarded to the route (for logs) and
    // echoed on the response (so the client/user can quote it in an incident).
    const cid = ensureCorrelationId(req.headers.get(CORRELATION_HEADER));
    const pass = () => {
      const reqHeaders = new Headers(req.headers);
      reqHeaders.set(CORRELATION_HEADER, cid);
      const r = NextResponse.next({ request: { headers: reqHeaders } });
      r.headers.set(CORRELATION_HEADER, cid);
      return version ? applyApiVersionHeaders(r, version) : r;
    };
    if (isPublicApi || hasSession) return maybeSlideSession(req, claims, await pass());
    // Agent-initiated escrow calls authenticate with RFC 9421 signatures
    // instead of a session cookie. Pass them through to the route, which
    // verifies the signature against registered agent keys and 401s any
    // invalid/unknown/tampered one (lib/agentTrustGate).
    if (pathname.startsWith("/api/escrow") && req.headers.get("signature-input")) {
      return pass();
    }
    // The /api/v1 control plane authenticates with an API KEY, which is not a
    // session JWT — so `hasSession` is false for every legitimate caller and the
    // 401 below was answering the one credential these routes exist for.
    //
    // THE BUG THIS FIXES was not a hole, it was the opposite: every route
    // classified API_KEY_AUTHENTICATED was unreachable, so `requireApiKey` —
    // the only code that checks a key's scope, revocation, expiry, environment
    // and IP allowlist — had never run. `/api/v1/payments` says in its own
    // comment that it "makes `payments:read` mean something"; it could not.
    //
    // CONDITIONAL ON A CREDENTIAL BEING PRESENTED, deliberately. `/api/v1` is
    // NOT added to PUBLIC_API_PREFIXES: an anonymous caller still gets this
    // 401 and never reaches a route. Presenting a bearer only buys the right to
    // be judged by requireApiKey, which is stricter than this gate and is
    // enforced on every v1 route as an error-severity route-manifest rule.
    if (pathname.startsWith("/api/v1") && req.headers.get("authorization")) {
      return pass();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { [CORRELATION_HEADER]: cid } });
  }

  // Page routes
  // The admin dashboard's old address: a real redirect, before any rendering.
  if (pathname === "/ops/analytics") {
    return NextResponse.redirect(new URL(`/analytics${req.nextUrl.search}`, publicOrigin(req)), 308);
  }
  // /analytics answers a REAL 403 to a signed-in non-admin. The page cannot:
  // the root loading.tsx streams the shell (and its 200) before the segment's
  // layout runs. The layout gate stays as the second line (it never renders
  // the dashboard for a non-admin even if this check is unavailable).
  if (hasSession && (pathname === "/analytics" || pathname.startsWith("/analytics/"))) {
    const denied = await adminPageDenied(req);
    if (denied) return denied;
  }
  const isPublicPage =
    PUBLIC_PAGES.has(pathname) || PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
  if (isPublicPage || hasSession) return maybeSlideSession(req, claims, NextResponse.next());

  return loginRedirect(req, pathname);
}

export const config = {
  // Run on app pages + API; skip Next internals and any static asset with a
  // file extension (images, og.png, svgo logos, fonts) so crawlers and social
  // scrapers fetch them directly without hitting the auth redirect.
  matcher: [
    // `mjs` is in the list because of the MapLibre tile worker in public/.
    // Static files under public/ still pass through middleware when the matcher
    // admits them, and a worker script that comes back as a redirect or an HTML
    // shell fails in the least legible way available: the map renders, the
    // controls work, and nothing ever paints.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf|json|xml|txt|mp4|webm|mov|mp3|m4a|mjs)).*)",
  ],
};
