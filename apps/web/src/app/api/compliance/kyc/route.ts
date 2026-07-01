import { NextRequest, NextResponse } from "next/server";
import { verifyIdentity } from "@furlpay/compliance";

// POST /api/compliance/kyc — Persona/Sumsub identity verification.
// body: { fullName, dateOfBirth, documentNumber, selfieProvided?, provider? }
export async function POST(req: NextRequest) {
  const input = await req.json();
  if (!input.fullName || !input.dateOfBirth || !input.documentNumber) {
    return NextResponse.json(
      { error: "fullName, dateOfBirth, documentNumber required" },
      { status: 400 }
    );
  }
  const result = verifyIdentity(input);
  return NextResponse.json({ result });
}
