// Whale tiering and event classification.
//
// Two jobs. First, turn a USD value into a tier, using per-chain thresholds so
// a $300k move on Solana can be notable while the same size on Ethereum is not.
// Second, work out what a transfer *means* — an exchange deposit reads very
// differently from a bridge hop — using the address labels rather than guesswork.

import type {
  AddressCategory,
  ChainRow,
  WhaleEventType,
  WhaleTier,
} from "../types/index.js";

/**
 * Display ladder, independent of the per-chain alerting thresholds.
 *
 * Tiers are named, not pictured. A row of sea-creature emoji forced the reader
 * to learn an arbitrary legend before they could rank two transfers; a short
 * uppercase label is instantly ordered and survives a code fence, which the
 * emoji did not.
 */
export const TIER_LADDER: Array<{ tier: WhaleTier; minUsd: number; label: string; short: string }> = [
  { tier: "fish", minUsd: 100_000, label: "Notable", short: "NOTE" },
  { tier: "dolphin", minUsd: 500_000, label: "Large", short: "LRG" },
  { tier: "shark", minUsd: 1_000_000, label: "Major", short: "MAJ" },
  { tier: "whale", minUsd: 5_000_000, label: "Whale", short: "WHALE" },
  { tier: "humpback", minUsd: 10_000_000, label: "Super Whale", short: "SUPER" },
  { tier: "mega", minUsd: 50_000_000, label: "Mega Whale", short: "MEGA" },
  { tier: "titan", minUsd: 100_000_000, label: "Titan", short: "TITAN" },
];

export function tierFor(amountUsd: number): WhaleTier {
  let out: WhaleTier = "fish";
  for (const t of TIER_LADDER) if (amountUsd >= t.minUsd) out = t.tier;
  return out;
}

export function tierMeta(tier: WhaleTier): { label: string; short: string; minUsd: number } {
  const hit = TIER_LADDER.find((t) => t.tier === tier) ?? TIER_LADDER[0]!;
  return { label: hit.label, short: hit.short, minUsd: hit.minUsd };
}

/** Embed colour: cool for inflows to exchanges, warm for outflows, red at the top. */
export function tierColor(tier: WhaleTier, eventType: WhaleEventType): number {
  if (tier === "titan" || tier === "mega") return 0xff3b30;
  if (eventType === "exchange_deposit") return 0xff9500; // supply hitting an exchange
  if (eventType === "exchange_withdrawal") return 0x34c759; // leaving to self-custody
  if (eventType === "bridge_transfer") return 0x5856d6;
  if (tier === "humpback") return 0xff6b35;
  if (tier === "whale") return 0x0a84ff;
  return 0x8e8e93;
}

/** The smallest per-chain threshold — below this we do not even record. */
export function minThresholdFor(chain: ChainRow): number {
  const t = chain.whaleThresholdsUsd;
  return t.length ? Math.min(...t) : 1_000_000;
}

/**
 * Classify a transfer from the two endpoint categories.
 *
 * Ordering matters: a transfer between an exchange and a bridge is reported as
 * the exchange leg, because that is the economically meaningful event.
 */
export function classifyEvent(
  fromCategory: AddressCategory,
  toCategory: AddressCategory,
  isNative: boolean,
  isStablecoin: boolean,
): WhaleEventType {
  const isExchange = (c: AddressCategory): boolean => c === "cex" || c === "exchange";

  if (toCategory === "burn") return "burn";
  if (fromCategory === "burn") return "mint";
  if (isExchange(toCategory) && !isExchange(fromCategory)) return "exchange_deposit";
  if (isExchange(fromCategory) && !isExchange(toCategory)) return "exchange_withdrawal";
  if (fromCategory === "bridge" || toCategory === "bridge") return "bridge_transfer";
  if (fromCategory === "treasury" || toCategory === "treasury") return "treasury_movement";
  if (fromCategory === "foundation" || toCategory === "foundation") return "treasury_movement";
  if (fromCategory === "dex" || toCategory === "dex") return "dex_transfer";
  if (isStablecoin) return "stablecoin_transfer";
  return isNative ? "native_transfer" : "token_transfer";
}

/** Short human phrase for the event type, used in embed titles. */
export function eventLabel(t: WhaleEventType): string {
  const M: Record<WhaleEventType, string> = {
    native_transfer: "Transfer",
    token_transfer: "Token Transfer",
    stablecoin_transfer: "Stablecoin Transfer",
    exchange_deposit: "Exchange Deposit",
    exchange_withdrawal: "Exchange Withdrawal",
    bridge_transfer: "Bridge Transfer",
    treasury_movement: "Treasury Movement",
    dex_transfer: "DEX Transfer",
    mint: "Mint",
    burn: "Burn",
  };
  return M[t] ?? "Transfer";
}

/** Short word for an address class — replaces the old pictographic key. */
export function categoryLabel(c: AddressCategory): string {
  const M: Partial<Record<AddressCategory, string>> = {
    cex: "Exchange", exchange: "Exchange", dex: "DEX", bridge: "Bridge",
    protocol: "Protocol", treasury: "Treasury", foundation: "Foundation",
    team: "Team", whale: "Whale", mev: "MEV", staking: "Staking",
    validator: "Validator", burn: "Burn", contract: "Contract", token: "Token",
    unknown: "Unknown",
  };
  return M[c] ?? "Unknown";
}

/**
 * Whale score for an address, 0..100.
 *
 * Deliberately a transparent weighted blend rather than a black box, because
 * users will ask why an address is ranked where it is. Each component is
 * log-scaled so a single enormous holder does not flatten the rest of the list.
 */
export function whaleScore(input: {
  balanceUsd: number | null;
  volumeUsd30d: number;
  txCount: number;
  distinctCounterparties: number;
  isLabelled: boolean;
}): number {
  const logScale = (v: number, cap: number): number =>
    v <= 0 ? 0 : Math.min(1, Math.log10(1 + v) / Math.log10(1 + cap));

  const balance = logScale(input.balanceUsd ?? 0, 1e9); // $1B saturates
  const volume = logScale(input.volumeUsd30d, 1e9);
  const activity = logScale(input.txCount, 10_000);
  const reach = logScale(input.distinctCounterparties, 500);

  const raw =
    balance * 45 + // what they hold matters most
    volume * 30 + // what they move
    activity * 12 +
    reach * 8 +
    (input.isLabelled ? 5 : 0); // a known entity is more interesting, not less

  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

/**
 * Confidence in a whale event's USD figure.
 *
 * The number shown to a user is only as good as the price behind it, so a
 * stale price or an unpriced token visibly lowers confidence instead of
 * quietly producing a wrong headline value.
 */
export function valuationConfidence(opts: {
  priceAgeMs: number | null;
  pricedFrom: "registry" | "lookup" | "stablecoin-peg" | "none";
}): number {
  if (opts.pricedFrom === "none") return 0;
  let c = opts.pricedFrom === "stablecoin-peg" ? 0.95 : opts.pricedFrom === "registry" ? 1 : 0.85;
  const age = opts.priceAgeMs ?? 0;
  if (age > 3_600_000) c *= 0.6;
  else if (age > 900_000) c *= 0.8;
  else if (age > 300_000) c *= 0.92;
  return Math.round(Math.max(0, Math.min(1, c)) * 100) / 100;
}
