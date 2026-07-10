import type { User } from "./store";

// ---------------------------------------------------------------------------
// KYC-tier account limits (Securitize progressive-access pattern). The user
// record already carries kycTier (0–3) and kycStatus; this maps a tier to the
// account-level money-movement caps and feature gates that go with it, so
// higher limits/features unlock as a user completes more verification.
//
// This is distinct from per-CARD limits (policyEngine: perPurchase / daily /
// velocity) and from per-AGENT-key policy (agentPolicy). It gates the acting
// USER's own transfers/withdrawals by how verified they are.
// ---------------------------------------------------------------------------

export interface TierLimits {
  /** Hard cap on a single transfer, USD. */
  maxSingleTransferUsd: number;
  /** Rolling 24h outbound volume cap, USD. */
  maxDailyVolumeUsd: number;
  canWithdrawToExternal: boolean;
  canIssueCard: boolean;
  canEarnYield: boolean;
}

// Index by kycTier (0 = unverified … 3 = enhanced/institutional). The demo
// user is tier 2. Caps are deliberately conservative at low tiers.
export const TIER_LIMITS: Record<User["kycTier"], TierLimits> = {
  0: {
    maxSingleTransferUsd: 50,
    maxDailyVolumeUsd: 200,
    canWithdrawToExternal: false,
    canIssueCard: false,
    canEarnYield: false,
  },
  1: {
    maxSingleTransferUsd: 1_000,
    maxDailyVolumeUsd: 5_000,
    canWithdrawToExternal: true,
    canIssueCard: false,
    canEarnYield: false,
  },
  2: {
    maxSingleTransferUsd: 10_000,
    maxDailyVolumeUsd: 50_000,
    canWithdrawToExternal: true,
    canIssueCard: true,
    canEarnYield: true,
  },
  3: {
    maxSingleTransferUsd: 100_000,
    maxDailyVolumeUsd: 500_000,
    canWithdrawToExternal: true,
    canIssueCard: true,
    canEarnYield: true,
  },
};

export function tierLimits(tier: User["kycTier"]): TierLimits {
  return TIER_LIMITS[tier] ?? TIER_LIMITS[0];
}

export type TierCheck = { allowed: true } | { allowed: false; reason: string; code: string };

/** Gate a single transfer amount against the user's tier cap (per-tx only —
 *  daily volume is enforced by the velocity service). */
export function checkTransferAmount(tier: User["kycTier"], amountUsd: number): TierCheck {
  const limits = tierLimits(tier);
  if (amountUsd > limits.maxSingleTransferUsd) {
    return {
      allowed: false,
      code: "kyc_tier_limit_exceeded",
      reason: `Amount exceeds your tier limit of $${limits.maxSingleTransferUsd.toLocaleString()} per transfer. Verify your identity to raise it.`,
    };
  }
  return { allowed: true };
}

/** Gate a tier-gated feature (external withdrawal, card issuance, yield). */
export function checkFeature(
  tier: User["kycTier"],
  feature: "canWithdrawToExternal" | "canIssueCard" | "canEarnYield"
): TierCheck {
  if (tierLimits(tier)[feature]) return { allowed: true };
  return {
    allowed: false,
    code: "kyc_tier_feature_locked",
    reason: "This feature requires a higher verification tier. Complete KYC to unlock it.",
  };
}
