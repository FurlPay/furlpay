import { NextResponse } from "next/server";
import { CHAIN_REGISTRY, chainStatus } from "@/lib/services/chainRegistry";

export const dynamic = "force-dynamic";

// GET /api/chain/status — health + block height of every network Furlpay
// settles or reads on (Arbitrum One primary, Robinhood Chain for stock data).
export async function GET() {
  const statuses = await Promise.all(CHAIN_REGISTRY.map(chainStatus));
  return NextResponse.json({
    primarySettlement: "arbitrum",
    chains: statuses,
    updatedAt: new Date().toISOString(),
  });
}
