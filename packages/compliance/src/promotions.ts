import { PromotionPolicy, Region } from "./types";

// ---------------------------------------------------------------------------
// UK FCA Financial Promotions regime (Doc 3 §2.3).
// Geofence UK users: mandatory risk warning, 24h cooling-off for first-time
// high-risk buyers, and NO referral / refer-a-friend bonuses.
// ---------------------------------------------------------------------------

export function promotionPolicy(region: Region): PromotionPolicy {
  if (region === "UK") {
    return {
      region,
      showRiskWarning: true,
      coolingOffHours: 24,
      referralBonusAllowed: false,
      reason: "FCA Financial Promotions regime — UK restrictions enforced",
    };
  }
  return {
    region,
    showRiskWarning: region === "EEA",
    coolingOffHours: 0,
    referralBonusAllowed: true,
    reason: "Standard promotions permitted",
  };
}
