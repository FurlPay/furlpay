// The daily roll-up, computed from observed rows.
//
// THE CENTRAL CLAIM THIS FILE HAS TO GET RIGHT: raw on-chain USDC volume is not
// payment volume, and the gap between them is large. A day's raw transfer total
// includes exchange rebalancing, bridge legs, arbitrage loops, Circle issuing and
// redeeming, and both halves of every cross-chain transfer. Reporting that number
// as "USDC payments today" would overstate economic activity by a wide and
// unstable margin.
//
// So the report is built as a reconciliation rather than a single number:
//
//   raw observed volume
//     − Circle issuance and redemption   (not a transfer between parties)
//     − CCTP burn and mint legs          (counted once, as one cross-chain event)
//     − internal rebalances              (no change of beneficial owner)
//     = movement between distinct parties
//         of which: exchange deposits and withdrawals
//                   large transfers between unlabelled wallets
//                   plausible payment-sized activity
//
// Every line is derived from stored classifications, so the arithmetic can be
// checked against the table rather than taken on trust.
//
// WHAT IS NOT CLAIMED. "Likely payment" is a size-and-shape heuristic, not a
// determination — a transfer between two unlabelled wallets for an ordinary
// amount. It could be a person paying a merchant or one desk moving its own
// funds, and the label says "likely" because the chain does not say which.

import { usdcDb, cctpDb } from "../db/usdc.js";
import { coverageSince } from "./scanRuns.js";
import { getUsdcAsset, getScannedAssets } from "./registry.js";
import { env } from "../config/env.js";
import { PASS_THROUGH_WINDOW_MS } from "./scanner.js";
import { coverageNote } from "./solanaScanner.js";
import type { ExchangeFlowSummary, UsdcTransfer } from "./types.js";
import type { UsdcDailyStats } from "./embeds.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Classifications that are real movement but not a transfer between parties. */
const INFRASTRUCTURE: ReadonlySet<string> = new Set([
  "MINT",
  "BURN",
  "CCTP_TRANSFER",
  "INTERNAL_REBALANCE",
  "BRIDGE_TRANSFER",
]);

export interface UsdcReconciliation {
  rawVolumeUsd: number;
  issuanceUsd: number;
  redemptionUsd: number;
  cctpLegsUsd: number;
  rebalanceUsd: number;
  bridgeUsd: number;
  /**
   * Money being relayed onward rather than moved — a transfer whose sender received
   * the same amount moments earlier.
   *
   * Measured on the live table: $8.66bn of $13.47bn in a 24h window, 64%. Before
   * this line existed, all of it was counted inside `betweenPartiesUsd`, so the
   * reconciliation's headline figure contained the exact double-count the
   * reconciliation exists to remove.
   */
  passThroughUsd: number;
  passThroughCount: number;
  /** Raw volume less every infrastructure category above, relays included. */
  betweenPartiesUsd: number;
  exchangeInflowUsd: number;
  exchangeOutflowUsd: number;
  whaleVolumeUsd: number;
  likelyPaymentUsd: number;
  furlpayReceivedUsd: number;
  furlpaySentUsd: number;
}

/**
 * Reconcile a window's raw volume down to movement between distinct parties.
 *
 * Deliberately computed in one pass over the rows rather than as a dozen SQL
 * aggregates: the categories must partition the same set of rows exactly once, and
 * that is far easier to verify — and to keep true — when the branching is visible
 * in one place.
 */
export function reconcile(transfers: readonly UsdcTransfer[]): UsdcReconciliation {
  const r: UsdcReconciliation = {
    rawVolumeUsd: 0,
    issuanceUsd: 0,
    redemptionUsd: 0,
    cctpLegsUsd: 0,
    rebalanceUsd: 0,
    bridgeUsd: 0,
    passThroughUsd: 0,
    passThroughCount: 0,
    betweenPartiesUsd: 0,
    exchangeInflowUsd: 0,
    exchangeOutflowUsd: 0,
    whaleVolumeUsd: 0,
    likelyPaymentUsd: 0,
    furlpayReceivedUsd: 0,
    furlpaySentUsd: 0,
  };

  for (const t of transfers) {
    const v = t.amountUsd;
    r.rawVolumeUsd += v;

    switch (t.classification) {
      case "MINT":
        r.issuanceUsd += v;
        break;
      case "BURN":
        r.redemptionUsd += v;
        break;
      case "CCTP_TRANSFER":
        r.cctpLegsUsd += v;
        break;
      case "INTERNAL_REBALANCE":
        r.rebalanceUsd += v;
        break;
      case "BRIDGE_TRANSFER":
        r.bridgeUsd += v;
        break;
      case "EXCHANGE_DEPOSIT":
        r.exchangeInflowUsd += v;
        break;
      case "EXCHANGE_WITHDRAWAL":
        r.exchangeOutflowUsd += v;
        break;
      case "LIKELY_PAYMENT":
        r.likelyPaymentUsd += v;
        break;
      default:
        break;
    }

    // Relayed money is deducted alongside the infrastructure categories. It is
    // tracked separately because "this was a bridge leg" and "this was the same
    // dollars moving one hop further" are different facts, and the report shows
    // both rather than collapsing them into one adjustment.
    if (t.passThrough) {
      r.passThroughUsd += v;
      r.passThroughCount += 1;
    }

    if (!INFRASTRUCTURE.has(t.classification) && !t.passThrough) {
      r.betweenPartiesUsd += v;
    }
    // Whale volume is a size band, not a category, so it overlaps the above on
    // purpose and is never added into the reconciliation total.
    if (t.isWhale) r.whaleVolumeUsd += v;

    if (t.isFurlPay) {
      // Direction from FurlPay's point of view. A transfer between two FurlPay
      // wallets counts as both, which is correct for a per-wallet view and is why
      // this is not used as a net figure.
      if (t.toEntity === "FurlPay") r.furlpayReceivedUsd += v;
      if (t.fromEntity === "FurlPay") r.furlpaySentUsd += v;
    }
  }

  return r;
}

/**
 * Per-chain exchange flows over a window, from labelled addresses only.
 *
 * The restriction is inherent, not incidental: an exchange wallet we cannot name
 * is invisible here. So this is a floor on exchange activity, and the embed says
 * so rather than presenting it as a measurement.
 */
export function exchangeFlows(sinceMs: number): ExchangeFlowSummary[] {
  return usdcDb.exchangeFlows(sinceMs).map((f) => ({
    chainSlug: f.chainSlug,
    chainName: getUsdcAsset(f.chainSlug)?.chainName ?? f.chainSlug,
    inflowUsd: f.inflowUsd,
    outflowUsd: f.outflowUsd,
    netFlowUsd: f.inflowUsd - f.outflowUsd,
    inflowCount: f.inflowCount,
    outflowCount: f.outflowCount,
  }));
}

export interface DailyReport {
  stats: UsdcDailyStats;
  reconciliation: UsdcReconciliation;
  flows: ExchangeFlowSummary[];
  /** Plain-language notes on what the window did and did not cover. */
  caveats: string[];
}

/**
 * Build the report for a window.
 *
 * Returns the caveats alongside the numbers because a figure and its coverage are
 * one fact, not two. A day when three chains were unreachable produced a real
 * number for a smaller set of chains, and only the caveat makes it interpretable.
 */
export function buildDailyReport(sinceMs = Date.now() - DAY_MS): DailyReport {
  const transfers = usdcDb.since(sinceMs);
  const rec = reconcile(transfers);
  const byChain = usdcDb.volumeByChain(sinceMs);
  const cctp = cctpDb.volumeSince(sinceMs);
  const flows = exchangeFlows(sinceMs);

  const largest =
    transfers.length === 0
      ? null
      : transfers.reduce((a, b) => (b.amountUsd > a.amountUsd ? b : a), transfers[0]!);

  const whaleCount = transfers.filter((t) => t.isWhale).length;

  const stats: UsdcDailyStats = {
    date: new Date(sinceMs + DAY_MS).toISOString().slice(0, 10),
    totalVolumeUsd: rec.rawVolumeUsd,
    transferCount: transfers.length,
    whaleCount,
    whaleVolumeUsd: rec.whaleVolumeUsd,
    chainsActive: byChain.filter((c) => c.count > 0).length,
    exchangeInflowUsd: rec.exchangeInflowUsd,
    exchangeOutflowUsd: rec.exchangeOutflowUsd,
    cctpCount: cctp.count,
    cctpVolumeUsd: cctp.volumeUsd,
    furlpayReceivedUsd: rec.furlpayReceivedUsd,
    furlpaySentUsd: rec.furlpaySentUsd,
    topChains: byChain.slice(0, 6).map((c) => ({ chainSlug: c.chainSlug, volumeUsd: c.volumeUsd })),
    largest,
    // Everything deducted from raw volume: infrastructure categories plus relayed
    // money. Defined as the residual so it can never disagree with the printed
    // reconciliation, which is the figure a reader checks.
    infrastructureUsd: rec.rawVolumeUsd - rec.betweenPartiesUsd,
    likelyPaymentUsd: rec.likelyPaymentUsd,
  };

  return {
    stats,
    reconciliation: rec,
    flows,
    caveats: buildCaveats(sinceMs, cctp, rec.rawVolumeUsd),
  };
}

/**
 * The honest footnotes.
 *
 * Built from the scan-run table rather than written by hand, so a chain that
 * actually failed shows up here even if nobody thought to check.
 */
function buildCaveats(
  sinceMs: number,
  cctp: ReturnType<typeof cctpDb.volumeSince>,
  rawVolumeUsd: number
): string[] {
  const notes: string[] = [];

  notes.push(
    "Raw volume is not payment volume — it includes exchange rebalancing, bridges and arbitrage."
  );

  const coverage = coverageSince(sinceMs);
  const expected = getScannedAssets().filter((a) => a.kind === "evm").map((a) => a.chainSlug);
  const seen = new Set(coverage.map((c) => c.chainSlug));
  const missing = expected.filter((c) => !seen.has(c));

  if (missing.length) {
    notes.push(`Not scanned in this window: ${missing.join(", ")} — their volume is absent, not zero.`);
  }

  const broken = coverage.filter((c) => c.errors > 0);
  if (broken.length) {
    notes.push(
      `Partial coverage: ${broken
        .map((c) => `${c.chainSlug} (${c.errors}/${c.runs} scans failed)`)
        .join(", ")}.`
    );
  }

  // Transfers dropped for want of a block timestamp are UNDER-COUNTED VOLUME, and
  // nothing else in the report would show it. A chain whose endpoints omit
  // `blockTimestamp` from logs — Arbitrum does, inconsistently, on every endpoint
  // measured — needs a header read per block, and any that fail cost real
  // transfers. Dating them "now" instead would be worse, so the loss is named.
  const undated = coverage.filter((c) => /no-timestamp=([1-9]\d*)/.test(c.droppedDetail ?? ""));
  if (undated.length) {
    notes.push(
      `Under-counted where block times were unreadable: ${undated
        .map((c) => {
          const n = /no-timestamp=(\d+)/.exec(c.droppedDetail ?? "")?.[1] ?? "?";
          return `${c.chainSlug} (${n} transfers)`;
        })
        .join(", ")}.`
    );
  }

  if (cctp.inflightCount > 0) {
    notes.push(
      `${cctp.inflightCount} cross-chain transfer(s) still in flight, not counted in CCTP volume.`
    );
  }

  if (cctp.heuristicCount > 0) {
    notes.push(
      `${cctp.heuristicCount} cross-chain pairing(s) inferred from amount and recipient rather than Circle's nonce.`
    );
  }

  // The relay check has a floor, so say what it does not cover. Without this the
  // deduction reads as complete when it is bounded by design.
  const pt = usdcDb.passThroughSince(sinceMs, env.usdcPassThroughMinUsd);
  if (pt.belowFloorUsd > 0) {
    const pct = ((100 * pt.belowFloorUsd) / Math.max(1, rawVolumeUsd)).toFixed(1);
    notes.push(
      `Relayed-money detection covers transfers at or above ` +
        `$${env.usdcPassThroughMinUsd.toLocaleString("en-US")} within ` +
        `${Math.round(PASS_THROUGH_WINDOW_MS / 60000)} minutes; ` +
        `${pct}% of raw volume sits below that floor and may still contain relays.`
    );
  }

  notes.push(coverageNote());
  notes.push("Exchange flows cover labelled addresses only — unlabelled exchange wallets are not counted.");

  return notes;
}

/**
 * The reconciliation as printable lines.
 *
 * Shown in the console for `usdc daily` and appended to the Discord report, so
 * the adjustment from raw volume to between-party movement is visible rather than
 * applied behind the scenes.
 */
export function reconciliationLines(r: UsdcReconciliation): string[] {
  const m = (n: number) => `$${(n / 1e6).toFixed(2)}M`;
  return [
    `raw observed volume        ${m(r.rawVolumeUsd)}`,
    `  less Circle issuance     ${m(r.issuanceUsd)}`,
    `  less Circle redemption   ${m(r.redemptionUsd)}`,
    `  less CCTP legs           ${m(r.cctpLegsUsd)}`,
    `  less internal rebalance  ${m(r.rebalanceUsd)}`,
    `  less bridge transfers    ${m(r.bridgeUsd)}`,
    `  less relayed onward      ${m(r.passThroughUsd)}  (${r.passThroughCount} legs)`,
    `= between distinct parties ${m(r.betweenPartiesUsd)}`,
    `    exchange deposits      ${m(r.exchangeInflowUsd)}`,
    `    exchange withdrawals   ${m(r.exchangeOutflowUsd)}`,
    `    payment-sized activity ${m(r.likelyPaymentUsd)}`,
  ];
}
