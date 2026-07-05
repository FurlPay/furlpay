import { NextResponse } from "next/server";
import { CHAIN_REGISTRY } from "@/lib/services/chainRegistry";

// GET /api/chain/usdc/supply — canonical USDC deployments per chain (native
// vs bridged). Reference data for wallets and merchant integrations; live
// totalSupply reads can be layered in via the same registry later.
export function GET() {
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
