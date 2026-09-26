// ---------------------------------------------------------------------------
// PRODUCTION STATUS REGISTRY — one answer to "is this live?", for the whole
// public surface.
//
// WHY THIS EXISTS. On 19 Sep 2026 Circle rejected FurlPay's Alliance listing
// because the site advertised x402 agent payments, tokenized-stock trading and
// mobile apps that a reviewer could not exercise — and the site's own rail
// widget said "Not configured" on the same page. The claims were not invented
// out of nothing: each was written while the corresponding code was being
// built, and nobody went back when the code shipped without its production
// credentials. There was no single place that knew the difference.
//
// This module is that place. A marketing page, a docs page, a metadata string
// and an API response should all derive their wording from the SAME record, so
// a capability cannot read "live" on one page and "not configured" on another.
//
// THE RULE FOR `status`, and it is about the reader, not the repo:
//
//   live      a member of the public can do this today, on furlpay.com, with
//             no credential FurlPay has not already provisioned.
//   pending   the implementation is complete and typechecked, but production
//             configuration is missing, so the flow stops short of working.
//             `gate` MUST name what is missing.
//   internal  it works, but only for developers or operators — not a product
//             the public can use.
//   roadmap   not implemented.
//
// Code existing is NOT evidence of `live`. A flag defaulting on is NOT
// evidence of `live`. The only evidence is an observed production response,
// which is what `evidence` records and how it was obtained.
//
// DO NOT promote an entry to `live` to make a page read better. The point of
// the registry is that the page follows the product, never the reverse.
// ---------------------------------------------------------------------------

export type CapabilityStatus = "live" | "pending" | "internal" | "roadmap";

export interface CapabilityRecord {
  /** Stable key — safe to reference from tests and from the claims linter. */
  id: string;
  /** Reader-facing name. Used verbatim in badges. */
  label: string;
  status: CapabilityStatus;
  /**
   * How the status was established. A production URL and what it returned, or
   * the named configuration that is absent. Not a promise, an observation.
   */
  evidence: string;
  /** For `pending`: the specific thing that has to happen. Required. */
  gate?: string;
}

/**
 * Observed on 21 Sep 2026 against https://furlpay.com with the production
 * environment variable inventory (`vercel env ls production`) as the
 * corroborating source for every "absent" claim below.
 */
export const CAPABILITIES: readonly CapabilityRecord[] = [
  {
    id: "web",
    label: "Web platform",
    status: "live",
    evidence: "furlpay.com and its authenticated app routes serve 200 in production.",
  },
  {
    id: "passkeys",
    label: "Passkey authentication",
    status: "live",
    evidence:
      "WebAuthn registration and assertion run in production; FURLPAY_RP_ID and the session secret are configured.",
  },
  {
    id: "developer-platform",
    label: "Developer APIs, SDKs and docs",
    status: "live",
    evidence: "/developer and /docs serve in production; the SDKs are published on npm.",
  },
  {
    id: "x402-challenge",
    label: "x402 payment challenge",
    status: "live",
    evidence:
      "GET /api/x402/fx returns a real HTTP 402 with an EIP-3009 `accepts` block, USDC on Arbitrum and a live payTo address.",
  },
  {
    // Deliberately separate from "x402-settlement". These are two different
    // questions and collapsing them is what produced the original overclaim.
    // Constructing a payment — quoting the fee, issuing the 402 challenge,
    // building the transfer or bridge calldata for the user's own wallet to
    // sign — is non-custodial and needs no FurlPay signer. SETTLING on the
    // user's behalf needs a funded relayer, which production does not have.
    id: "payment-apis",
    label: "Stablecoin payment APIs",
    status: "live",
    evidence:
      "Fee quotes, the 402 challenge and non-custodial transfer/bridge calldata are served in production; the user's own wallet signs and broadcasts.",
  },
  {
    id: "relayed-settlement",
    label: "Furlpay-operated settlement",
    status: "pending",
    evidence: "/api/rails reports every Furlpay-signed rail NOT_CONFIGURED.",
    gate: "No production signer, fee payer or Arbitrum RPC endpoint is configured.",
  },
  {
    id: "x402-settlement",
    label: "x402 settlement",
    status: "pending",
    evidence: "/api/rails reports the x402 rail NOT_CONFIGURED.",
    gate: "A production facilitator signer and an Arbitrum RPC endpoint are not configured.",
  },
  {
    id: "mpp",
    label: "Machine Payments Protocol",
    status: "pending",
    evidence: "/api/rails reports the mpp rail NOT_CONFIGURED — it shares the x402 settlement engine.",
    gate: "Blocked on the same facilitator configuration as x402 settlement.",
  },
  {
    id: "agent-payments",
    label: "AI agent payments",
    status: "pending",
    evidence:
      "The MCP transport, agent keys and spend policies are live and callable, but an agent cannot complete a payment while x402 settlement is unconfigured.",
    gate: "Blocked on x402 settlement.",
  },
  {
    id: "gasless",
    label: "Gasless USDC transfers",
    status: "pending",
    evidence: "/api/rails reports the transfers rail NOT_CONFIGURED.",
    gate: "The relayer fee payer is not configured or funded in production.",
  },
  {
    id: "trading",
    label: "Stock and ETF trading",
    status: "pending",
    evidence:
      "BROKERAGE_LIVE is not enabled in production, so orders route to the internal simulator rather than a market.",
    gate: "The brokerage flag is off pending a live brokerage agreement; enabling it also requires the AI_TRADING_LIVE review.",
  },
  {
    id: "tokenized-stocks",
    label: "Tokenized equities",
    status: "roadmap",
    evidence:
      "TOKENIZED_STOCKS_LIVE requires a verified token registry that does not exist in production.",
  },
  {
    id: "market-data",
    label: "Market data and charts",
    status: "live",
    evidence: "/markets serves live quotes and charts in production without a brokerage account.",
  },
  {
    id: "travel-search",
    label: "Travel booking",
    status: "pending",
    evidence:
      'POST /api/travel/search returns source "unavailable", reason "no_live_provider" in production.',
    gate: "The production flight and stay inventory provider is on a test credential, which the code refuses to use in production.",
  },
  {
    id: "hotel-map",
    label: "Hotel discovery map",
    status: "live",
    evidence: "/hotels/map and /api/travel/hotels/map return real indexed and live-discovered properties.",
  },
  {
    id: "cards",
    label: "Card issuing",
    status: "roadmap",
    evidence: "No card issuing credential is configured in production; CARD_ISSUING_LIVE is off.",
  },
  {
    id: "banking",
    label: "Global local accounts",
    status: "roadmap",
    evidence: "BANKING_LIVE is marked unimplemented in the flag registry.",
  },
  {
    id: "mobile",
    label: "Mobile apps",
    status: "pending",
    evidence:
      "The Android and iOS clients are built, but no listing is published on Google Play or the App Store.",
    gate: "Store review and, for Android, the Play App Signing fingerprint.",
  },
  {
    id: "desktop",
    label: "Desktop app",
    status: "pending",
    evidence: "The desktop client builds from the monorepo but no signed release is distributed to users.",
    gate: "Code signing and a published release channel.",
  },
] as const;

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function capability(id: string): CapabilityRecord {
  const found = BY_ID.get(id);
  // Throwing rather than returning undefined is deliberate: a typo in a page
  // would otherwise render an empty badge, which reads as "no claim" and hides
  // the mistake. A build-time crash is the louder, better failure.
  if (!found) throw new Error(`Unknown capability id: ${id}`);
  return found;
}

/** Short badge wording. Kept here so every surface says the same three words. */
export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  live: "Live",
  pending: "In development",
  internal: "Developer preview",
  roadmap: "Planned",
};

export function isLive(id: string): boolean {
  return capability(id).status === "live";
}

/** Every capability a page may honestly describe in the present tense. */
export function liveCapabilities(): CapabilityRecord[] {
  return CAPABILITIES.filter((c) => c.status === "live");
}
