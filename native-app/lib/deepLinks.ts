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
]);

/**
 * Resolve an incoming deep-link path/URL to a real native route.
 * Pure and dependency-free so it is unit-testable and shared by the FCM tap
 * router (lib/push.ts) and any future link handler.
 */
export function resolveDeepLink(rawPath: string | undefined | null): string {
  if (!rawPath || typeof rawPath !== "string") return HOME_ROUTE;

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

  if (KNOWN_ROUTES.has(p)) return p;

  // Known prefix families → their top screen (e.g. /travel/bookings/xyz).
  if (p.startsWith("/travel")) return "/travel";
  if (p.startsWith("/wallet")) return "/wallet";
  if (p.startsWith("/cards")) return "/(tabs)/cards";
  if (p.startsWith("/market")) return "/markets";

  // Known-shaped but unmappable → the inbox, never an unmatched route.
  return FALLBACK_ROUTE;
}
