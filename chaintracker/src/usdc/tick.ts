// One scheduled pass: scan, then publish what clears the bar.
//
// THE ORDERING MATTERS AND IS NOT ARBITRARY.
//
//   1. Scan EVM chains        writes usdc_transfers, usdc_blocks, usdc_scan_ranges
//   2. Scan Solana            writes usdc_transfers
//   3. Finality + reorgs      promotes observed -> canonical -> final, marks reorged
//   4. Gap detection          computes coverage, queues backfills
//   5. Provider cross-check   samples two endpoints on one block per chain
//   6. Scan CCTP + attest     writes usdc_cctp_transfers, joins burns to mints
//   7. Publish CCTP           cross-chain events, posted as ONE movement
//   8. Publish transfers      whatever is left that clears the threshold
//   9. Prune and report
//
// FINALITY RUNS BEFORE PUBLISHING, and that ordering is load-bearing. A transfer
// from a block that has just been reorganised away must be marked `removed` before
// the alert selector looks at it, or the channel publishes a movement that did not
// happen on the chain that exists.
//
// CCTP publishes BEFORE plain transfers because a cross-chain transfer's two legs
// are also ordinary rows in usdc_transfers — a burn to the zero address and a
// mint from it. Publishing those first would post "$10M burned on Base" and
// "$10M minted on Arbitrum" as two separate whale alerts, which is the exact
// double-count the correlator exists to prevent. Once the CCTP row is posted, its
// legs are suppressed.
//
// NOTHING HERE FABRICATES A TRANSFER. Every posted alert comes from a row the
// scanners wrote from a chain read. The old `probe` command is the only synthetic
// output in this subsystem, it is labelled as such, and it is not on this path.

import { env } from "../config/env.js";
import { Publisher } from "../bot/publisher.js";
import { makeLogger } from "../util/logger.js";
import { cctpDb, usdcDb } from "../db/usdc.js";
import { scanAllEvmChains, type UsdcScanResult } from "./scanner.js";
import { scanSolanaUsdc, type SolanaScanResult } from "./solanaScanner.js";
import { scanAllCctp, type CctpScanResult } from "./cctpScanner.js";
import { isUsdcAlertWorthy, getUsdcTier } from "./classify.js";
import { usdcTransferEmbed, cctpTransferEmbed } from "./embeds.js";
import { pruneScanRuns } from "./scanRuns.js";
import { getUsdcAsset, getEvmScanAssets } from "./registry.js";
import { runFinalityPass } from "./finality.js";
import { chainCoverage, detectAndQueueGaps } from "./blocks.js";
import { crossCheckSome, type CrossCheckResult } from "./crossCheck.js";
import { collect as collectMetrics, emit as emitMetrics } from "./metrics.js";
import type { UsdcTransfer } from "./types.js";

const log = makeLogger("usdc:tick");

/**
 * Ceiling on alerts posted per tick.
 *
 * A quiet market posts nothing; a volatile hour could produce dozens of
 * threshold-crossing transfers, and a channel that dumps forty embeds at once is
 * unreadable — which defeats the point of having it. Rows above the cap are not
 * lost: they stay unalerted and the next tick takes the largest of them.
 */
const MAX_ALERTS_PER_TICK = 6;
const MAX_CCTP_ALERTS_PER_TICK = 3;

/** Scan-run rows older than this are dropped. Diagnosis window, not history. */
const SCAN_RUN_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * How recent a transfer must be to be worth posting as "realtime".
 *
 * Measured need: after one backfill there were 804 unalerted transfers above the
 * $1M floor, against a cap of 6 per tick. `pendingAlerts` orders by size, so
 * without a cutoff the queue never drains and the channel posts steadily staler
 * alerts, largest first, forever. An alert about a transfer from three hours ago is
 * not intelligence.
 *
 * Retired rows stay in the table and still count in every aggregate.
 */
const ALERT_FRESHNESS_MS = 30 * 60 * 1000;

/**
 * Suppress alerting on rows that are the on-chain legs of something already
 * posted, or that are structurally uninteresting.
 *
 * Returns a reason string when the row should be stored but not posted, null when
 * it should be considered for posting. The reason is returned rather than a
 * boolean so the log can say WHY a large transfer was not alerted — otherwise a
 * suppressed $50M movement looks identical to a bug.
 */
export function suppressionReason(t: UsdcTransfer): string | null {
  // FIRST, unconditionally. A transfer from a reorganised block did not happen on the
  // chain that exists, so publishing it would be publishing a movement that is not
  // there. The alert query already filters `removed = 0`; this is the second line of
  // defence, because a row reorged mid-tick could otherwise slip through between the
  // query and the send.
  if (t.removed || t.finality === "reorged") return "block was reorganised away";

  // A mint or burn against the zero address is Circle issuing or redeeming, or
  // the source/destination leg of a CCTP transfer. Either way it is not somebody
  // moving money to somebody else, and the CCTP path reports the cross-chain
  // case properly as one event.
  if (t.classification === "MINT") return "issuance/CCTP mint leg";
  if (t.classification === "BURN") return "redemption/CCTP burn leg";

  // Hot-to-cold inside one exchange, or a detected loop. Real movement, no
  // change of beneficial owner.
  if (t.classification === "INTERNAL_REBALANCE") return "internal rebalance";

  // A transfer into or out of a CCTP contract is a bridge leg by another name.
  if (t.classification === "CCTP_TRANSFER") return "cctp contract leg";

  if (!isUsdcAlertWorthy(t.amountUsd, t.isFurlPay)) return "below threshold";

  return null;
}

export interface TickResult {
  evm: UsdcScanResult[];
  solana: SolanaScanResult | null;
  cctp: CctpScanResult[];
  attested: number;
  rowsNew: number;
  posted: number;
  cctpPosted: number;
  suppressed: number;
  /** True when the tick stopped early because it no longer held the lease. */
  abandoned: boolean;
  /** Transfers invalidated this tick because their block was reorganised away. */
  reorgedTransfers: number;
  /** CCTP pairings unwound because a leg was reorganised away. */
  cctpInvalidated: number;
  finality: Awaited<ReturnType<typeof runFinalityPass>> | null;
  gaps: { gapsFound: number; blocksMissing: number; queued: number } | null;
  crossChecks: CrossCheckResult[];
  errors: string[];
}

/**
 * Run one pass.
 *
 * `channelId` may be null for a scan-only run — useful for a backfill, and for
 * confirming ingestion works before pointing it at a channel.
 */
export async function runTick(
  channelId: string | null,
  /**
   * Called between phases. Returning false means the lease was lost and the tick
   * must stop — continuing would race the run that took it, which is the duplicate-
   * alert scenario the lease exists to prevent.
   */
  keepAlive: () => boolean = () => true
): Promise<TickResult> {
  const out: TickResult = {
    evm: [],
    solana: null,
    cctp: [],
    attested: 0,
    rowsNew: 0,
    posted: 0,
    cctpPosted: 0,
    suppressed: 0,
    abandoned: false,
    reorgedTransfers: 0,
    cctpInvalidated: 0,
    finality: null,
    gaps: null,
    crossChecks: [],
    errors: [],
  };

  /* --- 1. EVM ------------------------------------------------------ */
  out.evm = await scanAllEvmChains(keepAlive);
  for (const r of out.evm) {
    out.rowsNew += r.rowsNew;
    if (r.error) out.errors.push(`${r.chainSlug}: ${r.error}`);
  }

  if (!keepAlive()) {
    out.errors.push("lease lost after the EVM scan — stopping before publishing");
    out.abandoned = true;
    emitMetrics(collectMetrics(out));
    return out;
  }

  /* --- 2. Solana --------------------------------------------------- */
  // Only attempted when there is something to watch. Calling it with an empty
  // watchlist would record an error every tick and make the log useless.
  try {
    const sol = await scanSolanaUsdc();
    out.solana = sol;
    out.rowsNew += sol.rowsNew;
    if (sol.error) out.errors.push(`solana: ${sol.error}`);
  } catch (err) {
    out.errors.push(`solana: ${(err as Error).message.slice(0, 120)}`);
  }

  /* --- 3. Finality and reorgs -------------------------------------- */
  //
  // Before publishing, deliberately. A reorged transfer must be marked removed while
  // the alert selector can still see the flag.
  try {
    const fin = await runFinalityPass(keepAlive);
    out.finality = fin;
    for (const h of fin.heads) if (h.error) out.errors.push(`heads/${h.chainSlug}: ${h.error}`);
    for (const r of fin.reorgs) {
      out.reorgedTransfers += r.transfersReorged;
      out.cctpInvalidated += r.cctpInvalidated;
    }
  } catch (err) {
    out.errors.push(`finality: ${(err as Error).message.slice(0, 120)}`);
  }

  /* --- 4. Coverage and gaps ---------------------------------------- */
  //
  // The answer to "did we miss any USDC movement?". Computed from merged scan ranges,
  // so a gap is derived rather than assumed absent.
  try {
    const chains = getEvmScanAssets().map((a) => a.chainSlug);
    out.gaps = detectAndQueueGaps(chains);
    for (const c of chains) {
      const cov = chainCoverage(c);
      if (cov.missingBlocks > 0) {
        out.errors.push(`coverage/${c}: ${cov.missingBlocks} block(s) missing, backfill queued`);
      }
    }
  } catch (err) {
    out.errors.push(`coverage: ${(err as Error).message.slice(0, 120)}`);
  }

  /* --- 5. Provider cross-validation -------------------------------- */
  //
  // Alchemy is not the source of truth. A rotating sample compares two endpoints on a
  // block below the finality floor, so latency cannot masquerade as disagreement.
  try {
    out.crossChecks = await crossCheckSome(getEvmScanAssets());
    for (const c of out.crossChecks) {
      if (c.agree === false) {
        out.errors.push(
          `PROVIDER DISAGREEMENT ${c.chainSlug}@${c.blockNumber}: ${c.providerA} vs ${c.providerB}`
        );
      }
    }
  } catch (err) {
    out.errors.push(`crosscheck: ${(err as Error).message.slice(0, 120)}`);
  }

  /* --- 6. CCTP ----------------------------------------------------- */
  try {
    const { results, attestation } = await scanAllCctp();
    out.cctp = results;
    out.attested = attestation.resolved;
    for (const r of results) if (r.error) out.errors.push(`cctp/${r.chainSlug}: ${r.error}`);
  } catch (err) {
    out.errors.push(`cctp: ${(err as Error).message.slice(0, 120)}`);
  }

  if (!channelId) {
    pruneScanRuns(Date.now() - SCAN_RUN_RETENTION_MS);
    emitMetrics(collectMetrics(out));
    return out;
  }

  // The last check before anything is sent. Everything above is idempotent — the
  // UNIQUE index absorbs a repeated insert — but a Discord message is not, so the
  // lease is verified immediately before the only irreversible step in the tick.
  if (!keepAlive()) {
    out.errors.push("lease lost before publishing — no messages sent");
    out.abandoned = true;
    emitMetrics(collectMetrics(out));
    return out;
  }

  const pub = Publisher.fromEnv();

  /* --- 7. Publish CCTP first --------------------------------------- */

  const cctpPending = cctpDb.pendingAlerts(MAX_CCTP_ALERTS_PER_TICK);
  const cctpPosted: number[] = [];
  for (const c of cctpPending) {
    // Cross-chain transfers use the same USD bar as everything else. A $500
    // bridge hop is not intelligence.
    if (c.amount < env.usdcAlertMinUsd) {
      cctpPosted.push(c.id);
      continue;
    }
    try {
      await pub.send(channelId, [cctpTransferEmbed(c)]);
      cctpPosted.push(c.id);
      out.cctpPosted += 1;
    } catch (err) {
      // Not marked alerted, so the next tick retries it. A Discord outage must
      // not silently consume an event.
      out.errors.push(`discord/cctp: ${(err as Error).message.slice(0, 100)}`);
      break;
    }
  }
  cctpDb.markAlerted(cctpPosted);

  /* --- 8. Publish transfers ---------------------------------------- */

  // Retire anything too old to be a realtime alert BEFORE choosing candidates, or
  // the largest-first ordering serves a backlog instead of the current window.
  const retired = usdcDb.retireStale(Date.now() - ALERT_FRESHNESS_MS);
  if (retired > 0) {
    out.suppressed += retired;
    log.debug("retired stale alert candidates", { count: retired });
  }

  // Pulled generously and filtered here rather than in SQL, because the
  // suppression rules are classification-based and belong next to their reasons.
  const candidates = usdcDb.pendingAlerts(MAX_ALERTS_PER_TICK * 8);
  const toSuppress: Array<{ id: number; reason: string }> = [];
  const posted: number[] = [];

  for (const t of candidates) {
    if (out.posted >= MAX_ALERTS_PER_TICK) break;

    // Structural rules first, then the round-trip query — which costs a lookup, so
    // it only runs on transfers that would otherwise be posted.
    let reason = suppressionReason(t);

    if (!reason && t.passThrough) {
      // Read, not recomputed. The decision was made once at ingestion (see
      // migration 0014), so the channel and the daily report cannot disagree about
      // whether a transfer was relayed money — which they could when each ran its
      // own query at a different time against a growing table.
      reason =
        t.passThroughKind === "reversal"
          ? "round trip — the same money came straight back"
          : "continuation of a hop chain — the same money moving onward";
    }

    if (reason) {
      toSuppress.push({ id: t.id, reason });
      out.suppressed += 1;
      // Worth a line when the amount was large: a suppressed nine-figure
      // transfer should be explicable after the fact.
      if (t.amountUsd >= 10_000_000) {
        log.debug("large transfer suppressed", {
          chain: t.chainSlug,
          usd: Math.round(t.amountUsd),
          reason,
          tx: t.txHash,
        });
      }
      continue;
    }

    try {
      await pub.send(channelId, [usdcTransferEmbed(t)]);
      posted.push(t.id);
      out.posted += 1;
      log.info("posted", {
        chain: t.chainSlug,
        usd: Math.round(t.amountUsd),
        tier: getUsdcTier(t.amountUsd).label,
        class: t.classification,
      });
    } catch (err) {
      out.errors.push(`discord: ${(err as Error).message.slice(0, 100)}`);
      break;
    }
  }

  // Suppressed rows are marked alerted so they are not reconsidered, but they
  // stay in the table — the daily aggregate is computed from ALL observed
  // transfers, not only the posted ones.
  usdcDb.markSuppressed(toSuppress);
  usdcDb.markPosted(posted);

  /* --- 9. Prune and report ----------------------------------------- */
  pruneScanRuns(Date.now() - SCAN_RUN_RETENTION_MS);

  // One structured line per tick. The only way to tell "quiet market" from "broken
  // ingestion" after the fact — both look identical in the Discord channel.
  emitMetrics(collectMetrics(out));

  return out;
}

/** A one-line summary of a tick, for the console and the scheduler log. */
export function summariseTick(r: TickResult): string {
  const chains = r.evm.filter((e) => e.rowsNew > 0).length;
  const logs = r.evm.reduce((s, e) => s + e.logsSeen, 0);
  const parts = [
    `${r.rowsNew} new rows from ${logs} logs across ${chains} chain(s)`,
    `${r.posted} posted`,
    `${r.suppressed} suppressed/retired`,
  ];
  if (r.cctpPosted) parts.push(`${r.cctpPosted} cctp`);
  if (r.attested) parts.push(`${r.attested} attested`);
  if (r.solana) parts.push(`solana ${r.solana.rowsNew}/${r.solana.addressesChecked}addr`);
  if (r.reorgedTransfers) parts.push(`${r.reorgedTransfers} REORGED`);
  if (r.gaps && r.gaps.blocksMissing) parts.push(`${r.gaps.blocksMissing} blocks MISSING`);
  const disagree = r.crossChecks.filter((c) => c.agree === false).length;
  if (disagree) parts.push(`${disagree} PROVIDER DISAGREEMENT`);
  if (r.abandoned) parts.push("ABANDONED (lease lost)");
  if (r.errors.length) parts.push(`${r.errors.length} error(s)`);
  return parts.join(" · ");
}

export { getUsdcAsset };
