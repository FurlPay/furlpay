// ---------------------------------------------------------------------------
// Custody-type domain model (Phase 1 of the self-custodial wallet plan —
// docs/SELF-CUSTODIAL-WALLET-DESIGN.md). Introduces the vocabulary and the
// anti-ambiguity rule ONLY. It does not change any displayed balance, deposit,
// or settlement behavior — those balances are not yet tagged or re-read here.
//
// THE INVARIANT: different custody types are never implicitly summed into one
// spendable number. A spendable action reads a single custody type where
// `spendable === true`; a net-worth view is an explicit, labelled aggregation.
// ---------------------------------------------------------------------------

export type CustodyType =
  | "SELF_CUSTODIAL_ONCHAIN" // user's device key controls it; the chain is truth
  | "REGULATED_CUSTODIAL" // held by FurlPay/partner under license (future)
  | "BANK_DEPOSIT" // BaaS/partner fiat account (future)
  | "CARD_BALANCE" // issuer-held spending balance (future)
  | "INVESTMENT_ASSET" // brokerage-custodied equities (future)
  | "REWARD_CREDIT" // promotional credit — NOT customer cash
  | "PENDING_SETTLEMENT"; // in-flight, not yet final

export const CUSTODY_TYPES: readonly CustodyType[] = [
  "SELF_CUSTODIAL_ONCHAIN",
  "REGULATED_CUSTODIAL",
  "BANK_DEPOSIT",
  "CARD_BALANCE",
  "INVESTMENT_ASSET",
  "REWARD_CREDIT",
  "PENDING_SETTLEMENT",
] as const;

/** Which custody types represent funds the user can actually spend right now.
 *  Rewards, investments, and in-flight settlements are NOT spendable cash. */
export const SPENDABLE_CUSTODY: readonly CustodyType[] = ["SELF_CUSTODIAL_ONCHAIN", "REGULATED_CUSTODIAL"];

export function isSpendable(custody: CustodyType): boolean {
  return SPENDABLE_CUSTODY.includes(custody);
}

/** Freshness stamp — a stored on-chain number is a CACHE, never authoritative
 *  over a live read. `source` records whether this value came from the chain
 *  or from the cache fallback, so the UI can be honest about it. */
export interface BalanceAsOf {
  source: "chain" | "cache";
  at: string; // ISO8601
  block?: string;
}

/**
 * A typed balance. `atomic` is a STRING of atomic units (bigint-safe) — money
 * never uses a JS number. Phase 1 defines this shape; later phases populate it
 * from on-chain reads. Existing ledger balances are NOT migrated to it here.
 */
export interface Balance {
  custody: CustodyType;
  token: string;
  chain?: string;
  atomic: string;
  decimals: number;
  asOf?: BalanceAsOf;
  spendable: boolean;
}

/**
 * Explicit net-worth aggregation — the ONLY sanctioned way to combine custody
 * types, and it must be surfaced to the user as a calculated total, never as
 * spendable money. Kept here so the invariant lives with the model. (Phase 1
 * provides the helper; no screen calls it on live money yet.)
 */
export function netWorthUsd(balances: { usdValue: number }[]): number {
  return balances.reduce((s, b) => s + b.usdValue, 0);
}
