import type { PaymentMethod, ProviderId, ProviderKind } from "./types";
import { rampEnv } from "./rampEnv";

// ---------------------------------------------------------------------------
// What a provider is ALLOWED to do, and what we have EVIDENCE that it can do.
//
// THE DISTINCTION THIS FILE IS BUILT AROUND. There are three different claims
// that get conflated, and conflating them is how an architecture diagram ends
// up asserting a banking rail that does not exist:
//
//   "the adapter is written"          — code exists
//   "the provider offers this"        — their documentation says so
//   "we are contractually permitted"  — a signed agreement covers it
//
// Only the third one lets money move. So a capability carries `contractStatus`
// and `evidenceUrl`, and `isProductionEligible()` requires a signed contract
// plus production credentials. A capability with `contractStatus: "none"` can
// be declared, discovered, quoted against in a sandbox, and shown in an ops
// console — and can never be selected for a live transaction.
//
// CAPABILITY DISCOVERY, NOT HARDCODED ASSUMPTION. The matrix is data. Adding a
// corridor is a row, not an `if`. And the row must state its evidence, so
// "does this provider do INR payouts?" is answerable by reading one table
// instead of by asking whoever set up the integration.
//
// NOTHING IS SEEDED FOR INDIA. There is no signed Indian rail, so there is no
// row asserting one. An empty matrix that says so is worth more than a
// populated one that guesses.
// ---------------------------------------------------------------------------

export type ContractStatus =
  /** No agreement. Sandbox only, forever, until this changes. */
  | "none"
  /** Talking to them. Still sandbox only. */
  | "in_discussion"
  /** Signed, but production credentials are not provisioned or not verified. */
  | "signed_pending_credentials"
  /** Signed, credentialed, and a live transaction has been observed end to end. */
  | "live";

export type CapabilityDirection = "onramp" | "offramp" | "collection" | "payout";

export interface ProviderCapability {
  readonly providerId: ProviderId;
  readonly kind: ProviderKind;
  readonly direction: CapabilityDirection;
  /** ISO-3166 alpha-2 of the CUSTOMER's country. */
  readonly country: string;
  /** ISO-4217 fiat leg. */
  readonly fiatCurrency: string;
  /** Asset ids (lib/money/money.ts) this row can deliver or accept. */
  readonly assets: readonly string[];
  readonly paymentMethods: readonly PaymentMethod[];

  readonly contractStatus: ContractStatus;
  /**
   * Whether the provider has accepted us as a VIRTUAL-DIGITAL-ASSET business.
   *
   * Its own row because it is the single most common reason an otherwise
   * perfect integration cannot go live: a payment aggregator may support the
   * country, the currency and the method, and still decline the merchant
   * category. Recorded per capability, and required for production.
   */
  readonly vdaMerchantAccepted: boolean;
  /** Link to the agreement or written confirmation. Auditors ask for this. */
  readonly evidenceUrl?: string;
  /** ISO date this row was last confirmed against the provider. */
  readonly verifiedAt?: string;

  /** Per-transaction bounds, in MINOR units of `fiatCurrency`. */
  readonly minMinor: bigint;
  readonly maxMinor: bigint;
  /** Settlement expectation, for the reconciliation clock. */
  readonly settlementWindow: "instant" | "T+0" | "T+1" | "T+2" | "T+3_or_more";
  /** Which env var names must be present before this row can be used live. */
  readonly requiredCredentials: readonly string[];
}

export interface CapabilityQuery {
  readonly kind: ProviderKind;
  readonly direction: CapabilityDirection;
  readonly country: string;
  readonly fiatCurrency: string;
  readonly assetId: string;
  readonly paymentMethod: PaymentMethod;
  readonly amountMinor: bigint;
}

/** Why a capability could not be used. Surfaced to ops, never to an attacker. */
export type IneligibilityReason =
  | "no_capability_row"
  | "contract_not_live"
  | "vda_not_accepted"
  | "missing_credentials"
  | "amount_below_minimum"
  | "amount_above_maximum";

export interface CapabilityDecision {
  readonly capability: ProviderCapability;
  readonly eligible: boolean;
  readonly reasons: readonly IneligibilityReason[];
}

/**
 * The declared matrix.
 *
 * A row is selectable only when `contractStatus` is "live" — a signed
 * agreement, production credentials, and a live transaction observed end to
 * end. Rows below that bar are declared so ops can see the corridor and why it
 * is closed (`evaluateCorridor`). A row is promoted to "live" only when:
 *   1. A signed agreement (or accepted self-serve terms) covers the corridor
 *   2. Evidence URL documents the contract or written confirmation
 *   3. Required env vars are identified
 *
 * The router evaluates this matrix per-query and rejects rows where
 * `contractStatus !== "live"` or credentials are missing.
 */
export const PROVIDER_CAPABILITIES: readonly ProviderCapability[] = [
  // ── FurlGateway = Coinbase CDP ─────────────────────────────────────────
  // NOT "live": that status means a live transaction was observed end to end,
  // and none has been. CDP Onramp is self-serve, but the owner must confirm
  // the CDP project is approved for Onramp/Offramp in these countries and
  // attach that evidence before promoting a row. evidenceUrl below is the
  // product page, not a contract.
  // US on-ramp — Coinbase-hosted checkout
  {
    providerId: "furlgateway",
    kind: "onramp",
    direction: "onramp",
    country: "US",
    fiatCurrency: "USD",
    assets: ["USDC.base", "USDC.solana", "USDC.ethereum", "USDC.arbitrum", "USDC.polygon"],
    paymentMethods: ["card", "bank_transfer", "apple_pay"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: true,
    evidenceUrl: "https://portal.cdp.coinbase.com/products/onramp",
    minMinor: 100n,            // $1.00
    maxMinor: 10_000_00n,      // $10,000.00
    settlementWindow: "instant",
    requiredCredentials: ["FURLGATEWAY_API_KEY_ID", "FURLGATEWAY_API_KEY_SECRET"],
  },
  // EU on-ramp via Coinbase
  {
    providerId: "furlgateway",
    kind: "onramp",
    direction: "onramp",
    country: "GB",
    fiatCurrency: "GBP",
    assets: ["USDC.base", "USDC.ethereum"],
    paymentMethods: ["card", "bank_transfer"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: true,
    evidenceUrl: "https://portal.cdp.coinbase.com/products/onramp",
    minMinor: 100n,            // £1.00
    maxMinor: 10_000_00n,      // £10,000.00
    settlementWindow: "instant",
    requiredCredentials: ["FURLGATEWAY_API_KEY_ID", "FURLGATEWAY_API_KEY_SECRET"],
  },
  // US off-ramp via Coinbase hosted sell
  {
    providerId: "furlgateway",
    kind: "offramp",
    direction: "offramp",
    country: "US",
    fiatCurrency: "USD",
    assets: ["USDC.base", "USDC.solana", "USDC.ethereum", "USDC.arbitrum", "USDC.polygon"],
    paymentMethods: ["bank_transfer"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: true,
    evidenceUrl: "https://portal.cdp.coinbase.com/products/onramp",
    minMinor: 100n,            // $1.00
    maxMinor: 10_000_00n,      // $10,000.00
    settlementWindow: "T+1",
    requiredCredentials: ["FURLGATEWAY_API_KEY_ID", "FURLGATEWAY_API_KEY_SECRET"],
  },

  // ── FurlBridge = Transak: IN DISCUSSION, no contract ───────────────────
  // India on-ramp — UPI/IMPS
  {
    providerId: "furlbridge",
    kind: "onramp",
    direction: "onramp",
    country: "IN",
    fiatCurrency: "INR",
    assets: ["USDC.solana", "USDC.base"],
    paymentMethods: ["upi", "imps"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: false, // unconfirmed until Transak accepts FurlPay as a merchant
    minMinor: 50_000n,          // ₹500
    maxMinor: 50_000_000n,      // ₹5,00,000
    settlementWindow: "instant",
    requiredCredentials: ["FURLBRIDGE_API_KEY", "FURLBRIDGE_ACCESS_TOKEN"],
  },
  // India off-ramp — IMPS/NEFT bank payout
  {
    providerId: "furlbridge",
    kind: "offramp",
    direction: "offramp",
    country: "IN",
    fiatCurrency: "INR",
    assets: ["USDC.solana", "USDC.base"],
    paymentMethods: ["imps", "neft"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: false, // unconfirmed until Transak accepts FurlPay as a merchant
    minMinor: 100_000n,         // ₹1,000
    maxMinor: 20_000_000n,      // ₹2,00,000
    settlementWindow: "T+0",
    requiredCredentials: ["FURLBRIDGE_API_KEY", "FURLBRIDGE_SECRET_KEY", "FURLBRIDGE_ACCESS_TOKEN"],
  },
  // Transak global on-ramp — card (160+ countries, representative row)
  {
    providerId: "furlbridge",
    kind: "onramp",
    direction: "onramp",
    country: "GB",
    fiatCurrency: "GBP",
    assets: ["USDC.solana", "USDC.base", "USDC.ethereum"],
    paymentMethods: ["card", "faster_payments"],
    contractStatus: "in_discussion",
    vdaMerchantAccepted: false, // unconfirmed until Transak accepts FurlPay as a merchant
    minMinor: 1_000n,           // £10
    maxMinor: 5_000_00n,        // £5,000
    settlementWindow: "instant",
    requiredCredentials: ["FURLBRIDGE_API_KEY", "FURLBRIDGE_ACCESS_TOKEN"],
  },

  // ── FurlPayout = Echo Money: NOT CONTRACTED; API scheme unverified ─────
  // India B2B off-ramp — travel supplier payouts
  {
    providerId: "furlpayout",
    kind: "offramp",
    direction: "payout",
    country: "IN",
    fiatCurrency: "INR",
    assets: ["USDC.solana"],
    paymentMethods: ["upi", "imps", "neft"],
    contractStatus: "none",
    vdaMerchantAccepted: false,
    minMinor: 100_000n,         // ₹1,000
    maxMinor: 100_000_000n,     // ₹10,00,000
    settlementWindow: "T+0",
    requiredCredentials: ["FURLPAYOUT_API_KEY", "FURLPAYOUT_API_SECRET"],
  },
  // Thailand B2B off-ramp — hotel payouts
  {
    providerId: "furlpayout",
    kind: "offramp",
    direction: "payout",
    country: "TH",
    fiatCurrency: "THB",
    assets: ["USDC.solana"],
    paymentMethods: ["bank_transfer"],
    contractStatus: "none",
    vdaMerchantAccepted: false,
    minMinor: 1_000_00n,        // ฿1,000
    maxMinor: 3_000_000_00n,    // ฿3,000,000
    settlementWindow: "T+0",
    requiredCredentials: ["FURLPAYOUT_API_KEY", "FURLPAYOUT_API_SECRET"],
  },
  // EU B2B off-ramp — SEPA payouts
  {
    providerId: "furlpayout",
    kind: "offramp",
    direction: "payout",
    country: "DE",
    fiatCurrency: "EUR",
    assets: ["USDC.solana", "USDC.base"],
    paymentMethods: ["sepa"],
    contractStatus: "none",
    vdaMerchantAccepted: false,
    minMinor: 10_00n,           // €10
    maxMinor: 100_000_00n,      // €100,000
    settlementWindow: "T+1",
    requiredCredentials: ["FURLPAYOUT_API_KEY", "FURLPAYOUT_API_SECRET"],
  },
];

/** Does the deployment actually hold every credential this row needs? */
function credentialsPresent(capability: ProviderCapability): boolean {
  return capability.requiredCredentials.every(
    (name) => (rampEnv(name) ?? "").length > 0
  );
}

/**
 * Evaluate one capability against a query.
 *
 * Returns every failing reason rather than the first, because an operator
 * fixing a corridor needs the whole list — finding out about the missing
 * credential only after signing the contract is a wasted week.
 */
export function evaluateCapability(
  capability: ProviderCapability,
  query: CapabilityQuery
): CapabilityDecision {
  const reasons: IneligibilityReason[] = [];

  if (capability.contractStatus !== "live") reasons.push("contract_not_live");
  if (!capability.vdaMerchantAccepted) reasons.push("vda_not_accepted");
  if (!credentialsPresent(capability)) reasons.push("missing_credentials");
  if (query.amountMinor < capability.minMinor) reasons.push("amount_below_minimum");
  if (query.amountMinor > capability.maxMinor) reasons.push("amount_above_maximum");

  return { capability, eligible: reasons.length === 0, reasons };
}

/** Rows that match the corridor shape, before eligibility is considered. */
export function matchingCapabilities(
  query: CapabilityQuery,
  matrix: readonly ProviderCapability[] = PROVIDER_CAPABILITIES
): readonly ProviderCapability[] {
  return matrix.filter(
    (c) =>
      c.kind === query.kind &&
      c.direction === query.direction &&
      c.country.toUpperCase() === query.country.toUpperCase() &&
      c.fiatCurrency.toUpperCase() === query.fiatCurrency.toUpperCase() &&
      c.assets.includes(query.assetId) &&
      c.paymentMethods.includes(query.paymentMethod)
  );
}

/** Full decision set for a corridor — the ops answer to "why can't we do X?". */
export function evaluateCorridor(
  query: CapabilityQuery,
  matrix: readonly ProviderCapability[] = PROVIDER_CAPABILITIES
): readonly CapabilityDecision[] {
  return matchingCapabilities(query, matrix).map((c) => evaluateCapability(c, query));
}
