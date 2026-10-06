import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { parseRange } from "@/lib/analytics/range";
import { onchainCached, parseChain } from "@/lib/onchain/dashboard";

export const dynamic = "force-dynamic";

const PUBLIC_RANGES = new Set(["24h", "7d", "30d", "90d"]);

// GET /api/onchain?range=24h|7d|30d|90d&chain=all|<chain> — PUBLIC.
// Backs the public /onchain dashboard. Aggregates only: no user ids leave the
// server, addresses and hashes are truncated, security events are counts.
// Every caller shares one cached build per (range, chain) for 60 s, so public
// traffic costs at most one ledger read per key per minute, even when the
// per-IP limiter cannot reach its store.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const raw = req.nextUrl.searchParams.get("range") ?? "30d";
  if (!PUBLIC_RANGES.has(raw)) return NextResponse.json({ ok: false, error: { code: "invalid_range", message: "range must be one of 24h, 7d, 30d, 90d" } }, { status: 400 });
  const range = parseRange(new URLSearchParams({ range: raw }));
  if (!range.ok) return NextResponse.json({ ok: false, error: { code: "invalid_range", message: range.error } }, { status: 400 });
  const chain = parseChain(req.nextUrl.searchParams.get("chain"));
  if (!chain) return NextResponse.json({ ok: false, error: { code: "invalid_chain", message: "unknown chain" } }, { status: 400 });

  const data = await onchainCached(range.range, chain);
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=60" } });
}
