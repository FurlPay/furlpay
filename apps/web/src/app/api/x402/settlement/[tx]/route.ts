import { NextRequest, NextResponse } from "next/server";
import { getSettlement } from "@/lib/x402Facilitator";

export const dynamic = "force-dynamic";

// GET /api/x402/settlement/:tx — settlement status for an x402 payment.
// Agents poll this after a settle to confirm the on-chain leg.
export function GET(_req: NextRequest, { params }: { params: { tx: string } }) {
  const settlement = getSettlement(params.tx);
  if (!settlement) {
    return NextResponse.json({ settled: false, error: "settlement_not_found" }, { status: 404 });
  }
  return NextResponse.json({ settled: true, settlement });
}
