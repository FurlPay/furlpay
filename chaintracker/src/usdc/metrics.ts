// One structured metrics line per tick.
//
// WHY A SINGLE LINE RATHER THAN SCATTERED COUNTERS. The log already reports each
// chain as it finishes, which is useful while watching a run and useless
// afterwards: answering "was last night healthy?" meant reading twelve lines per
// tick across hundreds of ticks. One line per tick with a stable key set can be
// grepped, diffed and plotted.
//
// WHAT IS DELIBERATELY IN HERE. Every number an operator needs to distinguish
// "quiet market" from "broken ingestion", because those look identical from the
// Discord channel — which is the failure mode this whole subsystem is most exposed
// to. A tick that posted nothing is normal; a tick that posted nothing because
// eleven chains errored is not, and only `rpcErrors` and `lagSec` separate them.
//
// WHAT IS NOT IN HERE. No addresses, no transaction hashes, no amounts for
// individual transfers. This is an operational summary, not a data export, and a
// log line is the wrong place to duplicate financial records that already live in
// the table with full provenance.

import { makeLogger } from "../util/logger.js";
import { getDb } from "../db/index.js";
import { getEvmScanAssets } from "./registry.js";
import { chainCoverage } from "./blocks.js";
import { usdcDb } from "../db/usdc.js";
import { cursors } from "../db/index.js";
import { SCANNER } from "./scanner.js";
import type { TickResult } from "./tick.js";

const log = makeLogger("usdc:metrics");

export interface TickMetrics {
  /** Raw log entries read from chains. */
  logsScanned: number;
  /** Rows that passed every validation and were newly stored. */
  transfersAccepted: number;
  /** Rows already present — a rescan or an overlapping range. Not a fault. */
  transfersDeduplicated: number;
  /** Rows discarded, by reason. */
  droppedZeroValue: number;
  droppedNoTimestamp: number;
  droppedNotNativeUsdc: number;
  /** Transfers recognised as relayed money rather than new movement. */
  passThroughDetected: number;
  /** CCTP burns newly seen, and burn/mint pairs completed. */
  cctpBurns: number;
  cctpCompleted: number;
  /** Iris lookups that assigned a nonce. */
  cctpAttested: number;
  /**
   * CCTP messages read but rejected as not being USDC token transfers — generic
   * cross-chain messaging, wrong body version, or a non-USDC mint token. Expected
   * to be small and non-zero; a sudden jump means a format change.
   */
  cctpMalformedOrForeign: number;
  /** Chains whose scan reported an error this tick. */
  rpcErrors: number;
  /** Chains scanned without error. */
  chainsHealthy: number;
  /** Block ranges processed, summed across chains. */
  blocksProcessed: number;
  /** Blocks permanently skipped after repeated timestamp failures. A coverage hole. */
  blocksSkipped: number;
  /**
   * How far behind the chain head the oldest cursor is, in seconds of wall clock,
   * approximated from the newest stored transfer. The single best signal that
   * ingestion has stalled.
   */
  lagSec: number | null;
  alertsEmitted: number;
  cctpAlertsEmitted: number;
  suppressedOrRetired: number;
  abandoned: boolean;
  /* --- Phase 1 data-correctness signals --------------------------- */
  /** Transfers invalidated because their block was reorganised away. */
  reorgs: number;
  /** CCTP pairings unwound because a leg was reorganised away. */
  cctpInvalidated: number;
  /** Blocks inside a claimed range that were never read. THE coverage number. */
  blocksMissing: number;
  /** Open backfill jobs. A non-zero value that never falls is a stuck queue. */
  backfillQueue: number;
  /** Endpoint pairs that disagreed on a block hash below the finality floor. */
  providerDisagreements: number;
  /** Share of window volume still resting on unfinalised data, 0..1. */
  unfinalisedShare: number | null;
}

/**
 * Ingestion lag, from the newest stored transfer.
 *
 * Deliberately measured from the DATA rather than from the cursor. A cursor can sit
 * at the chain head while nothing is being stored — which is exactly what a broken
 * decoder or a failing timestamp lookup looks like — so a cursor-based lag would
 * report healthy during the failure it most needs to catch.
 */
export function ingestionLagSec(): number | null {
  const r = getDb().prepare("SELECT MAX(ts) AS newest FROM usdc_transfers").get() as {
    newest: number | null;
  };
  if (r.newest === null) return null;
  return Math.max(0, Math.round((Date.now() - r.newest) / 1000));
}

export function collect(t: TickResult): TickMetrics {
  let logsScanned = 0;
  let accepted = 0;
  let zero = 0;
  let noTs = 0;
  let notUsdc = 0;
  let passThrough = 0;
  let blocks = 0;
  let skipped = 0;
  let errors = 0;

  for (const e of t.evm) {
    logsScanned += e.logsSeen;
    accepted += e.rowsNew;
    zero += e.dropped.zeroAmount;
    noTs += e.dropped.noTimestamp;
    notUsdc += e.dropped.notNativeUsdc;
    passThrough += e.passThrough;
    if (e.toBlock > 0 && e.fromBlock > 0) blocks += Math.max(0, e.toBlock - e.fromBlock + 1);
    if (e.skippedBlock !== null) skipped += 1;
    if (e.error) errors += 1;
  }

  if (t.solana) {
    logsScanned += t.solana.transfersFound;
    accepted += t.solana.rowsNew;
    notUsdc += t.solana.dropped.notNativeUsdc;
    if (t.solana.error) errors += 1;
  }

  let cctpBurns = 0;
  let cctpCompleted = 0;
  let cctpForeign = 0;
  for (const c of t.cctp) {
    cctpBurns += c.burnsNew;
    cctpCompleted += c.completed;
    // Messages seen minus messages that turned into completions is the count that
    // was read and not used: generic messaging, a non-1 body version, or a mint of
    // some other token.
    cctpForeign += Math.max(0, c.mintsFound - c.completed);
  }

  // Accepted plus dropped is what we decided about; anything else the chain gave us
  // was a row we already had.
  const decided = accepted + zero + noTs + notUsdc;
  const deduplicated = Math.max(0, logsScanned - decided);

  // Coverage and queue depth are read from the ledgers rather than passed in, so the
  // number reported is the stored truth and not this tick's opinion of it.
  const missing = getEvmScanAssets().reduce(
    (sum, a) => sum + chainCoverage(a.chainSlug).missingBlocks,
    0
  );
  const queue = (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM usdc_backfill_queue WHERE completed_at IS NULL")
      .get() as { n: number }
  ).n;

  // How much of the last 24h still rests on data the chain has not finalised. A total
  // computed mostly from `observed` rows is provisional, and saying so is the
  // difference between a number and a number you can act on.
  const fin = usdcDb.finalityBreakdown(Date.now() - 24 * 60 * 60 * 1000);
  const liveUsd = fin.observed.usd + fin.canonical.usd + fin.final.usd;
  const unfinalisedShare =
    liveUsd > 0 ? (fin.observed.usd + fin.canonical.usd) / liveUsd : null;

  return {
    logsScanned,
    transfersAccepted: accepted,
    transfersDeduplicated: deduplicated,
    droppedZeroValue: zero,
    droppedNoTimestamp: noTs,
    droppedNotNativeUsdc: notUsdc,
    passThroughDetected: passThrough,
    cctpBurns,
    cctpCompleted,
    cctpAttested: t.attested,
    cctpMalformedOrForeign: cctpForeign,
    rpcErrors: errors,
    chainsHealthy: t.evm.filter((e) => e.error === null).length,
    blocksProcessed: blocks,
    blocksSkipped: skipped,
    lagSec: ingestionLagSec(),
    alertsEmitted: t.posted,
    cctpAlertsEmitted: t.cctpPosted,
    suppressedOrRetired: t.suppressed,
    abandoned: t.abandoned,
    reorgs: t.reorgedTransfers,
    cctpInvalidated: t.cctpInvalidated,
    blocksMissing: missing,
    backfillQueue: queue,
    providerDisagreements: t.crossChecks.filter((c) => c.agree === false).length,
    unfinalisedShare,
  };
}

/**
 * Emit the tick summary.
 *
 * WARN rather than INFO when something is structurally wrong, so a log filtered to
 * warnings still shows the cases that need attention: a coverage hole, an abandoned
 * run, every chain failing, or ingestion falling badly behind.
 */
export function emit(m: TickMetrics): void {
  // WARN on anything structurally wrong, so a log filtered to warnings shows exactly
  // the cases needing attention. A provider disagreement and a coverage gap are both
  // data-correctness failures and belong in that set alongside the older signals.
  const structural =
    m.abandoned ||
    m.blocksSkipped > 0 ||
    m.blocksMissing > 0 ||
    m.providerDisagreements > 0 ||
    m.reorgs > 0 ||
    (m.rpcErrors > 0 && m.chainsHealthy === 0) ||
    (m.lagSec !== null && m.lagSec > STALE_LAG_SEC);

  const payload: Record<string, unknown> = {
    logs: m.logsScanned,
    accepted: m.transfersAccepted,
    dedup: m.transfersDeduplicated,
    passThrough: m.passThroughDetected,
    blocks: m.blocksProcessed,
    chainsOk: m.chainsHealthy,
    rpcErrors: m.rpcErrors,
    cctpBurns: m.cctpBurns,
    cctpDone: m.cctpCompleted,
    cctpAttested: m.cctpAttested,
    cctpForeign: m.cctpMalformedOrForeign,
    alerts: m.alertsEmitted,
    cctpAlerts: m.cctpAlertsEmitted,
    suppressed: m.suppressedOrRetired,
    lagSec: m.lagSec,
  };
  // Only present when non-zero, so the common line stays readable and an unusual
  // one stands out.
  if (m.droppedZeroValue) payload.dropZero = m.droppedZeroValue;
  if (m.droppedNoTimestamp) payload.dropNoTs = m.droppedNoTimestamp;
  if (m.droppedNotNativeUsdc) payload.dropNotUsdc = m.droppedNotNativeUsdc;
  if (m.blocksSkipped) payload.BLOCKS_SKIPPED = m.blocksSkipped;
  if (m.abandoned) payload.ABANDONED = true;
  if (m.reorgs) payload.REORGS = m.reorgs;
  if (m.cctpInvalidated) payload.CCTP_INVALIDATED = m.cctpInvalidated;
  if (m.blocksMissing) payload.BLOCKS_MISSING = m.blocksMissing;
  if (m.backfillQueue) payload.backfillQueue = m.backfillQueue;
  if (m.providerDisagreements) payload.PROVIDER_DISAGREEMENTS = m.providerDisagreements;
  if (m.unfinalisedShare !== null) {
    payload.unfinalisedPct = Math.round(m.unfinalisedShare * 1000) / 10;
  }

  if (structural) log.warn("tick", payload);
  else log.info("tick", payload);
}

/** Above this, ingestion is behind enough to be worth a warning. */
export const STALE_LAG_SEC = 30 * 60;

/**
 * Per-chain cursor position against the newest data we hold for that chain.
 *
 * Used by `doctor`. A chain whose cursor advances while its newest transfer stays
 * put is the specific failure that looks healthy from every other angle.
 */
export function chainLag(): Array<{
  chainSlug: string;
  cursorBlock: number | null;
  newestTransferAgeSec: number | null;
}> {
  const out: Array<{ chainSlug: string; cursorBlock: number | null; newestTransferAgeSec: number | null }> = [];
  const stmt = getDb().prepare(
    "SELECT MAX(ts) AS newest FROM usdc_transfers WHERE chain_slug = ?"
  );
  for (const a of getEvmScanAssets()) {
    const r = stmt.get(a.chainSlug) as { newest: number | null };
    out.push({
      chainSlug: a.chainSlug,
      cursorBlock: cursors.get(a.chainSlug, SCANNER).lastBlock,
      newestTransferAgeSec:
        r.newest === null ? null : Math.max(0, Math.round((Date.now() - r.newest) / 1000)),
    });
  }
  return out;
}
