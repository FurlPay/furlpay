import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { TIERS, gateByTier } from "@furlpay/compliance";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// GET /api/compliance/tier — current tier, limits, and the full tier ladder.
export async function GET(req: NextRequest) {
  const rl = await rateLimitOr429(req, "compliance.tier.get", { limit: 30, windowMs: 60_000 });
  if (rl) return rl;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const current = auth.account.user.kycTier;
  return NextResponse.json({
    currentTier: current,
    spec: TIERS[current],
    tiers: Object.values(TIERS),
  });
}

const TierCheckBody = z.object({
  amountUsd: z.number().nonnegative().max(10_000_000),
  feature: z.string().max(100).optional(),
});

// POST /api/compliance/tier — check whether an amount/feature is allowed.
export async function POST(req: NextRequest) {
  const rl = await rateLimitOr429(req, "compliance.tier.post", { limit: 20, windowMs: 60_000 });
  if (rl) return rl;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const parsed = TierCheckBody.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.errors },
      { status: 400 },
    );
  }

  const gate = gateByTier(auth.account.user.kycTier, parsed.data.amountUsd, parsed.data.feature);
  return NextResponse.json({ gate });
}
