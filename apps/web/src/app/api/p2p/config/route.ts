import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { p2pConfig, P2P_QUICK_COMMENTS } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

// GET /api/p2p/config — assets, fiats, payment-method types, appeal/cancel
// reasons and the limits the routes enforce, so the client validates the same
// way the server does. Public: no account data in the response.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "p2p.config", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  return NextResponse.json({ ...p2pConfig(), quickComments: P2P_QUICK_COMMENTS });
}
