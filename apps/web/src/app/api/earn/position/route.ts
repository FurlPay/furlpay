import { NextResponse } from "next/server";
import { earnSummary } from "@/lib/services/earn";
import { earnIsLive } from "@/lib/services/morpho";

export const dynamic = "force-dynamic";

// GET /api/earn/position — the user's Earn positions (principal, current value,
// yield earned), valued on-chain in live mode, plus a blended summary.
export async function GET() {
  const { positions, summary } = await earnSummary();
  return NextResponse.json({ live: earnIsLive(), positions, summary });
}
