import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { capabilityMode, capabilityUnavailable } from "@/lib/capabilityGate";
import { trackReferral } from "@/lib/travel/referrals";

export const dynamic = "force-dynamic";

// POST /api/travel/referral/track — record a referral conversion.
// Body: { code, event: "signup"|"first_booking" }
//
// NOT LIVE. This was an anonymous write that credited "$25 earned" to one
// process-global counter on every `first_booking` call — anyone could mint
// referral earnings with a loop. It is gated on REWARDS_LIVE (503 in
// production) and the body is now validated (AGENTS rule 1). A real version
// must attribute the conversion to a booking the server observed, not to a
// client's say-so.
const Body = z
  .object({
    code: z.string().trim().min(1).max(40),
    event: z.enum(["signup", "first_booking"]).optional(),
  })
  .strip();

export async function POST(req: NextRequest) {
  const mode = capabilityMode("REWARDS_LIVE");
  if (mode === null) return capabilityUnavailable("REWARDS_LIVE", "Referral tracking");

  const limited = await rateLimitOr429(req, "travel.referral.track", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const result = trackReferral(body.code, body.event ?? "signup");
  return NextResponse.json({ ...result, simulated: true });
}
