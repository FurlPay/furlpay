// ---------------------------------------------------------------------------
// Tiered (risk-based) KYC. Low-value activity stays low-friction; larger or
// higher-risk actions require stronger verification. This is the pattern used
// across 2026 crypto platforms to cut onboarding drop-off (30-50% is lost at
// KYC) while staying compliant.
// ---------------------------------------------------------------------------

export type KycTier = 0 | 1 | 2 | 3;

export interface TierSpec {
  tier: KycTier;
  name: string;
  requires: string[];
  dailyUsd: number;
  monthlyUsd: number;
  features: string[];
}

export const TIERS: Record<KycTier, TierSpec> = {
  0: {
    tier: 0,
    name: "Unverified",
    requires: [],
    dailyUsd: 1000,
    monthlyUsd: 3000,
    features: ["receive", "hold"],
  },
  1: {
    tier: 1,
    name: "Basic",
    requires: ["email", "phone"],
    dailyUsd: 10000,
    monthlyUsd: 50000,
    features: ["receive", "hold", "card", "transfer"],
  },
  2: {
    tier: 2,
    name: "Standard",
    requires: ["email", "phone", "government_id", "selfie"],
    dailyUsd: 100000,
    monthlyUsd: 1000000,
    features: ["receive", "hold", "card", "transfer", "invest", "offramp"],
  },
  3: {
    tier: 3,
    name: "Enhanced",
    requires: ["email", "phone", "government_id", "selfie", "proof_of_address", "source_of_funds"],
    dailyUsd: 1000000,
    monthlyUsd: 20000000,
    features: ["receive", "hold", "card", "transfer", "invest", "offramp", "high_value", "business"],
  },
};

/** Minimum tier required to move a given amount within daily limits. */
export function requiredTierForAmount(amountUsd: number): KycTier {
  if (amountUsd <= TIERS[0].dailyUsd) return 0;
  if (amountUsd <= TIERS[1].dailyUsd) return 1;
  if (amountUsd <= TIERS[2].dailyUsd) return 2;
  return 3;
}

export interface TierGate {
  allowed: boolean;
  currentTier: KycTier;
  requiredTier: KycTier;
  reason: string;
  upgradeRequires: string[];
}

/** Gate an action by the user's current tier + amount + feature access. */
export function gateByTier(currentTier: KycTier, amountUsd: number, feature?: string): TierGate {
  const requiredTier = requiredTierForAmount(amountUsd);
  const tierOk = currentTier >= requiredTier;
  const featureOk = !feature || TIERS[currentTier].features.includes(feature);
  const allowed = tierOk && featureOk;

  let reason = "Within tier limits";
  if (!tierOk) reason = `Amount requires Tier ${requiredTier} (${TIERS[requiredTier].name}); you are Tier ${currentTier}`;
  else if (!featureOk) reason = `Feature "${feature}" requires a higher tier`;

  const upgradeTarget = Math.max(requiredTier, currentTier + (featureOk ? 0 : 1)) as KycTier;
  const upgradeRequires = allowed
    ? []
    : TIERS[upgradeTarget].requires.filter((r) => !TIERS[currentTier].requires.includes(r));

  return { allowed, currentTier, requiredTier, reason, upgradeRequires };
}
