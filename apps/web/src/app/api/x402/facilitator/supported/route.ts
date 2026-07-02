import { NextResponse } from "next/server";
import { SUPPORTED_KINDS } from "@/lib/x402Facilitator";

// GET /api/x402/facilitator/supported — the (scheme, network) kinds this
// facilitator can verify and settle. Clients read this to pick a facilitator.
export function GET() {
  return NextResponse.json({ kinds: SUPPORTED_KINDS });
}
