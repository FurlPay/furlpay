import { NextRequest, NextResponse } from "next/server";
import {
  canRefreshSession,
  SESSION_COOKIE,
  setSessionCookie,
  signSession,
  tokenFromRequest,
  verifySession,
  type SessionClaims,
} from "@/lib/session";
import { clientIp, limit } from "@/lib/rateLimit";
import {
  applyApiVersionHeaders,
  resolveApiVersion,
  SUPPORTED_API_VERSIONS,
} from "@/lib/apiVersion";
import { CORRELATION_HEADER, ensureCorrelationId } from "@/lib/correlation";

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
  "/downloads", // where every store + desktop badge on the landing page points
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
  "/support", // support center — public help content; the tickets API stays session-gated
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
  "/trips", // FurlPay Trips product page — marketing composition, no user data
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
  "/telegram", // branded Telegram links → external redirects (see next.config redirects)
  "/wallet", // FurlPay Wallet handle-reservation landing (pre-launch, public)
];
const PUBLIC_API_PREFIXES = [
  // Generated card images for the Discord price bot. Public market data drawn
  // as a PNG -- the same numbers /api/markets already serves, in a different
  // format. Readable so Discord can fall back to fetching the URL if an
  // attachment upload fails; the normal path uploads the bytes directly.
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
  // Scheduled jobs. NOT public: every /api/cron route calls requireCron(),
  // which demands a constant-time match against CRON_SECRET or
  // FURLPAY_CRON_SECRET and returns 503 when neither is configured. The
  // middleware has to stand aside because Vercel Cron authenticates with an
  // `Authorization: Bearer` header and carries no session cookie — without
  // this entry the cookie gate returns 401 before the route's own, stronger
  // check ever runs, and the scheduler silently never fires.
  "/api/cron",
  "/api/markets", // public market data — powers the research portal's pulse strip
  "/api/insights", // public research metadata
  "/api/travel", // FurlPay Travels — public search/deals/booking demo surface
  "/api/chain", // public chain registry — status, gas, contracts, USDC directory
  "/api/rails", // public payment-rail map — protocol, chains, fees, live status
  "/api/docs/feedback", // anonymous docs page feedback counters (IP rate-limited)
  "/api/transfers/gasless", // Smart Gas: GET quote is public; POST enforces its own session via requireUser
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
  const reqHost = req.headers.get("host");
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
  if (!claims?.exp || !req.cookies.get(SESSION_COOKIE)) return res;
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
  setSessionCookie(res, fresh);
  return res;
}

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
  // CSRF backstop (see crossSiteCookieForgery): a mutating API request that
  // authenticates with the session COOKIE must come from our own origin.
  if (
    isApi &&
    MUTATING_METHODS.has(req.method) &&
    req.cookies.get(SESSION_COOKIE) &&
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { [CORRELATION_HEADER]: cid } });
  }

  // Page routes
  const isPublicPage =
    PUBLIC_PAGES.has(pathname) || PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
  if (isPublicPage || hasSession) return maybeSlideSession(req, claims, NextResponse.next());

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
    // `mjs` is in the list because of the MapLibre tile worker in public/.
    // Static files under public/ still pass through middleware when the matcher
    // admits them, and a worker script that comes back as a redirect or an HTML
    // shell fails in the least legible way available: the map renders, the
    // controls work, and nothing ever paints.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf|json|xml|txt|mp4|webm|mov|mp3|m4a|mjs)).*)",
  ],
};
