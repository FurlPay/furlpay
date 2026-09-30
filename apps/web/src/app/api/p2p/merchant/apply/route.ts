import { NextRequest, NextResponse } from "next/server";
import { p2pUnavailable } from "@/lib/services/p2pSettlement";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { applyAsMaker, makerEligibility, merchantProfile } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

const Apply = z.object({
  displayName: z.string().trim().min(2).max(40),
  depositUsd: z.number().positive().max(1_000_000),
});

// POST /api/p2p/merchant/apply — apply to become a certified maker.
//
// Eligibility is re-checked here rather than trusted from the client's earlier
// GET: KYC or the completed-order count can change between the two calls, and
// the certified badge is exactly what a scammer wants to hold.
export async function POST(req: NextRequest) {
  const unavailable = p2pUnavailable();
  if (unavailable) return unavailable;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const limited = await rateLimitOr429(req, "p2p.merchant.apply", { limit: 5, windowMs: 60_000 }, userId);
  if (limited) return limited;

  const body = await validateBody(req, Apply);
  if (body instanceof NextResponse) return body;

  const eligibility = makerEligibility(userId, auth.account.user.kycStatus === "verified");
  if (!eligibility.eligible) {
    return NextResponse.json({ ok: false, error: "not_eligible", eligibility }, { status: 403 });
  }

  try {
    const m = applyAsMaker(userId, body.displayName, body.depositUsd);
    return NextResponse.json(
      {
        ok: true,
        merchant: { ...merchantProfile(userId), status: m.status, depositUsd: m.depositUsd, appliedAt: m.appliedAt },
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 409 });
  }
}
