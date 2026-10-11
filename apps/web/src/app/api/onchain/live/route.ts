import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { isOperator } from "@/lib/authz";
import { liveSnapshot } from "@/lib/onchain/live";

export const dynamic = "force-dynamic";

// GET /api/onchain/live — PUBLIC. The ingested chain feed, freshness and
// pipeline state for /onchain. Public callers share one redacted snapshot per
// instance every 2 s (user-wallet hashes/addresses truncated, no user ids);
// the admin gets full detail.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-live", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const full = await isOperator(req);
  const data = await liveSnapshot(full);
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": full ? "private, no-store" : "public, max-age=2, s-maxage=2" } });
}
