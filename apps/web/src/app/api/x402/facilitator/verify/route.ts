import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { verify, type AnyFacilitatorRequest } from "@/lib/x402Facilitator";

// POST /api/x402/facilitator/verify — validate a payment payload against the
// resource server's payment requirements. Accepts x402 v1 and v2 payloads.
// Returns { isValid, payer, invalidReason }.
//
// security-scan: payload shape + signature are validated inside verify()
// (lib/x402Facilitator) against the x402 spec; an invalid payload returns
// isValid:false rather than throwing. Public by protocol design — auth IS the
// payment. Throttled by the middleware baseline (150/min/IP).
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.facilitator.verify", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  let body: AnyFacilitatorRequest;
  try {
    body = await readJsonBody(req);
  } catch {
    return NextResponse.json({ isValid: false, invalidReason: "invalid_json" }, { status: 400 });
  }
  if (!body?.paymentPayload || !body?.paymentRequirements) {
    return NextResponse.json({ isValid: false, invalidReason: "missing_fields" }, { status: 400 });
  }
  return NextResponse.json(await verify(body));
}
