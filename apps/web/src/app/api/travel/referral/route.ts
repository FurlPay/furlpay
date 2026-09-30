import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { capabilityMode, capabilityUnavailable } from "@/lib/capabilityGate";
import { referralStats } from "@/lib/travel/referrals";

export const dynamic = "force-dynamic";

// GET /api/travel/referral — the user's referral link + stats.
//
// NOT LIVE. referralStats() is one process-global counter (a single code and
// "$300 earned") shared by every caller, and this route served it without a
// session. It now requires one and is gated on REWARDS_LIVE, which cannot turn
// on until a per-user referral ledger exists: 503 in production, the fixture
// marked `simulated: true` elsewhere.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const mode = capabilityMode("REWARDS_LIVE");
  if (mode === null) return capabilityUnavailable("REWARDS_LIVE", "Travel referrals");

  const limited = await rateLimitOr429(req, "travel.referral", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  return NextResponse.json({ ...referralStats(), simulated: mode === "simulated" });
}
