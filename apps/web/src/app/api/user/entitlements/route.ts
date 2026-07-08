import { NextRequest, NextResponse } from "next/server";
import { getAccount } from "@/lib/store";
import { PLAN_BY_TIER, featuresFor } from "@/lib/entitlements";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/user/entitlements — the caller's subscription tier and feature map.
// Consumed by the extension popup (plan panel + feature gating) and the site.
export async function GET(req: NextRequest) {
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const account = getAccount(claims?.sub);
  if (!account) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const tier = account.user.tier;
  return NextResponse.json({
    tier,
    plan: PLAN_BY_TIER[tier] ?? "free",
    features: featuresFor(tier),
  });
}
