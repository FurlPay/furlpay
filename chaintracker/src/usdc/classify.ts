// Classification & whale detection engine for USDC transfers.
//
// Distinguishes raw on-chain movement from meaningful economic payment activity,
// exchange rebalances, bridge hops, and whale movements.

import type { UsdcClassification, UsdcWhaleTier, UsdcTierInfo } from "./types.js";
import type { ResolvedEntity } from "./entities.js";
import { isCctpMessenger } from "./registry.js";
import { env } from "../config/env.js";

export const USDC_TIERS: UsdcTierInfo[] = [
  { tier: "fish", minUsd: 100_000, label: "Notable", glyph: "🐋", color: 0x0a84ff },
  { tier: "dolphin", minUsd: 500_000, label: "Large", glyph: "🐋", color: 0x0a84ff },
  { tier: "shark", minUsd: 1_000_000, label: "Major", glyph: "🐳", color: 0x5856d6 },
  { tier: "whale", minUsd: 5_000_000, label: "Whale", glyph: "🐳", color: 0xbf5af2 },
  { tier: "humpback", minUsd: 10_000_000, label: "Super Whale", glyph: "🦈", color: 0xff9500 },
  { tier: "mega", minUsd: 50_000_000, label: "Mega Whale", glyph: "🚨", color: 0xff3b30 },
  { tier: "titan", minUsd: 100_000_000, label: "Titan", glyph: "🚨", color: 0xff453a },
];

/** Return whale tier metadata for a USD amount */
export function getUsdcTier(amountUsd: number): UsdcTierInfo {
  let matched = USDC_TIERS[0]!;
  for (const t of USDC_TIERS) {
    if (amountUsd >= t.minUsd) matched = t;
  }
  return matched;
}

/** Check if amount crosses whale threshold (default $100k) */
export function isUsdcWhale(amountUsd: number): boolean {
  return amountUsd >= env.usdcWhaleMinUsd;
}

/** Check if amount qualifies for real-time Discord alert (default $1M) */
export function isUsdcAlertWorthy(amountUsd: number, isFurlPay: boolean): boolean {
  if (isFurlPay) return true; // FurlPay wallet movements are always alerted
  return amountUsd >= env.usdcAlertMinUsd;
}

/** In-memory ring buffer for rapid loop / rebalance detection */
interface RecentTransfer {
  fromAddress: string;
  toAddress: string;
  amount: number;
  timestamp: number;
}
const recentHistory: RecentTransfer[] = [];
const REBALANCE_WINDOW_MS = 5 * 60 * 1000; // 5 min window

/** Record transfer into ring buffer */
export function recordRecentTransfer(t: { fromAddress: string; toAddress: string; amount: number; timestamp: number }): void {
  const now = Date.now();
  recentHistory.push(t);
  while (recentHistory.length > 500 || (recentHistory[0] && now - recentHistory[0].timestamp > REBALANCE_WINDOW_MS)) {
    recentHistory.shift();
  }
}

/**
 * Detect repeated same-size transfers touching one address, within this process.
 *
 * NO LONGER ON THE CLASSIFICATION PATH, and must not go back on it: it depends on
 * `Date.now()` and on an in-memory buffer, so it makes stored classifications
 * depend on process lifetime. Use `usdcDb.precedingLeg` instead, which is indexed
 * and deterministic. Retained only because the mempool intel code shares this
 * module's exports.
 */
export function isRebalancingLoop(fromAddress: string, toAddress: string, amount: number): boolean {
  const normFrom = fromAddress.toLowerCase();
  const normTo = toAddress.toLowerCase();
  const now = Date.now();

  let count = 0;
  for (const r of recentHistory) {
    if (now - r.timestamp <= REBALANCE_WINDOW_MS) {
      if (
        (r.fromAddress.toLowerCase() === normFrom || r.toAddress.toLowerCase() === normTo) &&
        Math.abs(r.amount - amount) / (amount || 1) < 0.05
      ) {
        count++;
      }
    }
  }
  return count >= 2;
}

/**
 * Classify a USDC transfer based on endpoint entities, contracts, and amounts.
 */
export function classifyUsdcTransfer(
  fromEntity: ResolvedEntity,
  toEntity: ResolvedEntity,
  fromAddress: string,
  toAddress: string,
  amountUsd: number,
): UsdcClassification {
  // 1. FurlPay Movement
  if (fromEntity.isFurlPay || toEntity.isFurlPay) {
    return "FURLPAY_TRANSFER";
  }

  // 2. Mint or Burn
  if (toEntity.isBurnOrMint || toEntity.category === "burn") return "BURN";
  if (fromEntity.isBurnOrMint || fromEntity.category === "burn") return "MINT";

  // 3. Circle CCTP
  if (isCctpMessenger(fromAddress) || isCctpMessenger(toAddress)) {
    return "CCTP_TRANSFER";
  }

  // 4. Same Entity Internal Rebalance (e.g. Binance Hot -> Binance Cold)
  if (
    fromEntity.entity &&
    toEntity.entity &&
    fromEntity.entity.toLowerCase() === toEntity.entity.toLowerCase()
  ) {
    return "INTERNAL_REBALANCE";
  }

  // 5. Relay and loop detection USED TO LIVE HERE, and had to move.
  //
  // `isRebalancingLoop` read an in-memory ring buffer and compared against
  // `Date.now()`. In this architecture every tick is a fresh process, so the buffer
  // started empty each run, and during a backfill — where block times are hours old
  // — it could never fire at all. The same blocks therefore classified differently
  // depending on whether they were scanned live or backfilled, and since the daily
  // reconciliation DEDUCTS INTERNAL_REBALANCE, the same window produced different
  // headline figures on a rescan.
  //
  // Classification is now a pure function of the transfer and its endpoints, so it
  // is reproducible. Relationship-based detection lives in `usdcDb.precedingLeg`,
  // which is indexed, persistent and deterministic, and is resolved once at
  // ingestion into the `pass_through` column.

  // 6. Exchange Flows
  if (toEntity.isExchange && !fromEntity.isExchange) {
    return "EXCHANGE_DEPOSIT";
  }
  if (fromEntity.isExchange && !toEntity.isExchange) {
    return "EXCHANGE_WITHDRAWAL";
  }

  // 7. Bridge & DEX
  if (fromEntity.category === "bridge" || toEntity.category === "bridge") {
    return "BRIDGE_TRANSFER";
  }
  if (fromEntity.category === "dex" || toEntity.category === "dex") {
    return "DEX_TRANSFER";
  }
  if (fromEntity.category === "treasury" || toEntity.category === "treasury") {
    return "TREASURY_TRANSFER";
  }

  // 8. Whale Transfer
  if (amountUsd >= env.usdcWhaleMinUsd) {
    return "WHALE_TRANSFER";
  }

  // 9. Likely economic payment (consumer / merchant transfers < $100k between standard EOAs)
  if (fromEntity.category === "unknown" && toEntity.category === "unknown" && amountUsd < 100_000) {
    return "LIKELY_PAYMENT";
  }

  return "RAW_TRANSFER";
}
