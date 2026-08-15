import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { SUPPORTED_KINDS } from "@/lib/x402Facilitator";

// GET /api/x402/facilitator/supported — the (scheme, network) kinds this
// facilitator can verify and settle. Clients read this to pick a facilitator.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.facilitator.supported", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json({ kinds: SUPPORTED_KINDS });
}
