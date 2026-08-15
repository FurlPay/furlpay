import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { earnSummary } from "@/lib/services/earn";
import { earnIsLive } from "@/lib/services/morpho";

export const dynamic = "force-dynamic";

// GET /api/earn/position — the user's Earn positions (principal, current value,
// yield earned), valued on-chain in live mode, plus a blended summary.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "earn.position", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { positions, summary } = await earnSummary();
  return NextResponse.json({ live: earnIsLive(), positions, summary });
}
