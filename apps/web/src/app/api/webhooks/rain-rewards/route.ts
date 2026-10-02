import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { SIGNATURE_BLOCKER } from "@/lib/cards/rainAdapter";

export const dynamic = "force-dynamic";

// POST /api/webhooks/rain-rewards — REFUSES (501) until Rain's signature
// scheme is known.
//
// Rain's inbound webhook signature format is only in its gated documentation
// (lib/cards/rainAdapter.ts SIGNATURE_BLOCKER; the card-auth webhook refuses for
// the same reason). An earlier draft verified these events with FurlPay's OWN
// signing format and accepted a `furlpay-signature` header — a scheme Rain does
// not use, so it would have rejected every real event and accepted anything
// signed with a key only we hold. AGENTS.md rule 3: verify the provider's real
// signature or do not accept the event.
//
// 501 (not 503): this is missing implementation, not an outage, so Rain's
// retries will not mask it as a transient failure in their delivery log.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "webhook.rain_rewards", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  return NextResponse.json({ error: "not_implemented", detail: SIGNATURE_BLOCKER }, { status: 501 });
}
