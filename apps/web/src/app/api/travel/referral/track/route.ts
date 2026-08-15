import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { trackReferral } from "@/lib/travel/referrals";

// POST /api/travel/referral/track — record a referral conversion.
// Body: { code, event: "signup"|"first_booking" }
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.referral.track", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });
  const result = trackReferral(code, body.event === "first_booking" ? "first_booking" : "signup");
  return NextResponse.json(result);
}
