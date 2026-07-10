import { NextRequest, NextResponse } from "next/server";
import { verify, type FacilitatorRequest } from "@/lib/x402Facilitator";

// POST /api/x402/facilitator/verify — validate a payment payload against the
// resource server's payment requirements. Returns { isValid, payer, invalidReason }.
export async function POST(req: NextRequest) {
  let body: FacilitatorRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ isValid: false, invalidReason: "invalid_json" }, { status: 400 });
  }
  if (!body?.paymentPayload || !body?.paymentRequirements) {
    return NextResponse.json({ isValid: false, invalidReason: "missing_fields" }, { status: 400 });
  }
  return NextResponse.json(await verify(body));
}
