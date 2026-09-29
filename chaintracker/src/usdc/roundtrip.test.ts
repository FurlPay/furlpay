// Pass-through suppression, against a real in-memory database.
//
// WHY THESE ARE DB TESTS AND NOT PURE-FUNCTION TESTS. The bug they cover was
// invisible to every pure test in this suite: `suppressionReason` correctly passed
// every leg, because each leg IS a real transfer that individually clears every
// rule. The inflation only exists in the relationship between rows, so only a query
// can see it.
//
// Every figure below is one actually observed in the first two live ticks that
// posted to Discord:
//
//   $243,777,790  0xf1ed… <-> 0x3117…, two transactions              posted 2x
//   $228,105,276  0xbbbb… <-> 0x30cc…, ONE transaction               posted 2x
//                 (log #2774 and #2792 — a flash loan)
//   $24,400,000   Coinbase Prime -> 0x16f6… -> 0x3284… -> 0xee7a…    posted 3x
//   $9,999,999    Circle issuance -> 0xe69f… -> 0xee7a… -> 0x1dc0…   posted 4x
//
// The $24.4M chain alone claimed $73.2M of whale movement for a single Coinbase
// Prime withdrawal, and each of the three alerts read as entirely legitimate.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { MIGRATIONS } from "../db/schema.js";

/**
 * The predecessor query, run against a throwaway database.
 *
 * Mirrors `usdcDb.precedingLeg`. Duplicated rather than imported because the real
 * one reads the process-wide connection and these tests must not touch the
 * developer's actual chaintracker.db. The assertions below state the SEMANTICS in
 * English, which is the part that must not drift.
 */
function precedingLeg(
  db: DatabaseSync,
  t: {
    chainSlug: string;
    fromAddress: string;
    toAddress: string;
    amountUsd: number;
    timestamp: number;
    id?: number;
  },
  windowMs: number
): { id: number; txHash: string; fromAddress: string; isReversal: boolean } | null {
  const lo = t.amountUsd * 0.995;
  const hi = t.amountUsd * 1.005;
  const row = db
    .prepare(
      `SELECT id, tx_hash AS txHash, from_address AS fromAddress
         FROM usdc_transfers
        WHERE chain_slug = ?
          AND lower(to_address) = lower(?)
          AND amount_usd BETWEEN ? AND ?
          AND ts BETWEEN ? AND ?
          AND (? IS NULL OR id != ?)
        ORDER BY ts ASC, id ASC LIMIT 1`
    )
    .get(
      t.chainSlug,
      t.fromAddress,
      lo,
      hi,
      t.timestamp - windowMs,
      t.timestamp + 1_000,
      t.id ?? null,
      t.id ?? null
    ) as { id: number; txHash: string; fromAddress: string } | undefined;
  if (!row) return null;
  return {
    ...row,
    isReversal: row.fromAddress.toLowerCase() === t.toAddress.toLowerCase(),
  };
}

const WINDOW = 15 * 60 * 1000;
const T0 = 1_790_651_000_000;

let db: DatabaseSync;

function insert(o: {
  tx: string;
  logIndex?: number;
  from: string;
  to: string;
  usd: number;
  ts?: number;
  chain?: string;
}): number {
  db.prepare(
    `INSERT INTO usdc_transfers (
       chain_slug, token_address, tx_hash, log_index, block_number, ts,
       from_address, to_address, amount, amount_usd,
       from_category, to_category, classification, source, created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,'unknown','unknown','WHALE_TRANSFER','rpc',?)`
  ).run(
    o.chain ?? "ethereum",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    o.tx,
    o.logIndex ?? 0,
    1,
    o.ts ?? T0,
    o.from,
    o.to,
    o.usd,
    o.usd,
    Date.now()
  );
  return Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
}

const addr = (prefix: string) => (prefix + "0".repeat(42)).slice(0, 42);

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const m of MIGRATIONS) db.exec(m.sql);
});

/* ------------------------------------------------------------------ */
/* Hop chains                                                          */
/* ------------------------------------------------------------------ */

test("only the first leg of a hop chain has no predecessor", () => {
  // The real $24,400,000 chain: Coinbase Prime withdraws, then the money is
  // relayed twice more. One movement, previously posted three times.
  const PRIME = addr("0xa9d1e08c");
  const H1 = addr("0x16f6d153");
  const H2 = addr("0x3284ac10");
  const H3 = addr("0xee7ae85f");
  const USD = 24_400_000;

  const leg1 = insert({ tx: "0xeeb475e51c27", from: PRIME, to: H1, usd: USD, ts: T0 });
  const leg2 = insert({ tx: "0xd2702527453a", from: H1, to: H2, usd: USD, ts: T0 + 132_000 });
  insert({ tx: "0x5fc627509cc4", from: H2, to: H3, usd: USD, ts: T0 + 288_000 });

  // Leg 1 posts: nothing sent $24.4M to Coinbase Prime in the window.
  assert.equal(
    precedingLeg(db, { chainSlug: "ethereum", fromAddress: PRIME, toAddress: H1, amountUsd: USD, timestamp: T0, id: leg1 }, WINDOW),
    null,
    "the originating leg must still be reported"
  );

  // Legs 2 and 3 are continuations and must be suppressed.
  const p2 = precedingLeg(db, { chainSlug: "ethereum", fromAddress: H1, toAddress: H2, amountUsd: USD, timestamp: T0 + 132_000, id: leg2 }, WINDOW);
  assert.ok(p2, "leg 2 should find leg 1");
  assert.equal(p2.id, leg1);
  assert.equal(p2.isReversal, false, "a hop chain is not a round trip");

  const p3 = precedingLeg(db, { chainSlug: "ethereum", fromAddress: H2, toAddress: H3, amountUsd: USD, timestamp: T0 + 288_000 }, WINDOW);
  assert.ok(p3, "leg 3 should find leg 2");
  assert.equal(p3.id, leg2);
});

test("a chain starting from Circle issuance is suppressed from the second leg", () => {
  // The real $9,999,999 chain. The mint itself is already suppressed as issuance;
  // the three onward hops must not each post as a whale transfer.
  const ZERO = "0x0000000000000000000000000000000000000000";
  const A = addr("0xe69f81b8");
  const B = addr("0xee7ae85f");
  const C = addr("0x1dc07382");
  const USD = 9_999_999;

  const mint = insert({ tx: "0x777ec7d98b2f", from: ZERO, to: A, usd: USD, ts: T0 });
  insert({ tx: "0x38b7b75365dd", from: A, to: B, usd: USD, ts: T0 + 108_000 });

  const p = precedingLeg(db, { chainSlug: "ethereum", fromAddress: A, toAddress: B, amountUsd: USD, timestamp: T0 + 108_000 }, WINDOW);
  assert.ok(p, "the first onward hop should find the mint");
  assert.equal(p.id, mint);

  const p2 = precedingLeg(db, { chainSlug: "ethereum", fromAddress: B, toAddress: C, amountUsd: USD, timestamp: T0 + 200_000 }, WINDOW);
  assert.ok(p2, "the second onward hop should find the first");
});

/* ------------------------------------------------------------------ */
/* Round trips                                                         */
/* ------------------------------------------------------------------ */

test("a round trip is recognised as a reversal, not merely a hop", () => {
  // The real $243,777,790 pair, in two separate transactions. Nothing moved.
  const A = addr("0xf1edbf98");
  const B = addr("0x31173ed1");
  const USD = 243_777_790;

  const outbound = insert({ tx: "0x141574234d892618", logIndex: 516, from: B, to: A, usd: USD, ts: T0 });
  const p = precedingLeg(db, { chainSlug: "ethereum", fromAddress: A, toAddress: B, amountUsd: USD, timestamp: T0 + 60_000 }, WINDOW);

  assert.ok(p);
  assert.equal(p.id, outbound);
  assert.equal(p.isReversal, true, "sender and recipient are swapped — nothing moved");
});

test("a flash loan's legs share a transaction and still pair", () => {
  // The real $228,105,276 pair: same tx, log #2774 and #2792. Both legs carry the
  // SAME block timestamp, which is why the query allows a second of forward slack.
  const POOL = addr("0xbbbbbbbb");
  const TAKER = addr("0x30cc3e3a");
  const TX = "0x8c688e7c1e719f86";
  const USD = 228_105_276;

  const first = insert({ tx: TX, logIndex: 2774, from: POOL, to: TAKER, usd: USD, ts: T0, chain: "base" });
  const p = precedingLeg(db, { chainSlug: "base", fromAddress: TAKER, toAddress: POOL, amountUsd: USD, timestamp: T0 }, WINDOW);

  assert.ok(p, "an identical timestamp must not hide the predecessor");
  assert.equal(p.id, first);
  assert.equal(p.txHash, TX);
  assert.equal(p.isReversal, true);
});

/* ------------------------------------------------------------------ */
/* What must NOT be suppressed                                         */
/* ------------------------------------------------------------------ */

test("one sender fanning out to several recipients keeps every leg", () => {
  // The third pattern in that live tick: 0x5695… sent $175.6M to two different
  // addresses. Two real movements — suppressing either would under-report.
  const SENDER = addr("0x56957e41");
  const R1 = addr("0x31173ed1");
  const R2 = addr("0x98c23e9d");
  const USD = 175_600_000;

  insert({ tx: "0x8a5df52a", from: SENDER, to: R1, usd: USD, ts: T0 });

  const second = precedingLeg(db, { chainSlug: "ethereum", fromAddress: SENDER, toAddress: R2, amountUsd: USD, timestamp: T0 + 60_000 }, WINDOW);
  assert.equal(second, null, "nothing fed the sender, so this is its own movement");
});

test("a one-way transfer has no predecessor", () => {
  const A = addr("0x11111111");
  const B = addr("0x22222222");
  insert({ tx: "0xaaa", from: A, to: B, usd: 5_000_000, ts: T0 });

  assert.equal(
    precedingLeg(db, { chainSlug: "ethereum", fromAddress: A, toAddress: B, amountUsd: 5_000_000, timestamp: T0 }, WINDOW),
    null
  );
});

test("a row never pairs with itself", () => {
  // A self-transfer would otherwise match its own reversal and be suppressed on
  // the strength of its own existence.
  const SELF = addr("0x44444444");
  const id = insert({ tx: "0xbbb", from: SELF, to: SELF, usd: 1_000_000, ts: T0 });

  assert.equal(
    precedingLeg(db, { chainSlug: "ethereum", fromAddress: SELF, toAddress: SELF, amountUsd: 1_000_000, timestamp: T0, id }, WINDOW),
    null
  );
});

test("a later transfer is never treated as the predecessor of an earlier one", () => {
  // Order matters: if the future could feed the past, both legs of every chain
  // would find each other and the whole movement would vanish from the channel.
  const A = addr("0x77777777");
  const B = addr("0x88888888");
  const C = addr("0x99999999");
  insert({ tx: "0xlate", from: A, to: B, usd: 3_000_000, ts: T0 + 5 * 60_000 });

  assert.equal(
    precedingLeg(db, { chainSlug: "ethereum", fromAddress: B, toAddress: C, amountUsd: 3_000_000, timestamp: T0 }, WINDOW),
    null,
    "a predecessor two minutes in the future is not a predecessor"
  );
});

/* ------------------------------------------------------------------ */
/* Bounds                                                              */
/* ------------------------------------------------------------------ */

test("the pairing tolerates a fee-sized difference but not a real one", () => {
  const A = addr("0x55555555");
  const B = addr("0x66666666");
  insert({ tx: "0xccc", from: B, to: A, usd: 10_000_000, ts: T0 });

  const back = (usd: number) =>
    precedingLeg(db, { chainSlug: "ethereum", fromAddress: A, toAddress: B, amountUsd: usd, timestamp: T0 + 1000 }, WINDOW);

  assert.ok(back(10_000_000), "exact should pair");
  assert.ok(back(9_980_000), "0.2% less should pair — a fee, not a different transfer");
  assert.equal(back(9_000_000), null, "10% less is a different transfer");
  assert.equal(back(20_000_000), null);
});

test("legs further apart than the window do not pair", () => {
  const A = addr("0x77777777");
  const B = addr("0x88888888");
  insert({ tx: "0xddd", from: B, to: A, usd: 3_000_000, ts: T0 });

  const later = (offsetMs: number) =>
    precedingLeg(db, { chainSlug: "ethereum", fromAddress: A, toAddress: B, amountUsd: 3_000_000, timestamp: T0 + offsetMs }, WINDOW);

  assert.ok(later(5 * 60 * 1000), "5 minutes later is one movement");
  assert.equal(later(4 * 60 * 60 * 1000), null, "hours apart are two movements");
});

test("pairing does not cross chains", () => {
  const A = addr("0x99999999");
  const B = addr("0xaaaaaaaa");
  insert({ tx: "0xeee", from: B, to: A, usd: 7_000_000, ts: T0, chain: "base" });

  assert.equal(
    precedingLeg(db, { chainSlug: "ethereum", fromAddress: A, toAddress: B, amountUsd: 7_000_000, timestamp: T0 + 1000 }, WINDOW),
    null,
    "conflating chains is how a cross-chain transfer gets wrongly cancelled"
  );
});

/* ------------------------------------------------------------------ */
/* Staleness                                                           */
/* ------------------------------------------------------------------ */

test("retiring stale candidates marks them without deleting them", () => {
  // The aggregates must still see them: the daily roll-up is computed from all
  // observed transfers, not the posted ones.
  const A = addr("0xbbbb1111");
  const B = addr("0xcccc2222");
  insert({ tx: "0xf01", from: A, to: B, usd: 2_000_000, ts: T0 - 4 * 60 * 60 * 1000 });
  insert({ tx: "0xf02", from: A, to: B, usd: 2_000_000, ts: T0 });

  const changed = db
    .prepare("UPDATE usdc_transfers SET alerted = 1 WHERE alerted = 0 AND ts < ?")
    .run(T0 - 30 * 60 * 1000);
  assert.equal(Number(changed.changes), 1, "only the stale row is retired");

  const total = db.prepare("SELECT COUNT(*) AS n FROM usdc_transfers").get() as { n: number };
  assert.equal(total.n, 2, "retiring must not delete");

  const pending = db.prepare("SELECT COUNT(*) AS n FROM usdc_transfers WHERE alerted = 0").get() as { n: number };
  assert.equal(pending.n, 1);
});
