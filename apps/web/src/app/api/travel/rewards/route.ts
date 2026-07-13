import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { listTrips } from "@/lib/travel/store";
import { REWARD_TIERS } from "@/lib/travel/data";
import { requireUser } from "@/lib/authz";

const THRESHOLDS = [0, 500, 2000, 10000];

// GET /api/travel/rewards — the caller's reward tier, balance and progress.
// Lifetime volume is derived from their confirmed trips.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const trips = listTrips(auth.account.user.id).filter((t) => t.status === "confirmed");
  const lifetimeUsd = Math.round(trips.reduce((s, t) => s + t.amountUsd, 0) * 100) / 100;
  const earnedUsdc = Math.round(trips.reduce((s, t) => s + t.cashbackUsd, 0) * 100) / 100;

  let tierIndex = 0;
  for (let i = 0; i < THRESHOLDS.length; i++) if (lifetimeUsd >= THRESHOLDS[i]) tierIndex = i;
  const next = THRESHOLDS[tierIndex + 1];

  return NextResponse.json({
    tier: REWARD_TIERS[tierIndex].tier,
    cashbackRate: REWARD_TIERS[tierIndex].cashback,
    perks: REWARD_TIERS[tierIndex].perks,
    lifetimeUsd,
    balanceUsdc: earnedUsdc,
    nextTier: next
      ? { tier: REWARD_TIERS[tierIndex + 1].tier, atUsd: next, remainingUsd: Math.max(0, Math.round((next - lifetimeUsd) * 100) / 100) }
      : null,
    tiers: REWARD_TIERS,
    history: trips.map((t) => ({ trip: t.name, date: t.createdAt.slice(0, 10), amountUsd: t.amountUsd, cashbackUsdc: t.cashbackUsd })),
  });
}
