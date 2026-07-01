import { NextRequest, NextResponse } from "next/server";
import { applyTravelRule } from "@furlpay/compliance";

// POST /api/compliance/travel-rule — FATF Travel Rule (Notabene / TRUST).
// body: { amountUsd, originator, beneficiary, provider? }
export async function POST(req: NextRequest) {
  const input = await req.json();
  const payload = applyTravelRule(input);
  return NextResponse.json({ payload });
}
