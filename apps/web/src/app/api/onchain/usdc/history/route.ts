import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { HISTORY_RANGES, usdcHistory, type HistoryRange } from "@/lib/onchain/usdcHistory";

export const dynamic = "force-dynamic";

// GET /api/onchain/usdc/history?range=1h|24h|7d|30d|90d|all — PUBLIC.
// Network-wide native USDC history from the stored index (finalized blocks
// only), aggregated server-side; per-chain coverage says exactly what the
// numbers include. Public chain data only. Shared 30 s build per range.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-usdc-history", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const range = req.nextUrl.searchParams.get("range") ?? "24h";
  if (!(HISTORY_RANGES as readonly string[]).includes(range)) {
    return NextResponse.json({ ok: false, error: { code: "invalid_range", message: `range must be one of ${HISTORY_RANGES.join(", ")}` } }, { status: 400 });
  }
  const data = await usdcHistory(range as HistoryRange);
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=15, s-maxage=30" } });
}
