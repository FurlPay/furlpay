import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { contractDirectory } from "@/lib/services/chainRegistry";

// GET /api/chain/contracts — the Furlpay smart-contract directory. Addresses
// resolve from env once deployed; undeployed contracts report
// "pending_deployment" so integrators never hardcode stale addresses.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "chain.contracts", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json({ contracts: contractDirectory() });
}
