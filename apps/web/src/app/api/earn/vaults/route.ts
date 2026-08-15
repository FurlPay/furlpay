import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { fetchMorphoVaults, earnIsLive } from "@/lib/services/morpho";

export const dynamic = "force-dynamic";

// GET /api/earn/vaults — available Morpho USDC yield vaults on Arbitrum, with
// live net APY / TVL (falls back to a deterministic list if the API is down).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "earn.vaults", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const vaults = await fetchMorphoVaults();
  return NextResponse.json({ live: earnIsLive(), chainId: 42161, asset: "USDC", vaults });
}
