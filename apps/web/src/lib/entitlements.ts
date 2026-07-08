import type { User } from "@/lib/store";

// ---------------------------------------------------------------------------
// Subscription entitlements — single source of truth for what each tier
// unlocks (extension popup, site pricing page, and API gating all read this).
// Tiers map to the extension playbook plans: Standard=Free, Pro=$9.99/mo,
// Ultra=Developer $29.99/mo.
// ---------------------------------------------------------------------------

export type Tier = User["tier"]; // "Standard" | "Pro" | "Ultra"

export const PLAN_BY_TIER: Record<Tier, string> = {
  Standard: "free",
  Pro: "pro",
  Ultra: "developer",
};

export const TIER_BY_PLAN: Record<string, Tier> = {
  free: "Standard",
  pro: "Pro",
  developer: "Ultra",
  ultra: "Ultra",
};

const TIER_RANK: Record<Tier, number> = { Standard: 0, Pro: 1, Ultra: 2 };

/** feature key -> minimum tier that unlocks it. */
export const FEATURE_MIN_TIER: Record<string, Tier> = {
  unlimited_x402: "Pro",
  ai_travel_sidebar: "Pro",
  fee_scanner: "Pro",
  cashback_tracker: "Pro",
  priority_support: "Pro",
  x402_inspector: "Ultra",
  api_keys: "Ultra",
  webhook_logs: "Ultra",
};

export function featuresFor(tier: Tier): Record<string, boolean> {
  const rank = TIER_RANK[tier] ?? 0;
  const out: Record<string, boolean> = {};
  for (const [feature, min] of Object.entries(FEATURE_MIN_TIER)) {
    out[feature] = rank >= TIER_RANK[min];
  }
  return out;
}
