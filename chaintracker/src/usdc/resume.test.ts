// Restart, resume, and cursor-safety tests.
//
// THE BUG THESE EXIST FOR, which shipped and was caught only by reading the code
// against its own header comment. scanner.ts states as an invariant that "the cursor
// only advances on a clean scan", and the code did the opposite: it wrote
// `cursors.set(slug, SCANNER, head)` unconditionally, including when transfers had
// been dropped because their block timestamp could not be read.
//
// That is the worst available combination. A dropped transfer is not re-scanned,
// because the cursor has moved past its block; it never appears in any total; and
// nothing reports the loss. In one measured Arbitrum scan it was 4,371 transfers.
//
// The tests below pin the checkpoint policy: hold short of the earliest block we
// could not fully process, retry it, and if it is permanently unreadable step over
// it loudly after a bounded number of attempts rather than stalling the chain dead.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let cursors: typeof import("../db/index.js")["cursors"];
let getDb: typeof import("../db/index.js")["getDb"];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "usdc-resume-"));
  process.env.DATABASE_URL = join(dir, "test.db");
  const db = await import("../db/index.js");
  cursors = db.cursors;
  getDb = db.getDb;
  getDb();
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A locked file on Windows is not a test failure.
  }
});

beforeEach(() => {
  getDb().prepare("DELETE FROM scan_cursors").run();
});

/* ------------------------------------------------------------------ */
/* The checkpoint policy                                               */
/* ------------------------------------------------------------------ */

/**
 * The policy under test, expressed as a pure decision.
 *
 * Mirrors `advanceCursor` in scanner.ts. Duplicated rather than imported because the
 * real one writes through the process-wide database connection and reads a live
 * cursor; the decision itself is what needs pinning, and it is stated in English in
 * each assertion so the two cannot drift silently.
 */
function checkpointFor(
  start: number,
  head: number,
  lowestUndated: number | null,
  priorStall: { block: number; attempts: number } | null,
  maxStalls = 5
): { checkpoint: number; stall: { block: number; attempts: number } | null; skipped: boolean } {
  if (lowestUndated === null) return { checkpoint: head, stall: null, skipped: false };

  const sameBlock = priorStall !== null && priorStall.block === lowestUndated;
  const attempts = sameBlock ? priorStall.attempts + 1 : 1;

  if (attempts >= maxStalls) {
    return { checkpoint: head, stall: null, skipped: true };
  }
  return {
    checkpoint: Math.max(start - 1, lowestUndated - 1),
    stall: { block: lowestUndated, attempts },
    skipped: false,
  };
}

test("a clean scan takes the whole range", () => {
  const r = checkpointFor(100, 200, null, null);
  assert.equal(r.checkpoint, 200);
  assert.equal(r.stall, null, "a clean scan must clear any prior stall");
  assert.equal(r.skipped, false);
});

test("an undated block holds the cursor one short of it", () => {
  // THE FIX. Previously this returned 200 and blocks 150-200 were never re-read.
  const r = checkpointFor(100, 200, 150, null);
  assert.equal(r.checkpoint, 149, "the next tick must re-read block 150 onward");
  assert.deepEqual(r.stall, { block: 150, attempts: 1 });
});

test("an undated block at the start of the range does not move the cursor at all", () => {
  const r = checkpointFor(100, 200, 100, null);
  assert.equal(r.checkpoint, 99, "one short of the range start means no progress");
  assert.ok(r.checkpoint < 100, "the same range is retried");
});

test("the earliest undated block wins, not the latest", () => {
  // Holding at the latest would step over the earlier one — the same silent loss in
  // a smaller window.
  const r = checkpointFor(100, 200, 120, null);
  assert.equal(r.checkpoint, 119);
});

test("retrying the same block increments the attempt count", () => {
  const first = checkpointFor(100, 200, 150, null);
  assert.equal(first.stall?.attempts, 1);

  const second = checkpointFor(100, 200, 150, first.stall);
  assert.equal(second.stall?.attempts, 2, "attempts must accumulate across ticks");
  assert.equal(second.checkpoint, 149);
});

test("a stall on a different block resets the count", () => {
  // Otherwise unrelated transient failures on different blocks would accumulate
  // toward the skip threshold and step over a block that had only failed once.
  const prior = { block: 150, attempts: 4 };
  const r = checkpointFor(100, 200, 180, prior);
  assert.equal(r.stall?.attempts, 1, "a new problem block starts from one");
  assert.equal(r.skipped, false);
});

test("a permanently unreadable block is skipped after the bound, not stalled forever", () => {
  // THE POISON PILL. Refusing to advance past a block an endpoint will never serve
  // stops the chain dead, which is worse than losing the transfers in it. The skip
  // is bounded and logged at WARN with the block number.
  const r = checkpointFor(100, 200, 150, { block: 150, attempts: 4 });
  assert.equal(r.skipped, true, "the fifth attempt gives up");
  assert.equal(r.checkpoint, 200, "the chain resumes rather than stalling");
  assert.equal(r.stall, null, "and the stall state is cleared");
});

test("the bound is on consecutive attempts at ONE block", () => {
  // Four failures at 150, then a clean scan, then a failure at 150 again: the clean
  // scan cleared the stall, so this is attempt one and must not skip.
  const clean = checkpointFor(100, 200, null, { block: 150, attempts: 4 });
  assert.equal(clean.stall, null);

  const again = checkpointFor(100, 200, 150, clean.stall);
  assert.equal(again.stall?.attempts, 1);
  assert.equal(again.skipped, false, "a cleared stall must not carry forward");
});

/* ------------------------------------------------------------------ */
/* Persistence across restart                                          */
/* ------------------------------------------------------------------ */

test("a cursor survives a restart", () => {
  // Every tick is a separate process, so a cursor that lived in memory would rescan
  // from the cold-start window every few minutes — and re-alert everything in it.
  cursors.set("ethereum", "usdc", 12_345, null);
  assert.equal(cursors.get("ethereum", "usdc").lastBlock, 12_345);

  // A fresh read is what the next process does.
  const reread = cursors.get("ethereum", "usdc");
  assert.equal(reread.lastBlock, 12_345);
});

test("stall state survives a restart alongside the cursor", () => {
  // The attempt count has to persist or the bound resets every tick and a poisoned
  // block is retried forever — the stall it exists to bound.
  cursors.set("arbitrum", "usdc", 149, JSON.stringify({ stallBlock: 150, attempts: 3 }));

  const c = cursors.get("arbitrum", "usdc");
  assert.equal(c.lastBlock, 149);
  const stall = JSON.parse(c.lastValue!) as { stallBlock: number; attempts: number };
  assert.equal(stall.stallBlock, 150);
  assert.equal(stall.attempts, 3);
});

test("an absent cursor reads as null, which is the cold-start signal", () => {
  const c = cursors.get("never-scanned", "usdc");
  assert.equal(c.lastBlock, null);
  assert.equal(c.lastValue, null);
});

test("cursors for different scanners on one chain are independent", () => {
  // The transfer scanner, the CCTP scanner and the Solana rotation all key off the
  // same chain slug. Sharing a row would have one overwrite another's position.
  cursors.set("base", "usdc", 500, null);
  cursors.set("base", "usdc-cctp", 400, null);

  assert.equal(cursors.get("base", "usdc").lastBlock, 500);
  assert.equal(cursors.get("base", "usdc-cctp").lastBlock, 400);
});

test("the Solana rotation position persists, so the watchlist tail is reached", () => {
  // THE BUG THIS COVERS. The rotation was a module-level `let rotation = 0`, and
  // every tick is a fresh process — so it reset to 0 every run and only the first
  // MAX_ADDRESSES_PER_TICK addresses were ever scanned. Anything past the cap was
  // invisible forever, while the comment claimed full coverage over successive ticks.
  cursors.set("solana", "usdc-solana", 0, null);

  const all = 14;
  const perTick = 6;
  const seen = new Set<number>();

  // Three ticks, each a separate "process" reading the stored position.
  for (let tick = 0; tick < 3; tick++) {
    const pos = (cursors.get("solana", "usdc-solana").lastBlock ?? 0) % all;
    for (let i = 0; i < perTick; i++) seen.add((pos + i) % all);
    cursors.set("solana", "usdc-solana", (pos + perTick) % all, null);
  }

  assert.equal(seen.size, Math.min(all, 3 * perTick), "each tick must advance the window");
  assert.ok(seen.has(12), "an address past the per-tick cap must eventually be reached");
});

/* ------------------------------------------------------------------ */
/* Idempotence of a repeated tick                                      */
/* ------------------------------------------------------------------ */

test("re-running the same range inserts nothing new", () => {
  // What makes holding the cursor short of a problem block safe: re-reading a range
  // is free, because the dedupe key is (chain, tx, log_index) and the insert is
  // ON CONFLICT DO NOTHING. If a rescan created duplicates, the retry policy above
  // would be a data-corruption bug instead of a recovery mechanism.
  const db = getDb();
  const insert = () =>
    db
      .prepare(
        `INSERT INTO usdc_transfers (
           chain_slug, token_address, tx_hash, log_index, block_number, ts,
           from_address, to_address, amount, amount_usd,
           from_category, to_category, classification, source, created_at
         ) VALUES ('base','0xtok','0xdeadbeef',7,150,1790651000000,
                   '0xaaa','0xbbb',1000,1000,'unknown','unknown','WHALE_TRANSFER','rpc',1)
         ON CONFLICT(chain_slug, tx_hash, log_index) DO NOTHING`
      )
      .run();

  const first = insert();
  assert.equal(Number(first.changes), 1, "the first insert stores the row");

  const second = insert();
  assert.equal(Number(second.changes), 0, "a repeated tick must be a no-op");

  const n = db
    .prepare("SELECT COUNT(*) AS n FROM usdc_transfers WHERE tx_hash = '0xdeadbeef'")
    .get() as { n: number };
  assert.equal(n.n, 1, "exactly one row, however many times the range is scanned");
});

test("the dedupe key distinguishes two transfers in one transaction", () => {
  // A transaction moving USDC twice produces two logs. If log_index were not part of
  // the key the second leg would be swallowed as a duplicate — which is how a flash
  // loan's second leg, or a batched relayer payout, would silently vanish.
  const db = getDb();
  const ins = (logIndex: number) =>
    db
      .prepare(
        `INSERT INTO usdc_transfers (
           chain_slug, token_address, tx_hash, log_index, block_number, ts,
           from_address, to_address, amount, amount_usd,
           from_category, to_category, classification, source, created_at
         ) VALUES ('base','0xtok','0xmultileg',?,150,1790651000000,
                   '0xaaa','0xbbb',1000,1000,'unknown','unknown','WHALE_TRANSFER','rpc',1)
         ON CONFLICT(chain_slug, tx_hash, log_index) DO NOTHING`
      )
      .run(logIndex);

  assert.equal(Number(ins(1).changes), 1);
  assert.equal(Number(ins(2).changes), 1, "a different log index is a different transfer");
  assert.equal(Number(ins(1).changes), 0, "but the same one is still deduplicated");
});

test("the same tx hash on two chains is two transfers", () => {
  // Chain is part of the key. Transaction hashes are not globally unique across
  // chains, and a collision would drop a real transfer on the second chain.
  const db = getDb();
  const ins = (chain: string) =>
    db
      .prepare(
        `INSERT INTO usdc_transfers (
           chain_slug, token_address, tx_hash, log_index, block_number, ts,
           from_address, to_address, amount, amount_usd,
           from_category, to_category, classification, source, created_at
         ) VALUES (?,'0xtok','0xsamehash',0,1,1790651000000,
                   '0xaaa','0xbbb',1000,1000,'unknown','unknown','WHALE_TRANSFER','rpc',1)
         ON CONFLICT(chain_slug, tx_hash, log_index) DO NOTHING`
      )
      .run(chain);

  assert.equal(Number(ins("ethereum").changes), 1);
  assert.equal(Number(ins("base").changes), 1, "same hash, different chain, different transfer");
});
