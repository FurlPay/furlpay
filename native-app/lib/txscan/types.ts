import type { MoneyWarning } from "@/lib/warnings";

// ---------------------------------------------------------------------------
// Pre-signature transaction scanning.
//
// THE PROBLEM THIS SOLVES. A dApp hands the wallet 0x-hex calldata. The user is
// shown "Confirm transaction" and a gas estimate. Between those two facts sits
// everything that matters: whether this is a swap or an unlimited allowance to
// an address created nine minutes ago, whether the NFT leaving the wallet is
// the one being sold, whether `to` is a real contract or a lookalike address one
// character from the one the user copied. A confirmation screen that cannot
// answer those is asking for consent to something it has not described.
//
// TWO INDEPENDENT LAYERS, and the split matters:
//
//   1. LOCAL ANALYSIS (`lib/txscan/analyze.ts`) — pure, offline, always runs.
//      Decodes the calldata against known selectors, flags unlimited
//      approvals, unknown spenders, native-value-to-a-contract, and so on.
//      It cannot be unavailable, cannot leak the transaction to a third party,
//      and cannot be defeated by taking the scanning vendor offline.
//
//   2. PROVIDER SIMULATION (`lib/txscan/provider.ts`) — Blockaid or an
//      equivalent, over the network. Simulates against real chain state and
//      returns actual balance deltas. Strictly more capable and strictly less
//      available.
//
// LAYER 1 IS NEVER SKIPPED BECAUSE LAYER 2 SUCCEEDED, and layer 2 failing never
// blocks signing. Both directions are deliberate. Treating a provider "clean"
// verdict as permission to skip local checks makes the provider a single point
// of failure for wallet safety; treating a provider timeout as "unsafe, refuse"
// makes an outage at a third party into an outage of the user's own funds.
//
// PRIVACY: sending a transaction to a scanning provider tells that provider the
// user's address, counterparty and amount before it is public. That is a real
// cost, it is why the provider layer is behind its own consent-bearing setting,
// and it is why local analysis is the layer that is always on.
// ---------------------------------------------------------------------------

export type RiskLevel = "safe" | "unknown" | "caution" | "danger";

export const RISK_ORDER: Record<RiskLevel, number> = { safe: 0, unknown: 1, caution: 2, danger: 3 };

export function worstRisk(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>((worst, l) => (RISK_ORDER[l] > RISK_ORDER[worst] ? l : worst), "safe");
}

/** What kind of thing the calldata turned out to be. */
export type TxCategory =
  | "native_transfer"
  | "token_transfer"
  | "token_approval"
  | "nft_transfer"
  | "nft_approval_all"
  | "swap"
  | "contract_call"
  | "signature"
  | "unknown";

export interface AssetDelta {
  /** Positive = arriving, negative = leaving. Raw units, exact. */
  rawAmount: bigint;
  decimals: number;
  symbol: string;
  /** Contract address, or null for the chain's native asset. */
  contract: string | null;
  kind: "native" | "erc20" | "erc721" | "erc1155";
  tokenId?: string;
}

export interface ScanFinding {
  id: string;
  level: RiskLevel;
  title: string;
  detail: string;
}

export interface ScanResult {
  level: RiskLevel;
  category: TxCategory;
  findings: ScanFinding[];
  /**
   * What the transaction is expected to move.
   *
   * EMPTY IS NOT "NOTHING MOVES" — it is "we could not determine what moves",
   * which is why `simulated` exists alongside it. Rendering an empty delta list
   * as "no assets leave your wallet" would be the most dangerous sentence in
   * the app.
   */
  deltas: AssetDelta[];
  /** True only when a provider actually simulated against chain state. */
  simulated: boolean;
  /** Which layers contributed. Shown so a user can tell a full scan from a partial one. */
  sources: string[];
  /** Present when the provider layer was attempted and failed. Never hidden. */
  providerError?: string;
  /** The contract being called, when there is one. */
  contract?: { address: string; verified: boolean; label?: string };
}

/**
 * Must the user do something more than tap "confirm"?
 *
 * `danger` requires an explicit typed/held acknowledgement rather than a second
 * tap — a second tap in the same place as the first is muscle memory, not
 * consent, and this is the transaction class where the difference is a drained
 * wallet.
 */
export function requiresExplicitAcknowledgement(result: ScanResult): boolean {
  return result.level === "danger";
}

/** Findings rendered through the shared money-warning component. */
export function toMoneyWarnings(result: ScanResult): MoneyWarning[] {
  return result.findings.map((f) => ({
    id: f.id,
    level: f.level === "danger" ? "danger" : f.level === "caution" ? "warn" : "info",
    title: f.title,
    detail: f.detail,
  }));
}

/**
 * The result used when scanning could not run at all.
 *
 * `unknown`, never `safe`. A wallet that reports "safe" when it did not look is
 * worse than one that reports nothing, because the user acts on the word.
 */
export function unscannedResult(reason: string): ScanResult {
  return {
    level: "unknown",
    category: "unknown",
    findings: [
      {
        id: "not_scanned",
        level: "unknown",
        title: "This transaction was not checked",
        detail: reason,
      },
    ],
    deltas: [],
    simulated: false,
    sources: [],
  };
}
