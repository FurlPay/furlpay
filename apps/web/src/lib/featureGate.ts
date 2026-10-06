import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Optional freeze of the consumer API surface.
//
// OFF UNLESS CONFIGURED. Turning these routes off is a product decision with
// live users on the other side of it (travel bookings, investing, P2P orders),
// so it happens only when FURLPAY_FROZEN_API_PREFIXES names the prefixes to
// freeze. A deploy that does not set it behaves exactly as before.
//
// Only prefixes from FREEZABLE_PREFIXES are honoured. A typo, or a value like
// "/api" or "/api/auth", must not be able to take down sign-in or the control
// plane, so anything outside the list is ignored rather than trusted.
// ---------------------------------------------------------------------------

export const FREEZABLE_PREFIXES = [
  "/api/investing",
  "/api/travel",
  "/api/earn",
  "/api/p2p",
  "/api/staking",
  "/api/gifts",
  "/api/membership",
  "/api/swag",
  "/api/ambassadors",
  "/api/nft",
] as const;

/** The configured, allow-listed prefixes. `raw` defaults to the env var. */
export function frozenPrefixes(raw = process.env.FURLPAY_FROZEN_API_PREFIXES): string[] {
  if (!raw) return [];
  const wanted = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = new Set<string>(FREEZABLE_PREFIXES);
  return wanted.filter((p) => allowed.has(p));
}

export function isFrozenRoute(pathname: string, prefixes = frozenPrefixes()): boolean {
  // Segment-exact: "/api/travel" freezes "/api/travel/hotels", never "/api/travelogue".
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function featureGateResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "service_paused",
      message: "This feature is temporarily unavailable.",
    },
    { status: 503, headers: { "cache-control": "no-store", "retry-after": "3600" } }
  );
}
