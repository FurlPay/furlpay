import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { CHAIN_REGISTRY } from "@/lib/services/chainRegistry";

// GET /api/chain/usdc/supply — canonical USDC deployments per chain (native
// vs bridged). Reference data for wallets and merchant integrations; live
// totalSupply reads can be layered in via the same registry later.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "chain.usdc.supply", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const deployments = CHAIN_REGISTRY.filter((c) => c.usdc).map((c) => ({
    chain: c.id,
    chainId: c.chainId,
    native: c.usdc!.native,
    bridged: c.usdc!.bridged ?? null,
    note:
      c.id === "arbitrum"
        ? "Native USDC (Circle-issued). USDC.e is the legacy bridged token — prefer native."
        : undefined,
  }));
  return NextResponse.json({ deployments });
}
