import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { capabilityMode, capabilityUnavailable } from "@/lib/capabilityGate";

export const dynamic = "force-dynamic";

// GET /api/rewards — referrals, membership tier progress, and the mission center.
//
// NOT LIVE. Every value below is a fixture: the same referral code, invite
// counts, earnings, points and "completed" missions for every user, and perks
// for a card program that does not exist. It used to be served as-is in
// production. REWARDS_LIVE (lib/flags.ts, `unimplemented`) now gates it: 503 in
// production, the fixture marked `simulated: true` elsewhere.
const TIERS = ["Standard", "Pro", "Ultra"] as const;

const MISSIONS = [
  { id: "kyc", title: "Complete identity verification", reward: 5, done: true },
  { id: "card", title: "Make your first card payment", reward: 3, done: true },
  { id: "earn", title: "Deposit into an Earn vault", reward: 8, done: false },
  { id: "refer", title: "Invite a friend who signs up", reward: 15, done: false },
  { id: "swap", title: "Complete a cross-chain swap", reward: 4, done: false },
];

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const mode = capabilityMode("REWARDS_LIVE");
  if (mode === null) return capabilityUnavailable("REWARDS_LIVE", "Rewards");

  const tier = auth.account.user.tier;
  const tierIndex = TIERS.indexOf(tier as (typeof TIERS)[number]);
  const points = 1840; // demo lifetime points
  const nextTier = TIERS[Math.min(tierIndex + 1, TIERS.length - 1)];
  const nextThreshold = [0, 1000, 5000][Math.min(tierIndex + 1, 2)];
  const progressPct = Math.min(100, Math.round((points / nextThreshold) * 100));

  const claimedRewards = MISSIONS.filter((m) => m.done).reduce((s, m) => s + m.reward, 0);
  const pendingRewards = MISSIONS.filter((m) => !m.done).reduce((s, m) => s + m.reward, 0);

  return NextResponse.json({
    simulated: mode === "simulated",
    referral: {
      code: "ASHU2026",
      url: "https://furlpay.com/r/ASHU2026",
      invited: 7,
      converted: 4,
      earnedUsd: 60,
      perReferralUsd: 15,
    },
    membership: {
      tier,
      nextTier: tier === nextTier ? null : nextTier,
      points,
      nextThreshold,
      progressPct,
      perks: [
        "0% FX markup on card spend",
        "Priority support & higher limits",
        tierIndex >= 1 ? "1.5% stablecoin cashback" : "1% stablecoin cashback",
        "Metal physical card",
      ],
    },
    missions: MISSIONS,
    rewardsBalance: { claimedUsd: claimedRewards, pendingUsd: pendingRewards },
  });
}
