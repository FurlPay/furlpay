import type { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { seriesGet } from "@/lib/onchain/usdcIndex/seriesRoute";

export const dynamic = "force-dynamic";

// GET /api/onchain/token/usdc/metrics/hourly?from=&to= — PUBLIC. Ethereum USDC
// hourly rollups from the index (migration 0036). See lib/onchain/usdcIndex/view.ts.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-usdc-index", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  return seriesGet(req, "hourly");
}
