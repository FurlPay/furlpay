// ---------------------------------------------------------------------------
// Central deep-link contract for FurlPay native.
//
// Every incoming path — an FCM notification payload, an OAuth/web handoff URL
// (furlpay.com/auth/handoff), an email or website link, a 3DS approval link —
// resolves HERE to a REAL native Expo Router route, with a safe fallback so a
// link never lands on Expo Router's "Unmatched Route" screen. app/+not-found.tsx
// is the last-resort net for anything that still slips through.
//
// Every route this function can return is asserted to exist by
// lib/__tests__/deepLinks.test.ts, and that test also fails if a resolved target
// stops matching a real route file — so the backend↔app deep-link contract can't
// silently drift.
// ---------------------------------------------------------------------------

/** Signed-in landing group. */
export const HOME_ROUTE = "/(tabs)";
/** Safe fallback for a known-but-unmappable link — the inbox, not an error. */
export const FALLBACK_ROUTE = "/notifications";

// Static native screens a deep link may target directly.
const KNOWN_ROUTES = new Set<string>([
  "/approvals",
  "/transactions",
  "/travel",
  "/wallet",
  "/notifications",
  "/markets",
  "/swap",
  "/earn",
  "/bills",
  "/credit",
  "/banking",
  "/ramp",
  "/rewards",
  "/insights",
  "/chains",
  "/analytics",
  "/security",
  "/passkeys",
  "/receive",
  "/scan",
  "/chat",
  "/delete-account",
  "/contacts",
  "/walletconnect",
  "/tokens",
  "/p2p",
]);

/**
 * Resolve an incoming deep-link path/URL to a real native route.
 * Pure and dependency-free so it is unit-testable and shared by the FCM tap
 * router (lib/push.ts) and any future link handler.
 */
export function resolveDeepLink(rawPath: string | undefined | null): string {
  if (!rawPath || typeof rawPath !== "string") return HOME_ROUTE;

  // A WalletConnect pairing URI is not a path and must never be normalised
  // like one. `wc:<topic>@2?...` has no leading slash and no host: the
  // normaliser below would strip "wc:" and route to a garbage path built from
  // the topic hex.
  //
  // Returning the connected-sites screen (rather than the URI) is deliberate —
  // this function's contract is "a route", and the CALLER is responsible for
  // handing the URI itself to the pairing engine. `isPairingDeepLink` below is
  // how a caller tells the two apart before calling this.
  if (rawPath.trim().toLowerCase().startsWith("wc:")) return "/walletconnect";

  // Normalize any full URL to a leading-slash path.
  //  - http(s)://furlpay.com/auth/handoff → drop the real host → /auth/handoff
  //  - furlpay://auth/handoff (custom scheme) → the part after :// IS the path,
  //    "auth" is NOT a host → /auth/handoff
  //  - furlpay:///auth/handoff (triple slash, empty authority) → /auth/handoff
  let p = rawPath;
  const lower = p.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    const slash = p.indexOf("/", p.indexOf("://") + 3);
    p = slash >= 0 ? p.slice(slash) : "/";
  } else {
    const s = p.indexOf("://");
    if (s >= 0) p = "/" + p.slice(s + 3);
  }
  // Drop query/fragment, collapse repeated slashes, strip trailing slash.
  p = (p.split("?")[0].split("#")[0] || "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";

  // Web-only surfaces the native app cannot consume (the auth handoff sets a WEB
  // cookie; /api is server-only; /login,/pricing,/legal are web pages). Sending
  // the user home is correct — they were already in the app.
  if (
    p === "/" ||
    p.startsWith("/auth") ||
    p.startsWith("/api") ||
    p.startsWith("/login") ||
    p.startsWith("/pricing") ||
    p.startsWith("/legal")
  ) {
    return HOME_ROUTE;
  }

  // 3DS / card approvals — the highest-stakes notification target.
  if (p.startsWith("/cards/approve") || p.startsWith("/cards/3ds") || p === "/approvals") {
    return "/approvals";
  }
  // Transactions: detail (/transaction/[id]) vs list.
  if (/^\/transaction\/[^/]+$/.test(p)) return p;
  if (p.startsWith("/transaction")) return "/transactions";
  // Support: a single ticket (/support/[id]) vs inbox.
  if (/^\/support\/[^/]+$/.test(p)) return p;
  if (p.startsWith("/support")) return "/support";
  // Markets: asset detail (/market/[symbol]).
  if (/^\/market\/[^/]+$/.test(p)) return p;
  // Collections.
  if (/^\/collection\/[^/]+$/.test(p)) return p;
  // Address book: one contact (/contacts/[id]) vs the book. `/contacts/new` is
  // matched by the same pattern and is a real route, so it needs no special
  // case — but nothing deeper is, hence the single-segment anchor.
  if (/^\/contacts\/[^/]+$/.test(p)) return p;
  // Card lifecycle. Ordered AFTER the 3DS rules above, which claim
  // /cards/approve and /cards/3ds — those are approvals, not cards, and a
  // notification about one must never land on a management screen. What is left
  // is /cards/order and /cards/<id>, both real routes.
  if (/^\/cards\/[^/]+$/.test(p)) return p;

  if (KNOWN_ROUTES.has(p)) return p;

  // Known prefix families → their top screen (e.g. /travel/bookings/xyz).
  if (p.startsWith("/travel")) return "/travel";
  if (p.startsWith("/wallet")) return "/wallet";
  if (p.startsWith("/cards")) return "/(tabs)/cards";
  if (p.startsWith("/market")) return "/markets";

  // Known-shaped but unmappable → the inbox, never an unmatched route.
  return FALLBACK_ROUTE;
}

/**
 * Is this incoming link a WalletConnect pairing URI rather than a route?
 *
 * Callers must check this BEFORE resolveDeepLink, because the two need
 * different handling: a pairing URI has to reach `pairWithUri` to open a
 * session, and merely navigating to /walletconnect would show an empty
 * connected-sites list while the dApp waits forever for a pairing that was
 * never attempted.
 */
export function isPairingDeepLink(rawPath: string | undefined | null): boolean {
  return typeof rawPath === "string" && rawPath.trim().toLowerCase().startsWith("wc:");
}
