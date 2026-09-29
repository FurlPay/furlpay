// CCTP reporting helpers.
//
// WHAT USED TO BE HERE, and why it is gone. This file previously held a burn/mint
// correlation engine written against CCTP V1: it keyed on a numeric nonce read
// from the source-chain event, and it inserted a half-row for a mint seen before
// its burn.
//
// Both assumptions are wrong for V2. There is no nonce in the source-chain event
// — Circle assigns it during attestation, and the `MessageSent` payload carries
// thirty-two zero bytes where V1 put one. And a mint stored without its burn has
// no source chain, no sender and no burn time, so it enters every aggregate as a
// transfer from nowhere.
//
// The correlation logic now lives in exactly two places: `cctpScanner.ts` reads
// and decodes the events, and `cctpDb` in `db/usdc.ts` owns the join. Nothing
// here writes. Keeping a second write path would mean two implementations of the
// one rule that must never be got wrong — that a cross-chain transfer is counted
// once.

import { cctpDb } from "../db/usdc.js";
import { cctpDomainName } from "./registry.js";
import type { CctpTransfer } from "./types.js";

/** Completed cross-chain transfers in a window, newest first. */
export function recentCctpTransfers(sinceMs: number, limit = 50): Array<CctpTransfer & { id: number }> {
  return cctpDb.recentCompleted(sinceMs, limit);
}

/** Busiest lanes in a window, for the daily roll-up. */
export function cctpLanes(sinceMs: number, limit = 8) {
  return cctpDb.lanesSince(sinceMs, limit);
}

export interface CctpWindowSummary {
  completedCount: number;
  completedUsd: number;
  inflightCount: number;
  inflightUsd: number;
  /** How many completions rest on inference rather than Circle's nonce. */
  heuristicCount: number;
  feesUsd: number;
  lanes: Array<{ sourceChain: string; destChain: string | null; count: number; volumeUsd: number }>;
}

/**
 * Everything the report needs about CCTP over a window.
 *
 * `completedUsd` is the only figure that belongs in a headline volume total.
 * In-flight burns are surfaced separately rather than added, because a burn
 * without its mint is a transfer in progress, and folding it in would make the
 * total depend on exactly when the window closed.
 */
export function cctpWindow(sinceMs: number): CctpWindowSummary {
  const v = cctpDb.volumeSince(sinceMs);
  return {
    completedCount: v.count,
    completedUsd: v.volumeUsd,
    inflightCount: v.inflightCount,
    inflightUsd: v.inflightUsd,
    heuristicCount: v.heuristicCount,
    feesUsd: v.feesUsd,
    lanes: cctpDb.lanesSince(sinceMs),
  };
}

/**
 * How much of a window's raw transfer volume is the on-chain footprint of
 * completed CCTP transfers.
 *
 * A completed transfer shows up in `usdc_transfers` twice: a burn to the zero
 * address on the source chain and a mint from it on the destination. So its
 * contribution to raw volume is 2x the transfer value, and subtracting that from
 * raw volume is what turns "USDC moved" into something closer to "USDC moved
 * between parties".
 *
 * Returned as a distinct figure rather than silently applied, so the daily report
 * can show the adjustment instead of just its result.
 */
export function cctpRawFootprintUsd(sinceMs: number): number {
  return cctpDb.volumeSince(sinceMs).volumeUsd * 2;
}

/** A readable lane name, using the domain number when the chain is untracked. */
export function laneLabel(t: Pick<CctpTransfer, "sourceChain" | "destChain" | "destDomain">): string {
  const dest = t.destChain ?? cctpDomainName(t.destDomain);
  return `${t.sourceChain} → ${dest}`;
}

export { cctpDb };
