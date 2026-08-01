import { TIERS, KycTier, gateByTier } from "@furlpay/compliance";
import type { User } from "./store";

export interface TierLimits {
  maxSingleTransferUsd: number;
  maxDailyVolumeUsd: number;
  canWithdrawToExternal: boolean;
  canIssueCard: boolean;
  canEarnYield: boolean;
}

export function tierLimits(tier: User["kycTier"]): TierLimits {
  const spec = TIERS[(tier ?? 0) as KycTier] ?? TIERS[0];
  return {
    maxSingleTransferUsd: spec.maxSingleTransferUsd,
    maxDailyVolumeUsd: spec.dailyUsd,
    canWithdrawToExternal: spec.features.includes("transfer"),
    canIssueCard: spec.features.includes("card"),
    canEarnYield: spec.features.includes("yield"),
  };
}

export type TierCheck = { allowed: true } | { allowed: false; reason: string; code: string };

/** Gate a single transfer amount against the user's tier cap. */
export function checkTransferAmount(tier: User["kycTier"], amountUsd: number): TierCheck {
  const gate = gateByTier((tier ?? 0) as KycTier, amountUsd);
  if (!gate.allowed) {
    return {
      allowed: false,
      code: "kyc_tier_limit_exceeded",
      reason: gate.reason,
    };
  }
  return { allowed: true };
}

/** Gate a tier-gated feature. */
export function checkFeature(
  tier: User["kycTier"],
  feature: "canWithdrawToExternal" | "canIssueCard" | "canEarnYield"
): TierCheck {
  const featureKeyMap = {
    canWithdrawToExternal: "transfer",
    canIssueCard: "card",
    canEarnYield: "yield",
  };
  const gate = gateByTier((tier ?? 0) as KycTier, 0, featureKeyMap[feature]);
  if (!gate.allowed) {
    return {
      allowed: false,
      code: "kyc_tier_feature_locked",
      reason: "This feature requires a higher verification tier. Complete KYC to unlock it.",
    };
  }
  return { allowed: true };
}
