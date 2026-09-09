import type { ChainId } from "@/lib/swap/assets";

// ---------------------------------------------------------------------------
// Native staking.
//
// THE HONEST STARTING POINT, because it decides everything below: on the chains
// FurlPay supports, CONSUMER NATIVE-DELEGATION STAKING DOES NOT EXIST.
//
// Ethereum's own staking needs 32 ETH and a running validator; there is no
// `delegate(validator, amount)` on Ethereum, Arbitrum, Base or Polygon PoS the
// way there is on Cosmos, Solana or Polkadot. Tangem's staking screens are
// mostly those other chains, which FurlPay does not support at all.
//
// What a consumer wallet on EVM actually offers under the word "staking" is
// LIQUID STAKING: deposit the native asset into a protocol, receive a token
// that represents the staked position, and redeem it later through a
// withdrawal queue. That is a real mechanism with real contracts — it is not a
// substitute invented here to make a screen appear.
//
// So this module models liquid staking honestly and calls it what it is. The
// UI says "liquid staking" and names the protocol; it never says "validator".
//
// HOW THIS DIFFERS FROM /earn, which is the question a reviewer should ask.
// Earn is Morpho ERC-4626 lending vaults: the yield comes from BORROWERS paying
// interest, the risk is the lending market, and the position is a vault share.
// Staking's yield comes from CONSENSUS REWARDS, the risk is validator slashing
// plus the protocol's own contracts, and exiting is gated by a withdrawal queue
// measured in days rather than being instant. Different source, different risk,
// different exit — so they are different products and different screens, and
// `stakingIsNotEarn` in the tests pins that they stay separate.
//
// NO PROTOCOL ADDRESS IS WRITTEN IN THIS CODEBASE FROM MEMORY. Same rule as
// lib/onchain/stockTokenRegistry.ts, for the same reason: a recalled contract
// address looks exactly like a correct one and sends a user's ETH somewhere
// unrecoverable. Addresses arrive from server configuration that a person has
// verified against the protocol's own published documentation. The registry
// ships empty, and an empty registry renders "not available" — which is the
// correct behaviour for a capability whose data nobody has checked.
// ---------------------------------------------------------------------------

/**
 * How a protocol represents a staked position.
 *
 * The two behave differently in a way the UI cannot paper over:
 *
 *   rebasing      the token BALANCE grows. 1 token stays ~1 ETH, and rewards
 *                 appear as more tokens.
 *   exchange_rate the balance is fixed and the token becomes worth MORE of the
 *                 underlying. Rewards appear as a rising redemption rate.
 *
 * Reading an exchange-rate token's balance as if it were rebasing under-reports
 * every reward the user has earned, which is the quiet failure this
 * distinction exists to prevent.
 */
export type StakingAccounting = "rebasing" | "exchange_rate";

/** How a user gets their principal back. */
export type ExitMechanism =
  /** Burn the receipt, wait out a queue, then claim. */
  | "withdrawal_queue"
  /** Sell the receipt token on a DEX. Instant, at a market price that may be below par. */
  | "secondary_market_only";

export interface StakingProtocol {
  id: string;
  /** "Lido", "Rocket Pool" — shown to the user, because they are trusting IT, not FurlPay. */
  name: string;
  chain: ChainId;
  /** Symbol of the asset being staked, e.g. "ETH". */
  assetSymbol: string;
  /** Symbol of the receipt token, e.g. "stETH". */
  receiptSymbol: string;
  accounting: StakingAccounting;
  exit: ExitMechanism;
  /**
   * The staking contract. NEVER hardcoded — see the header.
   *
   * Null means "configured but unverified", and nothing may be staked into a
   * null address. `isStakable()` enforces that.
   */
  contract: string | null;
  /** The receipt token contract. Same rule. */
  receiptToken: string | null;
  /**
   * Where the address came from, so a reviewer can re-check it.
   *
   * Required before `verified` may be true. An address with no provenance is
   * an address nobody verified.
   */
  sourceUrl: string | null;
  verified: boolean;
  /** Typical unbonding delay in days, from the protocol's docs. Null when unknown. */
  unbondingDays: number | null;
  /**
   * Current reward rate, as a percentage.
   *
   * NULL WHEN UNKNOWN, and never estimated. An APR is the single number a user
   * decides on; inventing one — or carrying a stale constant — is the most
   * consequential fabrication this screen could make. The server supplies it
   * from the protocol's own API or it is not shown.
   */
  aprPercent: number | null;
  /** When the APR was read. Lets the UI say how fresh the number is. */
  aprAsOf: string | null;
  /** Protocol-specific risk copy shown before staking. */
  risks: string[];
}

/** A user's position in one protocol, read from the chain. */
export interface StakingPosition {
  protocolId: string;
  /** Receipt-token balance, raw units. */
  receiptBalance: bigint;
  receiptDecimals: number;
  /**
   * What that receipt is currently worth in the underlying asset, raw units.
   *
   * For an exchange-rate token this is a contract read, not a multiplication we
   * perform — the protocol owns the rate, and computing it here would drift the
   * moment the protocol changes how it is derived.
   */
  underlyingValue: bigint | null;
  underlyingDecimals: number;
  readAt: number;
}

/** A pending exit from the withdrawal queue. */
export interface UnstakeRequest {
  protocolId: string;
  /** Protocol-assigned id, used to claim once the queue clears. */
  requestId: string;
  amount: bigint;
  requestedAt: number;
  /** Null while the protocol has not said when it will be claimable. */
  claimableAt: number | null;
  status: "pending" | "claimable" | "claimed";
}

/**
 * May a user stake into this protocol right now?
 *
 * Four gates, and all four are about NOT sending funds somewhere unverified.
 * The APR being absent is deliberately NOT a gate — a user may reasonably stake
 * without a rate showing, and blocking on a vendor API outage would be worse
 * than showing "rate unavailable".
 */
export function isStakable(protocol: StakingProtocol): { ok: true } | { ok: false; reason: string } {
  if (!protocol.verified) {
    return { ok: false, reason: "This protocol's contract address has not been verified." };
  }
  if (!protocol.contract || !/^0x[0-9a-fA-F]{40}$/.test(protocol.contract)) {
    return { ok: false, reason: "This protocol has no verified contract address." };
  }
  if (!protocol.receiptToken || !/^0x[0-9a-fA-F]{40}$/.test(protocol.receiptToken)) {
    return { ok: false, reason: "This protocol has no verified receipt token." };
  }
  if (!protocol.sourceUrl) {
    return { ok: false, reason: "This protocol's address has no recorded source." };
  }
  return { ok: true };
}

/** Protocols a user could actually stake into, from a configured list. */
export function stakableProtocols(protocols: StakingProtocol[]): StakingProtocol[] {
  return protocols.filter((p) => isStakable(p).ok);
}

/**
 * Rewards earned so far, or null when it cannot be computed honestly.
 *
 * Returns null rather than 0n for an exchange-rate position whose underlying
 * value could not be read — "you have earned nothing" and "we could not read
 * what you have earned" are different statements, and only one of them is a
 * reason to stop trusting the screen.
 *
 * `principal` is what the user deposited, tracked locally. For a REBASING
 * token the balance itself grew, so rewards are balance − principal; for an
 * EXCHANGE-RATE token the balance is unchanged and rewards live in the
 * redemption value.
 */
export function computeRewards(
  position: StakingPosition,
  accounting: StakingAccounting,
  principal: bigint | null,
): bigint | null {
  if (principal === null) return null;

  if (accounting === "rebasing") {
    const earned = position.receiptBalance - principal;
    return earned > 0n ? earned : 0n;
  }

  if (position.underlyingValue === null) return null;
  const earned = position.underlyingValue - principal;
  return earned > 0n ? earned : 0n;
}
