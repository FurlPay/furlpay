// Scan provenance.
//
// `usdc_transfers.source` records WHICH PROVIDER served a row — "alchemy",
// "rpc", "helius". This table records WHICH SCAN produced it: the chain, the
// block range, how many logs were seen, how many rows were new, and whether the
// scan errored.
//
// The difference is what makes a number defensible. "USDC volume was $4.8bn
// today, from Alchemy" is a claim. "...from these scans, which between them
// covered blocks X-Y on each chain, with these two chains erroring at 14:05" is
// a measurement with known holes. When a daily figure looks wrong, the first
// question is always whether a chain was actually being read, and without this
// table the answer has to be inferred from a cursor.

import { getDb } from "../db/index.js";

export interface ScanRunRecord {
  chainSlug: string;
  scanner: string;
  fromBlock: number | null;
  toBlock: number | null;
  logsSeen: number;
  rowsNew: number;
  dropped: number;
  /**
   * Why rows were dropped, as a compact "reason=n" list.
   *
   * The count alone is not diagnosable: zero-value ERC-20 Transfers are ordinary
   * and correctly discarded, while a transfer dropped for an unreadable block
   * timestamp is coverage silently lost. Only the breakdown separates them.
   */
  droppedDetail?: string | null;
  endpoint: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number;
}

export function recordScanRun(r: ScanRunRecord): void {
  getDb()
    .prepare(
      `INSERT INTO usdc_scan_runs (
         chain_slug, scanner, from_block, to_block, logs_seen, rows_new,
         dropped, dropped_detail, endpoint, error, started_at, finished_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      r.chainSlug,
      r.scanner,
      r.fromBlock,
      r.toBlock,
      r.logsSeen,
      r.rowsNew,
      r.dropped,
      r.droppedDetail ?? null,
      r.endpoint,
      r.error,
      r.startedAt,
      r.finishedAt
    );
}

/**
 * Per-chain coverage over a window: did we actually read this chain, and did the
 * reads succeed?
 *
 * This is what the daily report's caveat line is built from. A chain with
 * `errors > 0` contributed an unknown fraction of its real volume, and the
 * report says which chains those were instead of quietly under-reporting.
 */
export function coverageSince(sinceMs: number): Array<{
  chainSlug: string;
  runs: number;
  errors: number;
  logsSeen: number;
  rowsNew: number;
  lastRunAt: number | null;
  lastError: string | null;
  droppedDetail: string | null;
}> {
  return getDb()
    .prepare(
      `SELECT chain_slug        AS chainSlug,
              COUNT(*)          AS runs,
              SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors,
              COALESCE(SUM(logs_seen), 0) AS logsSeen,
              COALESCE(SUM(rows_new), 0)  AS rowsNew,
              MAX(finished_at)  AS lastRunAt,
              -- The breakdown from the most recent run that dropped anything.
              (SELECT dropped_detail FROM usdc_scan_runs dd
                WHERE dd.chain_slug = r.chain_slug AND dd.dropped > 0
                  AND dd.finished_at >= ?
                ORDER BY dd.finished_at DESC LIMIT 1) AS droppedDetail,
              -- The most recent error text, not just a count: "which chains
              -- were broken and how" is the actionable half.
              (SELECT error FROM usdc_scan_runs e
                WHERE e.chain_slug = r.chain_slug AND e.error IS NOT NULL
                  AND e.finished_at >= ?
                ORDER BY e.finished_at DESC LIMIT 1) AS lastError
         FROM usdc_scan_runs r
        WHERE r.finished_at >= ?
        GROUP BY r.chain_slug
        ORDER BY rowsNew DESC`
    )
    .all(sinceMs, sinceMs, sinceMs) as Array<{
    chainSlug: string;
    runs: number;
    errors: number;
    logsSeen: number;
    rowsNew: number;
    lastRunAt: number | null;
    lastError: string | null;
    droppedDetail: string | null;
  }>;
}

/**
 * Trim old runs.
 *
 * One row per chain per tick adds up: twelve chains on a 30-second schedule is
 * about a million rows a month, for data whose only use is recent diagnosis.
 * Called from the tick so retention needs no separate schedule.
 */
export function pruneScanRuns(olderThanMs: number): number {
  const r = getDb().prepare("DELETE FROM usdc_scan_runs WHERE finished_at < ?").run(olderThanMs);
  return Number(r.changes);
}
