import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// What a Wear OS watch token may reach (SEC-P2-004). DEFAULT DENY.
//
// The watch reads its own screens directly when the phone is out of range and
// performs exactly one write: FREEZE a card, the protective direction.
// Everything that moves money, unfreezes a card, changes security settings or
// refreshes a session goes to the phone, where a biometric is possible. The
// list is exactly the calls guardian/app/wear makes (FurlPayApi.kt), so a
// watch token that leaks is a read-only view of one account plus "freeze".
// ---------------------------------------------------------------------------

const READ_ROUTES = new Set([
  "/api/wallets",
  "/api/cards",
  "/api/transactions",
  "/api/investing/portfolio",
  "/api/travel/trips",
  "/api/travel/boarding-passes",
  "/api/travel/deals",
  "/api/markets",
  "/api/markets/bars",
  "/api/profile",
]);

/** GET /api/markets/:symbol: one ticker, read-only. */
const MARKET_SYMBOL = /^\/api\/markets\/[A-Za-z0-9.\-]{1,20}$/;

/** The single write a watch may make; the route also checks it is a freeze. */
export const WATCH_FREEZE_ROUTE = "/api/cards/settings";

export function watchAllows(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET") return READ_ROUTES.has(pathname) || MARKET_SYMBOL.test(pathname);
  return m === "POST" && pathname === WATCH_FREEZE_ROUTE;
}

export function watchDenialFor(method: string, pathname: string): NextResponse | null {
  return watchAllows(method, pathname)
    ? null
    : NextResponse.json({ error: "This endpoint is not available to the watch. Use your phone." }, { status: 403 });
}

/**
 * The only body a watch may send to /api/cards/settings: freeze one card,
 * nothing else. Unfreezing, limits, channels and currency stay phone-only.
 */
export function isWatchFreezeOnly(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body).filter((k) => body[k] !== undefined);
  return body.freeze === true && keys.every((k) => k === "cardId" || k === "freeze");
}
