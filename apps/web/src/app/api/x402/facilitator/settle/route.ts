import { NextRequest, NextResponse } from "next/server";
import { settle, type FacilitatorRequest } from "@/lib/x402Facilitator";

// POST /api/x402/facilitator/settle — verify then submit settlement on-chain.
// Nonces are single-use, so a replayed payment is rejected. Returns
// { success, transaction, network, payer, errorReason }.
export async function POST(req: NextRequest) {
  let body: FacilitatorRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, network: "unknown", errorReason: "invalid_json" },
      { status: 400 }
    );
  }
  if (!body?.paymentPayload || !body?.paymentRequirements) {
    return NextResponse.json(
      { success: false, network: "unknown", errorReason: "missing_fields" },
      { status: 400 }
    );
  }
  const result = await settle(body);
  return NextResponse.json(result, { status: result.success ? 200 : 402 });
}
