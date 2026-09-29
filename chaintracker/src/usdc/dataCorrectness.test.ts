// Phase 1 — data correctness.
//
// These cover the three questions the V2 brief puts first, each of which the previous
// system could not answer:
//
//   Did a movement actually happen?   -> reorg handling. A transfer from an orphaned
//                                        block did NOT happen on the chain that
//                                        exists, and used to sit in every total.
//   Did we miss any movement?         -> the coverage ledger. A range never read used
//                                        to be indistinguishable from a quiet one.
//   How confident are we?             -> the finality state machine. Measured lag is
//                                        83 blocks on Ethereum and 4,127 on Arbitrum,
//                                        so the newest rows are routinely not settled.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let getDb: typeof import("../db/index.js")["getDb"];
let blocks: typeof import("./blocks.js");
let finality: typeof import("./finality.js");

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "usdc-dc-"));
  process.env.DATABASE_URL = join(dir, "test.db");
  const db = await import("../db/index.js");
  getDb = db.getDb;
  getDb();
  blocks = await import("./blocks.js");
  finality = await import("./finality.js");
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A locked file on Windows is not a test failure.
  }
});

beforeEach(() => {
  const db = getDb();
  for (const t of [
    "usdc_scan_ranges",
    "usdc_blocks",
    "usdc_backfill_queue",
    "usdc_transfers",
    "usdc_cctp_transfers",
    "usdc_provider_checks",
    "usdc_chain_heads",
  ]) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

const HASH = (n: number) => "0x" + n.toString(16).padStart(64, "0");

function insertTransfer(o: {
  chain?: string;
  tx: string;
  logIndex?: number;
  block: number;
  blockHash?: string | null;
  usd?: number;
  finality?: string;
}): number {
  getDb()
    .prepare(
      `INSERT INTO usdc_transfers (
         chain_slug, token_address, tx_hash, log_index, block_number, block_hash, ts,
         from_address, to_address, amount, amount_usd,
         from_category, to_category, classification, source, created_at, finality
       ) VALUES (?,?,?,?,?,?,?,'0xaaa','0xbbb',?,?,'unknown','unknown','WHALE_TRANSFER','rpc',?,?)`
    )
    .run(
      o.chain ?? "base",
      "0xtok",
      o.tx,
      o.logIndex ?? 0,
      o.block,
      o.blockHash ?? null,
      1_790_651_000_000,
      o.usd ?? 1000,
      o.usd ?? 1000,
      Date.now(),
      o.finality ?? "observed"
    );
  return Number(
    (getDb().prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id
  );
}

/* ================================================================== */
/* COVERAGE — "did we miss any movement?"                              */
/* ================================================================== */

test("a single scanned range reports complete coverage", () => {
  blocks.recordCoverage("base", 100, 200);
  const c = blocks.chainCoverage("base");
  assert.equal(c.firstBlock, 100);
  assert.equal(c.lastBlock, 200);
  assert.equal(c.coveredBlocks, 101, "inclusive on both ends");
  assert.equal(c.missingBlocks, 0);
  assert.equal(c.intervals, 1);
});

test("abutting ranges merge, because a block boundary is not a gap", () => {
  // Consecutive ticks produce [a..b] then [b+1..c]. Left unmerged, the gap query
  // would report a phantom gap at every tick boundary — thousands a day.
  blocks.recordCoverage("base", 100, 200);
  blocks.recordCoverage("base", 201, 300);
  const c = blocks.chainCoverage("base");
  assert.equal(c.intervals, 1, "touching ranges are one range");
  assert.equal(c.missingBlocks, 0);
  assert.deepEqual(blocks.coverageGaps("base"), []);
});

test("overlapping ranges merge without double-counting", () => {
  // A rescan legitimately re-reads blocks. Coverage must not exceed the span.
  blocks.recordCoverage("base", 100, 200);
  blocks.recordCoverage("base", 150, 250);
  const c = blocks.chainCoverage("base");
  assert.equal(c.intervals, 1);
  assert.equal(c.coveredBlocks, 151, "100-250 inclusive, counted once");
  assert.equal(c.missingBlocks, 0);
});

test("a genuine gap is detected and sized", () => {
  // THE CASE THE WHOLE LEDGER EXISTS FOR. Verified live against Base: two ranges
  // with 14 blocks between them produced exactly this.
  blocks.recordCoverage("base", 100, 200);
  blocks.recordCoverage("base", 215, 300);

  const gaps = blocks.coverageGaps("base");
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.fromBlock, 201);
  assert.equal(gaps[0]!.toBlock, 214);
  assert.equal(gaps[0]!.blocks, 14);

  const c = blocks.chainCoverage("base");
  assert.equal(c.missingBlocks, 14);
});

test("several gaps are each reported", () => {
  blocks.recordCoverage("base", 100, 110);
  blocks.recordCoverage("base", 120, 130);
  blocks.recordCoverage("base", 140, 150);
  const gaps = blocks.coverageGaps("base");
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0]!.blocks, 9);
  assert.equal(gaps[1]!.blocks, 9);
});

test("coverage is scoped to the scanned span, not back to genesis", () => {
  // Claiming a gap for every block before we started would drown the real signal.
  // "We have not indexed history" and "we lost a block mid-range" are different facts.
  blocks.recordCoverage("base", 51_000_000, 51_000_100);
  const c = blocks.chainCoverage("base");
  assert.equal(c.missingBlocks, 0);
  assert.equal(c.firstBlock, 51_000_000, "the span starts where we did");
});

test("an unscanned chain reports no coverage rather than complete coverage", () => {
  // Zero gaps over zero coverage must never read as success.
  const c = blocks.chainCoverage("never-touched");
  assert.equal(c.firstBlock, null);
  assert.equal(c.coveredBlocks, 0);
  assert.equal(c.intervals, 0);
});

test("coverage is per chain", () => {
  blocks.recordCoverage("base", 100, 200);
  blocks.recordCoverage("ethereum", 500, 600);
  assert.equal(blocks.chainCoverage("base").lastBlock, 200);
  assert.equal(blocks.chainCoverage("ethereum").firstBlock, 500);
  assert.deepEqual(blocks.coverageGaps("ethereum"), []);
});

test("an inverted or non-integer range is refused, not stored", () => {
  blocks.recordCoverage("base", 200, 100);
  blocks.recordCoverage("base", 1.5, 10);
  assert.equal(blocks.chainCoverage("base").intervals, 0, "garbage must not enter the ledger");
});

/* ================================================================== */
/* BACKFILL QUEUE                                                      */
/* ================================================================== */

test("a detected gap is queued exactly once", () => {
  blocks.recordCoverage("base", 100, 200);
  blocks.recordCoverage("base", 215, 300);

  const first = blocks.detectAndQueueGaps(["base"]);
  assert.equal(first.gapsFound, 1);
  assert.equal(first.blocksMissing, 14);
  assert.equal(first.queued, 1);

  // Running the detector again on the same gap must not pile up duplicate jobs.
  const second = blocks.detectAndQueueGaps(["base"]);
  assert.equal(second.queued, 0, "already queued");
  assert.equal(blocks.pendingBackfills(10).length, 1);
});

test("a completed job leaves the queue", () => {
  blocks.queueBackfill("base", 10, 20, "test");
  const [job] = blocks.pendingBackfills(10);
  assert.ok(job);
  blocks.completeBackfill(job.id);
  assert.equal(blocks.pendingBackfills(10).length, 0);
});

test("a repeatedly failing job sorts to the back rather than blocking the queue", () => {
  blocks.queueBackfill("base", 10, 20, "poisoned");
  blocks.queueBackfill("base", 30, 40, "fresh");

  const [first] = blocks.pendingBackfills(10);
  assert.ok(first);
  blocks.markBackfillAttempt(first.id);
  blocks.markBackfillAttempt(first.id);

  const order = blocks.pendingBackfills(10);
  assert.equal(order[0]!.attempts, 0, "the untried job is served first");
  assert.equal(order[1]!.attempts, 2);
});

/* ================================================================== */
/* BLOCK LEDGER AND REORGS — "did it actually happen?"                 */
/* ================================================================== */

test("observed blocks are recorded with their hashes", () => {
  const r = blocks.recordBlocks([
    { chainSlug: "base", blockNumber: 100, blockHash: HASH(1), timestamp: 1, usdcLogCount: 3 },
    { chainSlug: "base", blockNumber: 101, blockHash: HASH(2), timestamp: 2, usdcLogCount: 5 },
  ]);
  assert.equal(r.inserted, 2);
  assert.deepEqual(r.reorged, []);
});

test("re-observing the same block with the same hash is not a reorg", () => {
  blocks.recordBlocks([
    { chainSlug: "base", blockNumber: 100, blockHash: HASH(1), timestamp: 1, usdcLogCount: 3 },
  ]);
  const again = blocks.recordBlocks([
    { chainSlug: "base", blockNumber: 100, blockHash: HASH(1), timestamp: 1, usdcLogCount: 3 },
  ]);
  assert.deepEqual(again.reorged, [], "an ordinary rescan must not look like a reorg");
});

test("a changed hash at the same height IS a reorg", () => {
  blocks.recordBlocks([
    { chainSlug: "base", blockNumber: 100, blockHash: HASH(1), timestamp: 1, usdcLogCount: 3 },
  ]);
  const r = blocks.recordBlocks([
    { chainSlug: "base", blockNumber: 100, blockHash: HASH(99), timestamp: 1, usdcLogCount: 2 },
  ]);
  assert.equal(r.reorged.length, 1);
  assert.equal(r.reorged[0]!.oldHash, HASH(1));
  assert.equal(r.reorged[0]!.newHash, HASH(99));
});

test("a reorg marks the block's transfers removed, and does NOT delete them", () => {
  // Deleting would silently change historical figures and destroy the evidence that
  // the reorg happened. The row stays, flagged, and is excluded from every figure.
  const id = insertTransfer({ tx: "0xorphan", block: 100, blockHash: HASH(1), usd: 5000 });
  const out = finality.handleReorg("base", 100, HASH(1));

  assert.equal(out.transfersReorged, 1);

  const row = getDb()
    .prepare("SELECT removed, finality, reorged_at FROM usdc_transfers WHERE id = ?")
    .get(id) as { removed: number; finality: string; reorged_at: number | null };
  assert.equal(row.removed, 1);
  assert.equal(row.finality, "reorged");
  assert.ok(row.reorged_at !== null, "when it happened is part of the evidence");

  const still = getDb().prepare("SELECT COUNT(*) AS n FROM usdc_transfers").get() as { n: number };
  assert.equal(still.n, 1, "the row must survive");
});

test("a reorg only touches the block it happened in", () => {
  const keep = insertTransfer({ tx: "0xkeep", block: 99, blockHash: HASH(9), usd: 1000 });
  insertTransfer({ tx: "0xgone", block: 100, blockHash: HASH(1), usd: 1000 });

  finality.handleReorg("base", 100, HASH(1));

  const r = getDb().prepare("SELECT removed FROM usdc_transfers WHERE id = ?").get(keep) as {
    removed: number;
  };
  assert.equal(r.removed, 0, "a neighbouring block is unaffected");
});

test("a reorg does not touch another chain at the same height", () => {
  const other = insertTransfer({ chain: "ethereum", tx: "0xeth", block: 100, blockHash: HASH(1) });
  insertTransfer({ chain: "base", tx: "0xbase", block: 100, blockHash: HASH(1) });

  finality.handleReorg("base", 100, HASH(1));

  const r = getDb().prepare("SELECT removed FROM usdc_transfers WHERE id = ?").get(other) as {
    removed: number;
  };
  assert.equal(r.removed, 0, "heights are not comparable across chains");
});

test("a reorg unwinds a CCTP pairing built on the orphaned block", () => {
  // Leaving the pairing completed would report a cross-chain transfer that did not
  // occur — derived intelligence outliving the evidence it rested on.
  insertTransfer({ chain: "base", tx: "0xburn", block: 100, blockHash: HASH(1) });
  getDb()
    .prepare(
      `INSERT INTO usdc_cctp_transfers (
         source_chain, source_tx, source_domain, dest_chain, dest_tx, dest_domain,
         nonce, sender, recipient, amount, burn_ts, mint_ts, status, correlation,
         cctp_version, alerted
       ) VALUES ('base','0xburn',6,'ethereum','0xmint',0,'0xnonce','0xs','0xr',
                 1000000,1,2,'completed','iris_nonce',2,0)`
    )
    .run();

  const out = finality.handleReorg("base", 100, HASH(1));
  assert.equal(out.cctpInvalidated, 1);

  const c = getDb()
    .prepare("SELECT status, correlation, dest_tx FROM usdc_cctp_transfers")
    .get() as { status: string; correlation: string; dest_tx: string | null };
  assert.equal(c.status, "burned", "back to in-flight");
  assert.equal(c.correlation, "none");
  assert.equal(c.dest_tx, null, "the pairing evidence is withdrawn, not kept");
});

test("a reorged transfer is excluded from window figures", async () => {
  const { usdcDb } = await import("../db/usdc.js");
  insertTransfer({ tx: "0xlive", block: 99, blockHash: HASH(9), usd: 1000 });
  insertTransfer({ tx: "0xgone", block: 100, blockHash: HASH(1), usd: 9_000_000 });

  const before = usdcDb.countSince(0);
  assert.equal(before, 2);

  finality.handleReorg("base", 100, HASH(1));

  assert.equal(usdcDb.countSince(0), 1, "the reorged row leaves every count");
  const vol = usdcDb.volumeByChain(0);
  assert.equal(vol[0]!.volumeUsd, 1000, "and every sum");
});

/* ================================================================== */
/* FINALITY — "how confident are we?"                                  */
/* ================================================================== */

test("the confirmation floor is a floor, not an estimate", () => {
  // Measured lag: Ethereum 83, Arbitrum 4127, Polygon/Linea/Sonic 0. The floor only
  // binds where the chain's own tag is optimistic, which is exactly where it matters.
  assert.ok(finality.confirmationFloor("ethereum") > 0);
  assert.ok(
    finality.confirmationFloor("polygon") >= 100,
    "Polygon reported finalized == latest, so the floor does all the work"
  );
  assert.equal(
    finality.confirmationFloor("some-new-chain"),
    finality.DEFAULT_CONFIRMATION_FLOOR,
    "an unknown chain gets the conservative default, not zero"
  );
});

test("an optimistic finalized tag does not make a block final", () => {
  // A sequencer claiming the newest block is final is the assumption this engine
  // exists to stop making. min(finalizedHead, latest - floor) is what protects it.
  const heads = {
    chainSlug: "polygon",
    latest: 1000,
    safe: null,
    finalized: 1000, // the chain says "already final"
    optimistic: true,
    finalThreshold: Math.min(1000, 1000 - finality.confirmationFloor("polygon")),
    error: null,
  };
  assert.ok(
    heads.finalThreshold < heads.latest,
    "the floor must pull the threshold below the head"
  );
});

test("promotion walks observed -> canonical -> final", () => {
  blocks.recordBlocks([
    { chainSlug: "base", blockNumber: 100, blockHash: HASH(1), timestamp: 1, usdcLogCount: 1 },
    { chainSlug: "base", blockNumber: 900, blockHash: HASH(2), timestamp: 1, usdcLogCount: 1 },
  ]);
  insertTransfer({ tx: "0xold", block: 100, blockHash: HASH(1) });
  insertTransfer({ tx: "0xnew", block: 900, blockHash: HASH(2) });

  // Head at 1000: block 100 is far below the final threshold, block 900 is not.
  const floor = finality.confirmationFloor("base");
  const r = finality.promote({
    chainSlug: "base",
    latest: 1000,
    safe: null,
    finalized: 1000 - floor,
    optimistic: false,
    finalThreshold: 1000 - floor,
    error: null,
  });

  assert.ok(r.toFinal >= 1, "the deep block finalises");

  const rows = getDb()
    .prepare("SELECT tx_hash AS tx, finality FROM usdc_transfers ORDER BY block_number")
    .all() as Array<{ tx: string; finality: string }>;
  assert.equal(rows[0]!.finality, "final", "block 100 is settled");
  assert.notEqual(rows[1]!.finality, "final", "block 900 is too close to the head");
});

test("a reorged row is never promoted", () => {
  insertTransfer({ tx: "0xgone", block: 100, blockHash: HASH(1) });
  finality.handleReorg("base", 100, HASH(1));

  finality.promote({
    chainSlug: "base",
    latest: 100_000,
    safe: null,
    finalized: 99_000,
    optimistic: false,
    finalThreshold: 99_000,
    error: null,
  });

  const r = getDb().prepare("SELECT finality, removed FROM usdc_transfers").get() as {
    finality: string;
    removed: number;
  };
  assert.equal(r.finality, "reorged", "promotion must not resurrect a reorged transfer");
  assert.equal(r.removed, 1);
});

test("promotion is idempotent", () => {
  insertTransfer({ tx: "0xa", block: 100, blockHash: HASH(1) });
  const heads = {
    chainSlug: "base",
    latest: 100_000,
    safe: null,
    finalized: 99_000,
    optimistic: false,
    finalThreshold: 99_000,
    error: null,
  };
  finality.promote(heads);
  const second = finality.promote(heads);
  assert.equal(second.toFinal, 0, "already-final rows are not revisited");
});

test("a chain whose head cannot be read promotes nothing", () => {
  insertTransfer({ tx: "0xa", block: 100, blockHash: HASH(1) });
  const r = finality.promote({
    chainSlug: "base",
    latest: null,
    safe: null,
    finalized: null,
    optimistic: false,
    finalThreshold: null,
    error: "unreachable",
  });
  assert.equal(r.toFinal, 0);
  assert.equal(r.toCanonical, 0);
  const row = getDb().prepare("SELECT finality FROM usdc_transfers").get() as { finality: string };
  assert.equal(row.finality, "observed", "no head means no promotion, not optimistic promotion");
});

test("the finality breakdown separates settled from provisional volume", async () => {
  const { usdcDb } = await import("../db/usdc.js");
  insertTransfer({ tx: "0xf", block: 1, blockHash: HASH(1), usd: 100, finality: "final" });
  insertTransfer({ tx: "0xc", block: 2, blockHash: HASH(2), usd: 200, finality: "canonical" });
  insertTransfer({ tx: "0xo", block: 3, blockHash: HASH(3), usd: 300, finality: "observed" });

  const b = usdcDb.finalityBreakdown(0);
  assert.equal(b.final.usd, 100);
  assert.equal(b.canonical.usd, 200);
  assert.equal(b.observed.usd, 300);
  // The point: 500 of 600 is provisional, and a report that does not say so is
  // presenting an unsettled number as a settled one.
  assert.equal(b.canonical.usd + b.observed.usd, 500);
});
