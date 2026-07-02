import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

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
  "/login",
  "/signup",
  "/actions.json",
  "/sitemap.xml", // SEO — must be crawlable
  "/robots.txt",
]);
const PUBLIC_PAGE_PREFIXES = [
  "/docs",
  "/blog",
  "/legal",
  "/compare", // SEO comparison pages (public)
  "/pay", // shareable Solana Blink checkout links (unauthenticated by design)
];
const PUBLIC_API_PREFIXES = [
  "/api/auth",
  "/api/webhooks",
  "/api/checkout",
  "/api/actions", // Solana Actions/Blinks — consumed by unauthenticated Blink clients
  "/api/x402", // agentic pay-per-call APIs — auth IS the payment (HTTP 402)
  "/api/contact", // public "Talk to us" lead capture
  "/api/payments/stripe/intent", // merchant checkout — creates a PaymentIntent
  "/api/compliance/kyc", // needed during signup, before a session exists
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Verify the JWT signature (edge-safe via jose), not just cookie presence.
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const hasSession = Boolean(claims);

  const isApi = pathname.startsWith("/api");
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (isApi) {
    if (isPublicApi || hasSession) return NextResponse.next();
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
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|svg|jpg|jpeg|webp|gif|ico|woff2?|ttf|json|xml|txt)).*)",
  ],
};
