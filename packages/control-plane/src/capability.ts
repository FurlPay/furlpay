// ---------------------------------------------------------------------------
// Rail capability negotiation, and the production-access gate.
//
// THIS FILE EXISTS TO STOP ONE SPECIFIC LIE. An architecture diagram with a box
// labelled "Visa" is a claim, and it is a claim that costs nothing to draw and
// everything to be wrong about. Three different statements get collapsed into
// that one box:
//
//     "the adapter is written"          — code exists in this repository
//     "the provider offers this"        — their public documentation says so
//     "we are permitted to do it live"  — a commercial agreement covers us
//
// Only the third lets money move. apps/web/src/lib/providers/capability.ts
// already draws exactly this distinction for on-ramp/off-ramp/banking providers
// and deliberately ships an EMPTY matrix, because there is no signed rail to
// declare. This module is the same discipline applied to RAILS, and it is a
// deliberate extension of that existing model rather than a parallel one.
//
// THE RULE: `selectableForLive()` requires `access: "live"`. A rail can be
// registered, discovered, capability-matched, quoted in sandbox, rendered in an
// ops console, and returned by /api/v1/routes/quote with an explicit
// `sandbox_only` marker — and can never be chosen for a real payment. There is
// no flag, no env var and no override that promotes a rail to live without a
// row here saying it is.
//
// VERIFICATION PROVENANCE IS RECORDED PER ROW. `verifiedBy` is not commentary;
// it is the difference between "Cloudflare's docs describe a facilitator role"
// and "we have settled a transaction through it". A row whose only evidence is
// documentation must never read as an integration, so the type makes the
// provenance mandatory and the audit renders it verbatim.
// ---------------------------------------------------------------------------

import type { Finality, RailKind } from "./rails";
import { mustParseAtomic, type Atomic } from "./units";

/**
 * How far this rail is from being usable for a real payment.
 *
 * Ordered from least to most access. The ordering is load-bearing:
 * `selectableForLive` compares against `"live"` exactly, and nothing else.
 */
export type RailAccess =
  /** No adapter. Declared so the gap is visible rather than absent. */
  | "not_implemented"
  /** Adapter and interface exist; no provider connectivity of any kind. */
  | "interface_only"
  /** Works against the provider's sandbox/testnet. Never real value. */
  | "sandbox"
  /** Provider access needs a commercial agreement we do not have. */
  | "partner_required"
  /** Blocked on a licence, registration, or regulatory permission. */
  | "regulatory_required"
  /** Agreement signed, credentials not yet provisioned or not yet proven. */
  | "signed_pending_credentials"
  /** Signed, credentialed, and a real end-to-end payment has been observed. */
  | "live";

/** What evidence backs the claims in a capability row. */
export type VerificationSource =
  /** Read in the provider's own current public documentation. */
  | "official_docs"
  /** Exercised against the provider's sandbox by us. */
  | "sandbox_exercised"
  /** Proven by code and tests in this repository. */
  | "furlpay_code"
  /** A real transaction was observed end to end. */
  | "production_observed"
  /** Asserted by nobody. Present so an unverified row cannot look verified. */
  | "unverified";

export interface RailCapabilityRow {
  readonly railId: string;
  readonly kind: RailKind;
  readonly displayName: string;
  /** Who owns the rail. FurlPay owns none of them; it orchestrates them. */
  readonly owner: string;
  readonly access: RailAccess;
  readonly verifiedBy: readonly VerificationSource[];
  /** URL backing `official_docs`. Required when that source is claimed. */
  readonly evidenceUrl?: string;

  readonly assets: readonly string[];
  readonly networks: readonly string[];
  /** ISO-3166 alpha-2. Empty = the rail states no restriction. */
  readonly countries: readonly string[];
  readonly currencies: readonly string[];
  readonly finality: Finality;
  readonly minAmountAtomic: Atomic;
  readonly maxAmountAtomic: Atomic;

  /** True when the rail natively carries an agent identity/authorization. */
  readonly agentSupport: boolean;
  /** Env var names that must be present before this rail can go live. */
  readonly requiredCredentials: readonly string[];
  /** One line naming what is actually missing. Shown to operators verbatim. */
  readonly blocker?: string;
  /** What FurlPay cannot abstract about this rail, stated rather than hidden. */
  readonly notAbstractable?: readonly string[];
}

/**
 * Whether a row may be chosen for a payment that moves real value.
 *
 * Exactly one access level qualifies. Written as an equality rather than a
 * "not in this deny-list" so that adding a new RailAccess variant defaults to
 * NOT live — a new state must be deliberately promoted, never inherited.
 */
export function selectableForLive(row: RailCapabilityRow): boolean {
  return row.access === "live";
}

/** Whether a row may be exercised in sandbox. */
export function selectableForSandbox(row: RailCapabilityRow): boolean {
  return (
    row.access === "sandbox" ||
    row.access === "signed_pending_credentials" ||
    row.access === "live"
  );
}

export type CapabilityDenial =
  | "rail_unknown"
  | "not_selectable_in_environment"
  | "asset_unsupported"
  | "network_unsupported"
  | "currency_unsupported"
  | "country_unsupported"
  | "below_minimum"
  | "above_maximum"
  | "agent_support_required"
  | "credentials_missing";

export interface CapabilityQuery {
  readonly railId: string;
  readonly asset: string;
  readonly networkId: string;
  readonly currency: string;
  readonly amountAtomic: Atomic;
  readonly destinationCountry?: string;
  /** True when the payment is agent-initiated and needs native agent support. */
  readonly requiresAgentSupport?: boolean;
  /** "live" applies the production gate; "sandbox" applies the sandbox gate. */
  readonly environment: "live" | "sandbox";
  /** Env var names observed as present in this deployment. */
  readonly presentCredentials: readonly string[];
}

export type CapabilityDecision =
  | { readonly eligible: true; readonly row: RailCapabilityRow }
  | {
      readonly eligible: false;
      readonly reason: CapabilityDenial;
      readonly detail: string;
      readonly row?: RailCapabilityRow;
    };

/**
 * Decide whether one rail can carry one payment. Pure.
 *
 * ENVIRONMENT IS CHECKED SECOND, BEFORE ANY CAPABILITY MATCHING. A rail that
 * cannot be used at all should not produce "asset_unsupported" as its reason —
 * that reason invites a caller to retry with a different asset, on a rail they
 * were never going to be allowed to use.
 */
export function evaluateRailCapability(
  rows: readonly RailCapabilityRow[],
  q: CapabilityQuery
): CapabilityDecision {
  const row = rows.find((r) => r.railId === q.railId);
  if (!row) {
    return { eligible: false, reason: "rail_unknown", detail: `no capability row for rail "${q.railId}"` };
  }

  const permitted = q.environment === "live" ? selectableForLive(row) : selectableForSandbox(row);
  if (!permitted) {
    return {
      eligible: false,
      reason: "not_selectable_in_environment",
      detail:
        `${row.displayName} has access "${row.access}" and cannot be selected in ${q.environment}` +
        (row.blocker ? `: ${row.blocker}` : ""),
      row,
    };
  }

  if (!row.assets.map((a) => a.toUpperCase()).includes(q.asset.toUpperCase())) {
    return { eligible: false, reason: "asset_unsupported", detail: `${row.displayName} does not carry ${q.asset}`, row };
  }
  if (!row.networks.includes(q.networkId)) {
    return { eligible: false, reason: "network_unsupported", detail: `${row.displayName} does not deliver on ${q.networkId}`, row };
  }
  if (!row.currencies.map((x) => x.toUpperCase()).includes(q.currency.toUpperCase())) {
    return { eligible: false, reason: "currency_unsupported", detail: `${row.displayName} does not settle ${q.currency}`, row };
  }
  if (q.destinationCountry && row.countries.length > 0 && !row.countries.includes(q.destinationCountry)) {
    return { eligible: false, reason: "country_unsupported", detail: `${row.displayName} does not serve ${q.destinationCountry}`, row };
  }

  const amount = mustParseAtomic(q.amountAtomic, "amountAtomic");
  if (amount < mustParseAtomic(row.minAmountAtomic, "minAmountAtomic")) {
    return { eligible: false, reason: "below_minimum", detail: `amount is below ${row.displayName}'s minimum`, row };
  }
  if (amount > mustParseAtomic(row.maxAmountAtomic, "maxAmountAtomic")) {
    return { eligible: false, reason: "above_maximum", detail: `amount exceeds ${row.displayName}'s maximum`, row };
  }

  if (q.requiresAgentSupport && !row.agentSupport) {
    return {
      eligible: false,
      reason: "agent_support_required",
      detail: `${row.displayName} carries no native agent authorization and this payment requires one`,
      row,
    };
  }

  // Credentials last: a rail that is otherwise eligible and merely
  // unconfigured is an operational problem an operator can fix today, and
  // naming it precisely is more useful than a generic ineligibility.
  const missing = row.requiredCredentials.filter((name) => !q.presentCredentials.includes(name));
  if (missing.length > 0) {
    return {
      eligible: false,
      reason: "credentials_missing",
      detail: `${row.displayName} needs ${missing.join(", ")} in this deployment`,
      row,
    };
  }

  return { eligible: true, row };
}

/**
 * THE RAIL MATRIX.
 *
 * Every row's `access` and `verifiedBy` were set from the provider's own current
 * documentation or from code in this repository, and from nothing else. Where a
 * provider's public documentation describes a capability we cannot reach without
 * an agreement, the row says `partner_required` and `official_docs` — which
 * records that the capability is real and that we are not connected to it.
 *
 * `notAbstractable` is the honest half of "one API". It names, per rail, the
 * semantics a normalized interface must NOT paper over.
 */
export const RAIL_MATRIX: readonly RailCapabilityRow[] = [
  {
    railId: "x402_usdc_arbitrum",
    kind: "x402",
    displayName: "x402 / USDC on Arbitrum One",
    owner: "x402 Foundation (Linux Foundation); FurlPay operates the facilitator",
    // FurlPay's own facilitator verifies EIP-3009 signatures and settles
    // on-chain (apps/web/src/lib/x402Facilitator.ts + x402Settler.ts). Real
    // settlement additionally requires ONCHAIN_SETTLEMENT_LIVE and a KMS fee
    // payer, so the honest access level until that is observed is sandbox.
    access: "sandbox",
    verifiedBy: ["official_docs", "furlpay_code"],
    evidenceUrl: "https://developers.cloudflare.com/agents/tools/payments/x402/",
    assets: ["USDC"],
    networks: ["arbitrum_one", "arbitrum_sepolia", "base"],
    countries: [],
    currencies: ["USD"],
    finality: "irreversible",
    minAmountAtomic: "1",
    maxAmountAtomic: "100000000000",
    agentSupport: true,
    requiredCredentials: ["FACILITATOR_EVM_ADDRESS", "FURLPAY_KMS_PROVIDER"],
    blocker:
      "on-chain settlement is gated by the ONCHAIN_SETTLEMENT_LIVE flag and a KMS-backed fee payer; no live settlement has been observed from this repository",
    notAbstractable: [
      "settlement is irreversible — there is no chargeback, so a wrong recipient is final",
      "the payer holds the signing key; FurlPay cannot re-authorize a payment on their behalf",
      "the facilitator sponsors gas, so a caller can impose cost on us without paying us",
    ],
  },
  {
    railId: "mpp_usdc_eip3009",
    kind: "mpp",
    displayName: "MPP (Machine Payments Protocol) / USDC EIP-3009",
    owner: "MPP / IETF draft (paymentauth.org); FurlPay implements the server side",
    access: "sandbox",
    verifiedBy: ["official_docs", "furlpay_code"],
    evidenceUrl: "https://developers.cloudflare.com/agents/tools/payments/mpp/",
    assets: ["USDC"],
    networks: ["arbitrum_one", "base"],
    countries: [],
    currencies: ["USD"],
    finality: "irreversible",
    minAmountAtomic: "1",
    maxAmountAtomic: "100000000000",
    agentSupport: true,
    requiredCredentials: ["X402_QUOTE_SECRET"],
    blocker:
      "FurlPay implements the charge intent over its own EIP-3009 settler; the session and subscription intents, and card payment methods via Stripe, are not implemented",
    notAbstractable: [
      "MPP is payment-method agnostic, so the method determines the security model — a card method is not an EIP-3009 method",
      "the receipt format is method-specific and cannot be normalized without losing what it proves",
    ],
  },
  {
    railId: "arc_usdc_transfer",
    kind: "stablecoin",
    displayName: "Arc / USDC (Circle L1)",
    owner: "Circle (chain); FurlPay operates the execution adapter",
    // INTERFACE AND ADAPTER EXIST; NOTHING HAS EXECUTED. `lib/chains/arc.ts`
    // models the chain correctly (18dp native vs 6dp ERC-20, the 10^12 scale,
    // the dual Transfer emitter) with 92 tests, and
    // `lib/chains/arcExecutionAdapter.ts` implements the RailAdapter contract.
    // But `arcSigner()` returns null, no FurlPay contract is deployed to Arc,
    // and no transfer has been submitted on any Arc network. `sandbox` is the
    // strongest honest value: the code works against a deterministic harness
    // and has never touched the chain.
    access: "sandbox",
    verifiedBy: ["official_docs", "furlpay_code"],
    evidenceUrl: "https://docs.arc.io/arc/concepts/stablecoin-native-model",
    assets: ["USDC"],
    // Arc's own network ids. Deliberately NOT aliased to the x402 vocabulary
    // ("arbitrum" vs "arbitrum_one"): two protocols, two namespaces, and a
    // silent coercion between them is how a payment authorized for one chain
    // settles on another.
    networks: ["arc", "arc_testnet"],
    countries: [],
    currencies: ["USD"],
    finality: "irreversible",
    minAmountAtomic: "1",
    maxAmountAtomic: "100000000000",
    // An agent CAN be authorized for this rail — the control plane bounds it
    // exactly as it bounds every other rail. It still cannot execute, because
    // nothing can.
    agentSupport: true,
    requiredCredentials: ["FURLPAY_KMS_PROVIDER", "ARC_RPC_URL"],
    blocker:
      "arcSigner() returns null: no KMS-backed Arc signer exists. No FurlPay contract is deployed " +
      "to Arc testnet or mainnet, and no Arc transaction has ever been submitted. The adapter " +
      "refuses to register, so /api/v1/payments/execute answers 503 rail_not_connected. " +
      "Mainnet additionally requires ARC_MAINNET_ACTIVATED=1 — see docs/arc/ARC_PRODUCTION_ACTIVATION.md",
    notAbstractable: [
      "Arc denominates gas in USDC, so the fee and the payment are the same asset. Every other " +
        "rail can treat 'what the payment cost' and 'what the payment moved' as separate " +
        "currencies; on Arc they are one, and an abstraction that hides that reports the wrong " +
        "amount to the payer",
      "USDC on Arc has two interfaces with different decimal counts (18 native, 6 ERC-20). " +
        "A generic 'transfer USDC' abstraction has no place to say which one it meant, and the " +
        "two differ by a factor of 10^12 with no error",
    ],
  },
  {
    railId: "stablecoin_cctp",
    kind: "stablecoin",
    displayName: "Circle CCTP (cross-chain USDC)",
    owner: "Circle",
    access: "sandbox",
    verifiedBy: ["furlpay_code"],
    assets: ["USDC"],
    networks: ["ethereum", "arbitrum_one", "base", "optimism", "polygon", "avalanche", "solana"],
    countries: [],
    currencies: ["USD"],
    finality: "irreversible",
    minAmountAtomic: "1000",
    maxAmountAtomic: "100000000000",
    agentSupport: false,
    requiredCredentials: ["FACILITATOR_EVM_ADDRESS"],
    blocker:
      "apps/web/src/lib/services/cctpExecution.ts exists; no live burn-and-mint has been observed from this repository",
    notAbstractable: [
      "burn-and-mint has an attestation step between the two legs — the money is genuinely nowhere for a period, and no single-leg abstraction can represent that",
    ],
  },
  {
    railId: "visa_intelligent_commerce",
    kind: "card",
    displayName: "Visa Intelligent Commerce",
    owner: "Visa",
    // Visa's developer portal states the product "is in the process of
    // development and deployment", sandbox is free, and production is
    // "Contact Visa for fees". That is partner access, not an integration.
    access: "partner_required",
    verifiedBy: ["official_docs"],
    evidenceUrl: "https://developer.visa.com/capabilities/visa-intelligent-commerce",
    assets: ["VISA_CARD"],
    networks: [],
    countries: [],
    currencies: ["USD"],
    finality: "revocable",
    minAmountAtomic: "1",
    maxAmountAtomic: "100000000",
    agentSupport: true,
    requiredCredentials: [],
    blocker:
      "Visa's own documentation marks Intelligent Commerce as in development and deployment; production access is quoted per-agreement (\"Contact Visa for fees in Production\"). FurlPay holds no Visa project credentials, so there is no adapter beyond an interface.",
    notAbstractable: [
      "the agent holds a Visa-issued tokenized credential bound to that agent — FurlPay cannot mint or hold it",
      "chargebacks and dispute rights exist here and do not exist on any stablecoin rail",
      "Trusted Agent Protocol signatures are verified MERCHANT-side, not by us",
      "capabilities are regional and gated per Visa agreement",
    ],
  },
  {
    railId: "mastercard_agent_pay",
    kind: "card",
    displayName: "Mastercard Agent Pay for Machines",
    owner: "Mastercard",
    access: "partner_required",
    verifiedBy: ["official_docs"],
    evidenceUrl:
      "https://www.mastercard.com/us/en/business/artificial-intelligence/mastercard-agent-pay.html",
    assets: ["MASTERCARD"],
    networks: [],
    countries: [],
    currencies: ["USD"],
    finality: "revocable",
    minAmountAtomic: "1",
    maxAmountAtomic: "100000000",
    agentSupport: true,
    requiredCredentials: [],
    blocker:
      "Mastercard states API specifications and developer tools for Verifiable Intent with Agent Pay \"will be available soon on Mastercard Developers\". No third-party production API is documented as available, and FurlPay holds no Mastercard credentials.",
    notAbstractable: [
      "agentic tokens are issued by Mastercard against an issuer relationship FurlPay does not have",
      "multi-rail settlement is Mastercard's own routing — running FurlPay's router underneath it would be two routers disagreeing",
      "Verifiable Intent is separable and freely implementable; the SETTLEMENT behind it is not",
    ],
  },
  {
    railId: "cloudflare_wallets",
    kind: "stablecoin",
    displayName: "Cloudflare Wallets / cloudflare.pay",
    owner: "Cloudflare",
    access: "not_implemented",
    verifiedBy: ["official_docs"],
    evidenceUrl: "https://developers.cloudflare.com/wallets/",
    assets: [],
    networks: [],
    countries: [],
    currencies: [],
    finality: "irreversible",
    minAmountAtomic: "1",
    maxAmountAtomic: "1",
    agentSupport: true,
    requiredCredentials: [],
    blocker:
      "Cloudflare's own documentation states a reserved handle \"does not yet let you send, receive, or hold funds\". No third-party API for creating or managing Account or Virtual Wallets is documented. There is nothing to integrate with yet.",
    notAbstractable: [
      "Virtual Wallet spend caps are enforced by Cloudflare, not by FurlPay — two enforcement points with no shared state",
    ],
  },
  {
    railId: "bank_ach",
    kind: "bank",
    displayName: "ACH (US bank transfer)",
    owner: "A sponsor bank / payment processor",
    access: "regulatory_required",
    verifiedBy: ["unverified"],
    assets: ["USD"],
    networks: ["ach"],
    countries: ["US"],
    currencies: ["USD"],
    finality: "revocable",
    minAmountAtomic: "1",
    maxAmountAtomic: "100000000",
    agentSupport: false,
    requiredCredentials: [],
    blocker:
      "no sponsor bank relationship, no money-transmitter licensing review completed. apps/web/src/lib/providers/capability.ts ships an empty matrix for exactly this reason.",
    notAbstractable: [
      "ACH returns arrive days later and can reverse a settled payment — a finality model no stablecoin rail has",
      "beneficiary verification (penny-drop / name match) is a precondition, not a property of the payment",
    ],
  },
];

/** Rows that could carry a real payment today. Expected to be empty until a
 *  live settlement is observed — and an empty result is the honest answer. */
export function liveRails(rows: readonly RailCapabilityRow[] = RAIL_MATRIX): readonly RailCapabilityRow[] {
  return rows.filter(selectableForLive);
}

/** Group the matrix by access level, for the ops console and the audit. */
export function accessSummary(
  rows: readonly RailCapabilityRow[] = RAIL_MATRIX
): Readonly<Record<RailAccess, readonly string[]>> {
  const empty: Record<RailAccess, string[]> = {
    not_implemented: [],
    interface_only: [],
    sandbox: [],
    partner_required: [],
    regulatory_required: [],
    signed_pending_credentials: [],
    live: [],
  };
  for (const row of rows) empty[row.access].push(row.railId);
  return empty;
}
