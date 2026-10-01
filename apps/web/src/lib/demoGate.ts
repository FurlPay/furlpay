import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Demo-only features in production.
//
// A handful of routes still have no real data source: they generate content
// (seeded-hash restaurants, invented flight and stay prices) or keep state in a
// per-instance in-memory Map with no owner. That is acceptable in local
// development and nowhere else: in production a generated price is a price
// nobody quoted, and an ownerless global list is a privacy bug.
//
// In production these answer 503 "not_available" with the reason. A real
// provider replaces the route's body; this gate is then removed for that route.
// ---------------------------------------------------------------------------

export function demoOnlyUnavailable(feature: string, reason: string, env: Record<string, string | undefined> = process.env): NextResponse | null {
  if (env.NODE_ENV !== "production") return null;
  return NextResponse.json(
    { error: "not_available", feature, detail: `${feature} is not available yet.`, reason },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

/**
 * The same gate for routes whose every response must carry extra headers
 * (Solana Action endpoints: a Blink client reports a header-less response as a
 * CORS failure rather than showing the reason).
 */
export function demoOnlyUnavailableWithHeaders(
  headers: HeadersInit,
  feature: string,
  reason: string,
  env: Record<string, string | undefined> = process.env
): Response | null {
  const res = demoOnlyUnavailable(feature, reason, env);
  if (!res) return null;
  const merged = new Headers(headers);
  res.headers.forEach((v, k) => merged.set(k, v));
  return new Response(res.body, { status: res.status, headers: merged });
}
