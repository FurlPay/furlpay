// ---------------------------------------------------------------------------
// The analytics event catalogue.
//
// WHY A CLOSED UNION RATHER THAN track(name, props). Free-form event names rot
// in a specific, expensive way: `swap_completed`, `swapCompleted` and
// `swap_complete` all get emitted by different screens over eighteen months,
// the funnel silently under-counts, and nobody notices because every individual
// call site looks correct. A union makes the third spelling a type error.
//
// PROPERTIES ARE TYPED PER EVENT for the same reason — a funnel that needs
// `chain` on every swap event cannot be repaired retroactively once six months
// of events shipped without it.
//
// WHAT MAY NEVER APPEAR HERE. No seed phrases, no private keys, no session
// tokens, no full card numbers, no raw addresses belonging to a counterparty,
// no email or phone. Amounts are allowed as buckets, not exact values: an exact
// figure plus a timestamp deanonymises a user against a public chain, and an
// analytics vendor is not a place that data belongs. `lib/analytics/index.ts`
// scrubs on the way out as a backstop, but the catalogue is the real control —
// a property that is not declared cannot be sent.
// ---------------------------------------------------------------------------

/** Coarse money bucket. Exact amounts never leave the device. */
export type AmountBucket = "under_10" | "10_100" | "100_1k" | "1k_10k" | "over_10k";

export function bucketUsd(amountUsd: number): AmountBucket {
  const v = Math.abs(amountUsd);
  if (v < 10) return "under_10";
  if (v < 100) return "10_100";
  if (v < 1_000) return "100_1k";
  if (v < 10_000) return "1k_10k";
  return "over_10k";
}

/** Terminal outcome shared by every flow that can fail. */
export type Outcome = "success" | "failure" | "cancelled" | "timeout";

export type AnalyticsEvent =
  // --- lifecycle ---
  | { name: "app_opened"; props: { source: "cold" | "warm" | "notification" | "deeplink" } }
  | { name: "screen_viewed"; props: { screen: string } }

  // --- auth ---
  | { name: "auth_started"; props: { method: "google" | "passkey" | "email" } }
  | { name: "auth_completed"; props: { method: "google" | "passkey" | "email"; outcome: Outcome } }
  | { name: "biometric_prompt"; props: { reason: string; outcome: Outcome } }

  // --- swap ---
  | { name: "swap_quote_requested"; props: { fromChain: string; toChain: string; fromToken: string; toToken: string } }
  | {
      name: "swap_quote_received";
      props: { provider: string; providerCount: number; priceImpactBps: number; latencyMs: number };
    }
  | { name: "swap_submitted"; props: { provider: string; fromChain: string; toChain: string; bucket: AmountBucket } }
  | { name: "swap_settled"; props: { provider: string; outcome: Outcome; durationMs: number; reason?: string } }

  // --- send / receive ---
  | { name: "send_submitted"; props: { chain: string; token: string; bucket: AmountBucket } }
  | { name: "send_settled"; props: { chain: string; outcome: Outcome; reason?: string } }

  // --- wallet connect ---
  | { name: "wc_pairing_started"; props: { origin: "qr" | "deeplink" | "paste" } }
  | { name: "wc_session_proposed"; props: { dappHost: string; chains: number } }
  | { name: "wc_session_decided"; props: { dappHost: string; approved: boolean } }
  | { name: "wc_request_received"; props: { dappHost: string; method: string } }
  | { name: "wc_request_decided"; props: { dappHost: string; method: string; approved: boolean; riskLevel: string } }
  | { name: "wc_session_disconnected"; props: { dappHost: string; by: "user" | "dapp" | "expiry" } }

  // --- transaction simulation ---
  | {
      name: "tx_simulated";
      props: { chain: string; riskLevel: string; findingCount: number; provider: string; latencyMs: number };
    }
  | { name: "tx_risk_overridden"; props: { chain: string; riskLevel: string } }

  // --- tokens & portfolio ---
  | { name: "custom_token_added"; props: { chain: string; source: "search" | "address" } }
  | { name: "custom_token_removed"; props: { chain: string } }
  | { name: "asset_discovery_run"; props: { chains: number; found: number; durationMs: number; failures: number } }
  | { name: "balances_hidden"; props: { hidden: boolean } }

  // --- nft ---
  | { name: "nft_gallery_viewed"; props: { chain: string; count: number } }
  | { name: "nft_transfer_submitted"; props: { chain: string; standard: string } }
  | { name: "nft_transfer_settled"; props: { chain: string; outcome: Outcome } }

  // --- staking ---
  | { name: "stake_submitted"; props: { chain: string; bucket: AmountBucket } }
  | { name: "stake_settled"; props: { chain: string; outcome: Outcome } }
  | { name: "unstake_submitted"; props: { chain: string; bucket: AmountBucket } }
  | { name: "rewards_claimed"; props: { chain: string; outcome: Outcome } }

  // --- ramps ---
  | { name: "onramp_quote_requested"; props: { fiat: string; asset: string; method: string } }
  | { name: "onramp_session_created"; props: { provider: string; fiat: string; asset: string } }
  | { name: "onramp_settled"; props: { provider: string; outcome: Outcome; reason?: string } }
  | { name: "offramp_quote_requested"; props: { fiat: string; asset: string } }
  | { name: "offramp_settled"; props: { provider: string; outcome: Outcome; reason?: string } }

  // --- p2p ---
  | { name: "p2p_ads_browsed"; props: { side: string; asset: string; fiat: string; results: number } }
  | { name: "p2p_order_created"; props: { side: string; asset: string; fiat: string; bucket: AmountBucket } }
  | { name: "p2p_order_state"; props: { state: string } }
  | { name: "p2p_appeal_opened"; props: { reason: string } }

  // --- cards ---
  | { name: "card_ordered"; props: { kind: "virtual" | "physical" } }
  | { name: "card_lifecycle"; props: { action: string; outcome: Outcome } }
  | { name: "wallet_provision_started"; props: { wallet: "google" | "apple" } }
  | { name: "wallet_provision_settled"; props: { wallet: "google" | "apple"; outcome: Outcome; reason?: string } }

  // --- kyc ---
  | { name: "kyc_started"; props: { tier: string } }
  | { name: "kyc_step"; props: { step: string; outcome: Outcome } }
  | { name: "kyc_settled"; props: { tier: string; outcome: Outcome; reason?: string } }

  // --- backup ---
  | { name: "backup_enabled"; props: { destination: string } }
  | { name: "backup_restored"; props: { outcome: Outcome; reason?: string } }

  // --- growth ---
  | { name: "referral_shared"; props: { channel: string } }
  | { name: "referral_attributed"; props: { source: string } }
  | { name: "story_viewed"; props: { storyId: string; slideIndex: number; completed: boolean } }
  | { name: "promo_banner_action"; props: { bannerId: string; action: "impression" | "tap" | "dismiss" } }
  | { name: "survey_answered"; props: { surveyId: string; completed: boolean } }
  | { name: "rating_prompt"; props: { outcome: "shown" | "suppressed" } }

  // --- security ---
  | { name: "device_integrity"; props: { rooted: boolean; emulator: boolean; debuggerAttached: boolean } }
  | { name: "security_blocked"; props: { control: string; action: string } };

export type AnalyticsEventName = AnalyticsEvent["name"];

/** Props for a given event name, so call sites can be written generically. */
export type PropsFor<N extends AnalyticsEventName> = Extract<AnalyticsEvent, { name: N }>["props"];
