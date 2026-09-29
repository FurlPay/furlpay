// Block ledger and coverage proof.
//
// THE QUESTION THIS FILE EXISTS TO ANSWER: did we miss any USDC movement?
//
// Before this, the honest answer was "we don't know". The scanner recorded what it
// found, and a range it never read looked exactly like a range with no activity.
// `usdc_scan_runs` held per-run provenance but nothing merged those ranges, so a
// gap left no trace anywhere.
//
// TWO LEDGERS, DELIBERATELY SEPARATE.
//
//   usdc_blocks        every block observed to CONTAIN native USDC activity, with
//                      its hash. This is what makes reorg detection possible: a
//                      stored hash that no longer matches the chain at that height
//                      is a reorg, and the transfers in it are no longer real.
//
//   usdc_scan_ranges   merged intervals of blocks FULLY READ. This is the coverage
//                      claim. A gap is the complement of these intervals, so
//                      "missing blocks" is computed rather than assumed.
//
// WHY NOT STORE EVERY BLOCK HEADER. Twelve chains, several of them sub-second, is
// millions of headers a day to prove something the range ledger proves exactly as
// well and far more cheaply. For a log-filtered indexer the correct claim is "we
// read every log in [a,b]", not "we hold every block in [a,b]" — and a block with
// no USDC logs contributes nothing either way.
//
// Both ledgers are populated from data the scanner already has: `blockHash` and
// `blockTimestamp` ride along on every log, so this costs no additional RPC.

import { getDb } from "../db/index.js";
import { makeLogger } from "../util/logger.js";

const log = makeLogger("usdc:blocks");

export type BlockStatus = "observed" | "canonical" | "final" | "reorged";

export interface ObservedBlock {
  chainSlug: string;
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  usdcLogCount: number;
}

/**
 * Record the blocks a scan observed, and report any whose hash changed.
 *
 * A hash that differs from what we stored for the same height is a REORG: the
 * block we indexed is no longer on the canonical chain, and the transfers we
 * recorded from it did not happen on the chain that now exists. Returning them
 * rather than handling them here keeps this module to bookkeeping — `finality.ts`
 * owns what to do about it.
 */
export function recordBlocks(blocks: readonly ObservedBlock[]): {
  inserted: number;
  reorged: Array<{ chainSlug: string; blockNumber: number; oldHash: string; newHash: string }>;
} {
  if (blocks.length === 0) return { inserted: 0, reorged: [] };
  const db = getDb();
  const now = Date.now();
  const reorged: Array<{ chainSlug: string; blockNumber: number; oldHash: string; newHash: string }> = [];

  const existing = db.prepare(
    "SELECT block_hash AS hash, status FROM usdc_blocks WHERE chain_slug = ? AND block_number = ?"
  );
  const insert = db.prepare(
    `INSERT INTO usdc_blocks (
       chain_slug, block_number, block_hash, ts, usdc_log_count, status, observed_at
     ) VALUES (?,?,?,?,?,'observed',?)
     ON CONFLICT(chain_slug, block_number) DO UPDATE SET
       usdc_log_count = excluded.usdc_log_count`
  );

  let inserted = 0;
  for (const b of blocks) {
    const prior = existing.get(b.chainSlug, b.blockNumber) as
      | { hash: string; status: string }
      | undefined;

    if (prior && prior.hash !== b.blockHash) {
      // A FINAL block changing hash would mean the chain reorganised past its own
      // stated finality, which is a far more serious event than an ordinary reorg —
      // so it is logged differently rather than folded into the normal path.
      if (prior.status === "final") {
        log.error("FINALISED BLOCK CHANGED HASH — finality assumption violated", {
          chain: b.chainSlug,
          block: b.blockNumber,
          storedHash: prior.hash,
          chainHash: b.blockHash,
        });
      }
      reorged.push({
        chainSlug: b.chainSlug,
        blockNumber: b.blockNumber,
        oldHash: prior.hash,
        newHash: b.blockHash,
      });
      // The new hash becomes the record of truth; the old block's transfers are
      // marked reorged by finality.ts.
      db.prepare(
        `UPDATE usdc_blocks
            SET block_hash = ?, ts = ?, usdc_log_count = ?, status = 'observed',
                observed_at = ?, reorged_at = NULL, finalized_at = NULL
          WHERE chain_slug = ? AND block_number = ?`
      ).run(b.blockHash, b.timestamp, b.usdcLogCount, now, b.chainSlug, b.blockNumber);
      continue;
    }

    const r = insert.run(
      b.chainSlug,
      b.blockNumber,
      b.blockHash,
      b.timestamp,
      b.usdcLogCount,
      now
    );
    if (Number(r.changes) > 0 && !prior) inserted += 1;
  }

  if (reorged.length) {
    log.warn("reorg detected", {
      count: reorged.length,
      chains: [...new Set(reorged.map((r) => r.chainSlug))].join(","),
      blocks: reorged.slice(0, 5).map((r) => r.blockNumber).join(","),
    });
  }

  return { inserted, reorged };
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

/**
 * Record that [fromBlock, toBlock] was completely read, merging into neighbours.
 *
 * Merging on write is what keeps this table from growing one row per tick forever
 * — twelve chains every two minutes is about 8,600 rows a day unmerged. It also
 * makes the gap query trivial: adjacent coverage collapses into one interval, so a
 * gap is simply the space between two rows.
 *
 * Intervals are inclusive on both ends, and two that merely touch (…100][101…) are
 * merged, because a block boundary is not a gap.
 */
export function recordCoverage(chainSlug: string, fromBlock: number, toBlock: number): void {
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || toBlock < fromBlock) return;
  const db = getDb();
  const now = Date.now();

  // Everything that overlaps or touches the new interval, widened by one on each
  // side so abutting ranges are pulled in.
  const overlapping = db
    .prepare(
      `SELECT id, from_block AS lo, to_block AS hi FROM usdc_scan_ranges
        WHERE chain_slug = ? AND to_block >= ? AND from_block <= ?`
    )
    .all(chainSlug, fromBlock - 1, toBlock + 1) as Array<{ id: number; lo: number; hi: number }>;

  let lo = fromBlock;
  let hi = toBlock;
  for (const o of overlapping) {
    lo = Math.min(lo, o.lo);
    hi = Math.max(hi, o.hi);
  }

  if (overlapping.length > 0) {
    const del = db.prepare("DELETE FROM usdc_scan_ranges WHERE id = ?");
    for (const o of overlapping) del.run(o.id);
  }

  db.prepare(
    "INSERT INTO usdc_scan_ranges (chain_slug, from_block, to_block, updated_at) VALUES (?,?,?,?)"
  ).run(chainSlug, lo, hi, now);
}

export interface CoverageGap {
  chainSlug: string;
  fromBlock: number;
  toBlock: number;
  blocks: number;
}

/**
 * Blocks inside our scanned span that were never read.
 *
 * Scoped to the span between the first and last block we have coverage for — NOT
 * back to genesis. Claiming a gap for every block before we started would make the
 * report useless, and "we have not indexed history" is a different statement from
 * "we lost a block in the middle of a range we claimed".
 */
export function coverageGaps(chainSlug: string): CoverageGap[] {
  const ranges = getDb()
    .prepare(
      `SELECT from_block AS lo, to_block AS hi FROM usdc_scan_ranges
        WHERE chain_slug = ? ORDER BY from_block ASC`
    )
    .all(chainSlug) as Array<{ lo: number; hi: number }>;

  const gaps: CoverageGap[] = [];
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1]!;
    const cur = ranges[i]!;
    // recordCoverage merges touching intervals, so any space left here is real.
    if (cur.lo > prev.hi + 1) {
      gaps.push({
        chainSlug,
        fromBlock: prev.hi + 1,
        toBlock: cur.lo - 1,
        blocks: cur.lo - prev.hi - 1,
      });
    }
  }
  return gaps;
}

export interface ChainCoverage {
  chainSlug: string;
  firstBlock: number | null;
  lastBlock: number | null;
  spanBlocks: number;
  coveredBlocks: number;
  missingBlocks: number;
  gaps: CoverageGap[];
  intervals: number;
}

/** Coverage for one chain, as a claim that can be checked. */
export function chainCoverage(chainSlug: string): ChainCoverage {
  const ranges = getDb()
    .prepare(
      `SELECT from_block AS lo, to_block AS hi FROM usdc_scan_ranges
        WHERE chain_slug = ? ORDER BY from_block ASC`
    )
    .all(chainSlug) as Array<{ lo: number; hi: number }>;

  if (ranges.length === 0) {
    return {
      chainSlug,
      firstBlock: null,
      lastBlock: null,
      spanBlocks: 0,
      coveredBlocks: 0,
      missingBlocks: 0,
      gaps: [],
      intervals: 0,
    };
  }

  const first = ranges[0]!.lo;
  const last = ranges[ranges.length - 1]!.hi;
  const covered = ranges.reduce((sum, r) => sum + (r.hi - r.lo + 1), 0);
  const span = last - first + 1;
  const gaps = coverageGaps(chainSlug);

  return {
    chainSlug,
    firstBlock: first,
    lastBlock: last,
    spanBlocks: span,
    coveredBlocks: covered,
    missingBlocks: span - covered,
    gaps,
    intervals: ranges.length,
  };
}

/* ------------------------------------------------------------------ */
/* Backfill queue                                                      */
/* ------------------------------------------------------------------ */

/**
 * Queue a gap for re-reading.
 *
 * A detected gap that is not recorded is a gap nobody fixes, and the whole point of
 * computing coverage is to act on the answer.
 */
export function queueBackfill(
  chainSlug: string,
  fromBlock: number,
  toBlock: number,
  reason: string
): boolean {
  const r = getDb()
    .prepare(
      `INSERT INTO usdc_backfill_queue (chain_slug, from_block, to_block, reason, queued_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(chain_slug, from_block, to_block) DO NOTHING`
    )
    .run(chainSlug, fromBlock, toBlock, reason.slice(0, 120), Date.now());
  return Number(r.changes) > 0;
}

export interface BackfillJob {
  id: number;
  chainSlug: string;
  fromBlock: number;
  toBlock: number;
  reason: string;
  attempts: number;
}

/** Open backfill jobs, least-attempted first so one poisoned range cannot starve the rest. */
export function pendingBackfills(limit = 10): BackfillJob[] {
  return getDb()
    .prepare(
      `SELECT id, chain_slug AS chainSlug, from_block AS fromBlock, to_block AS toBlock,
              reason, attempts
         FROM usdc_backfill_queue
        WHERE completed_at IS NULL
        ORDER BY attempts ASC, queued_at ASC LIMIT ?`
    )
    .all(limit) as unknown as BackfillJob[];
}

export function markBackfillAttempt(id: number): void {
  getDb()
    .prepare(
      "UPDATE usdc_backfill_queue SET attempts = attempts + 1, last_attempt_at = ? WHERE id = ?"
    )
    .run(Date.now(), id);
}

export function completeBackfill(id: number): void {
  getDb().prepare("UPDATE usdc_backfill_queue SET completed_at = ? WHERE id = ?").run(Date.now(), id);
}

/**
 * Scan every chain for gaps and queue what is missing.
 *
 * Returns what it queued so the tick can report it rather than only logging it.
 */
export function detectAndQueueGaps(chainSlugs: readonly string[]): {
  gapsFound: number;
  blocksMissing: number;
  queued: number;
} {
  let gapsFound = 0;
  let blocksMissing = 0;
  let queued = 0;

  for (const chain of chainSlugs) {
    for (const gap of coverageGaps(chain)) {
      gapsFound += 1;
      blocksMissing += gap.blocks;
      if (queueBackfill(chain, gap.fromBlock, gap.toBlock, "coverage gap")) queued += 1;
      log.warn("INDEXER GAP DETECTED", {
        chain,
        from: gap.fromBlock,
        to: gap.toBlock,
        blocks: gap.blocks,
      });
    }
  }

  return { gapsFound, blocksMissing, queued };
}
