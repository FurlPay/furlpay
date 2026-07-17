import { NextRequest, NextResponse } from "next/server";
import { PLAN_BY_TIER, featuresFor } from "@/lib/entitlements";
import { requireUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

// GET /api/user/entitlements — the caller's subscription tier and feature map.
// Consumed by the extension popup (plan panel + feature gating) and the site.
// Uses the canonical requireUser path so the deletion tombstone + account-lock
// checks apply consistently (it read the session cookie directly before).
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const tier = auth.account.user.tier;
  return NextResponse.json({
    tier,
    plan: PLAN_BY_TIER[tier] ?? "free",
    features: featuresFor(tier),
  });
}
