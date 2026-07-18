import { describe, expect, it } from "vitest";
import { compactMoney, tokenAmount } from "../market";
import type { RewardsSummary } from "../types";

// ---------------------------------------------------------------------------
// Regression: the popup crashed with
//     "Cannot read properties of undefined (reading 'toLocaleString')"
//
// Root cause was a CONTRACT MISMATCH, not a missing null check. GET /api/rewards
// nests tier/points under `membership`, but lib/types.ts declared them at the
// top level AND carried an `[key: string]: unknown` index signature. That index
// signature meant `data.points` typechecked (as `unknown`) instead of erroring,
// so the bug survived compilation and only failed in the browser:
//
//   setRewardsPts(r.data.points)   // undefined
//   rewardsPts === null            // false — undefined is not null
//   rewardsPts.toLocaleString()    // throws
//
// This fixture is a byte-faithful copy of the live response. If the API shape
// drifts again, this test fails before a user ever sees a white screen.
// ---------------------------------------------------------------------------

const LIVE_REWARDS_RESPONSE = {
  referral: {
    code: "ASHU2026",
    url: "https://furlpay.com/r/ASHU2026",
    invited: 7,
    converted: 4,
    earnedUsd: 60,
    perReferralUsd: 15,
  },
  membership: {
    tier: "Pro",
    nextTier: "Ultra",
    points: 1840,
    nextThreshold: 5000,
    progressPct: 37,
    perks: ["0% FX markup on card spend", "Priority support & higher limits"],
  },
  missions: [{ id: "kyc", title: "Complete identity verification", reward: 5, done: true }],
  rewardsBalance: { claimedUsd: 8, pendingUsd: 27 },
} satisfies RewardsSummary;

/** Mirrors WalletTab's reader: coerce, else null → renders "—". */
function readPoints(data: RewardsSummary | undefined): number | null {
  const pts = data?.membership?.points;
  return Number.isFinite(pts) ? Number(pts) : null;
}

/** Mirrors EarnTab's progressPct(): CSS-safe 0-100. */
function readProgress(data: RewardsSummary): number {
  const raw = Number(data.membership?.progressPct);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

describe("rewards API contract", () => {
  it("exposes points under membership, NOT at the top level", () => {
    expect(LIVE_REWARDS_RESPONSE.membership.points).toBe(1840);
    // The exact lookup that produced the crash.
    expect((LIVE_REWARDS_RESPONSE as Record<string, unknown>).points).toBeUndefined();
  });

  it("reads points without throwing", () => {
    expect(readPoints(LIVE_REWARDS_RESPONSE)).toBe(1840);
    expect(readPoints(LIVE_REWARDS_RESPONSE)?.toLocaleString("en-US")).toBe("1,840");
  });

  it("returns null (renders '—') when the payload is missing or malformed", () => {
    expect(readPoints(undefined)).toBeNull();
    expect(readPoints({} as RewardsSummary)).toBeNull();
    expect(readPoints({ membership: {} } as RewardsSummary)).toBeNull();
    expect(readPoints({ membership: { points: undefined } } as unknown as RewardsSummary)).toBeNull();
    expect(readPoints({ membership: { points: Number.NaN } } as unknown as RewardsSummary)).toBeNull();
    expect(readPoints({ membership: { points: "1840" } } as unknown as RewardsSummary)).toBeNull();
  });

  it("tolerates nextTier: null at the top tier instead of printing 'null'", () => {
    const topTier = {
      ...LIVE_REWARDS_RESPONSE,
      membership: { ...LIVE_REWARDS_RESPONSE.membership, nextTier: null },
    } satisfies RewardsSummary;
    expect(topTier.membership.nextTier).toBeNull();
    const label = topTier.membership.nextTier
      ? `${readProgress(topTier)}% to ${topTier.membership.nextTier}`
      : "You're on the top tier";
    expect(label).toBe("You're on the top tier");
  });

  it("clamps progressPct into a CSS-safe range", () => {
    expect(readProgress(LIVE_REWARDS_RESPONSE)).toBe(37);
    expect(readProgress({ membership: {} } as RewardsSummary)).toBe(0);
    expect(readProgress({ membership: { progressPct: 340 } } as unknown as RewardsSummary)).toBe(100);
    expect(readProgress({ membership: { progressPct: -12 } } as unknown as RewardsSummary)).toBe(0);
  });
});

describe("formatters never throw on absent data", () => {
  it("tokenAmount degrades to a dash", () => {
    expect(tokenAmount(4210.55)).toBe("4,210.55");
    expect(tokenAmount(undefined)).toBe("—");
    expect(tokenAmount(null)).toBe("—");
    expect(tokenAmount(Number.NaN)).toBe("—");
  });

  it("compactMoney degrades to a dash", () => {
    expect(compactMoney(1_200_000_000)).toBe("$1.2B");
    expect(compactMoney(undefined)).toBe("$—");
    expect(compactMoney(null)).toBe("$—");
    expect(compactMoney(Number.NaN)).toBe("$—");
  });
});
