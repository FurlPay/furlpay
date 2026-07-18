import { NextRequest, NextResponse } from "next/server";
import { verifyIdentity } from "@furlpay/compliance";
import { rateLimitOr429 } from "@/lib/rateLimit";

// POST /api/compliance/kyc — Persona/Sumsub identity verification.
// body: { fullName, dateOfBirth, documentNumber, selfieProvided?, provider? }
export async function POST(req: NextRequest) {
  // Public by necessity (runs during signup, before a session exists) and it
  // submits identity data to a KYC provider — bill-per-call, so rate-limit it
  // well below the middleware baseline.
  const limited = await rateLimitOr429(req, "compliance.kyc", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

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
