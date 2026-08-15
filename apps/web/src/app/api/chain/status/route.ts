import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { CHAIN_REGISTRY, chainStatus } from "@/lib/services/chainRegistry";

export const dynamic = "force-dynamic";

// GET /api/chain/status — health + block height of every network Furlpay
// settles or reads on (Arbitrum One primary, Robinhood Chain for stock data).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "chain.status", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const statuses = await Promise.all(CHAIN_REGISTRY.map(chainStatus));
  return NextResponse.json({
    primarySettlement: "arbitrum",
    chains: statuses,
    updatedAt: new Date().toISOString(),
  });
}
