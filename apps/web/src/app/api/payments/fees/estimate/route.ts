import { NextRequest, NextResponse } from "next/server";
import { estimateFees } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// GET /api/payments/fees/estimate?amount=150&sourceChain=base — public fee
// quote: Furlpay's 0.5% + Arbitrum gas, side by side with the 3.5% card
// interchange it replaces.
export async function GET(req: NextRequest) {
  const amount = Number(req.nextUrl.searchParams.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }
  const sourceChain = req.nextUrl.searchParams.get("sourceChain") || "arbitrum";
  return NextResponse.json(await estimateFees(amount, sourceChain));
}
