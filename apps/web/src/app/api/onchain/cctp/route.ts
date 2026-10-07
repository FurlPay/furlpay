import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { cctpView } from "@/lib/onchain/cctpView";

export const dynamic = "force-dynamic";

// GET /api/onchain/cctp — PUBLIC. Circle CCTP V2 cross-chain USDC transfers
// indexed by FurlPay (finalized blocks; lib/onchain/cctp.ts): 24 h summary by
// state and route, plus the newest transfers with their verification flags.
// Public chain data only; read from the store, never an RPC scan.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-cctp", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const data = await cctpView(24);
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=10, s-maxage=20, stale-while-revalidate=0" } });
}
