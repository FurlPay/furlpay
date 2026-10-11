import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { usdcIndexView } from "@/lib/onchain/usdcIndex/view";

export const dynamic = "force-dynamic";

// GET /api/onchain/token/usdc/metrics — PUBLIC. Ethereum USDC index state
// (migration 0036): heads, finalized cursor, lag, supply, and the 5M/1H/24H/
// 7D/30D/90D/ALL windows materialised by the indexer. One state-row read;
// never a scan of the event table. Public chain data only.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-usdc-index", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const data = await usdcIndexView();
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=10, s-maxage=15, stale-while-revalidate=0" } });
}
