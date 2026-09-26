// Tests for per-address behavioural history.
//
// The point being verified throughout: an address's own past must change the
// verdict on its present. The last test is the one that matters — the same
// transaction, byte for byte, judged against two different histories, must
// come out differently.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "ct-profile-"));
process.env.DATABASE_URL = join(tmp, "test.db");

const { getDb, closeDb } = await import("../../db/index.js");
const { observeTransaction, profileFor, countNovelDestinations, pruneProfiles, profileStats } =
  await import("./addressProfile.js");
const { detectPatterns, assess } = await import("./patterns.js");
const { extractFeatures } = await import("./features.js");
type RawTx = import("./features.js").RawTx;

before(() => { getDb(); });
after(() => {
  closeDb();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows locks */ }
});

const DAY = 86_400_000;

/** A spend of `value` from `from` to `to`. */
function spend(txid: string, from: string, to: string, value: number, nIn = 1, nOut = 1): RawTx {
  return {
    txid,
    vin: Array.from({ length: nIn }, (_, i) => ({
      txid: `${txid}-in${i}`, sequence: 0xffffffff,
      prevout: { value: Math.floor(value / nIn), scriptpubkey_address: from },
    })),
    vout: Array.from({ length: nOut }, (_, i) => ({
      value: Math.floor((value * 0.999) / nOut),
      scriptpubkey_address: i === 0 ? to : `${to}-${i}`,
    })),
    fee: 2000, weight: 1000,
  };
}

/* ------------------------------------------------------------------ */

test("a never-seen address has no profile, rather than an empty one", () => {
  // Null and "all zeros" are different claims. Zeros would read as a quiet
  // address; null reads as an unknown one, and only one of those is true.
  assert.equal(profileFor("bc1qnever"), null);
});

test("observing a spend creates a profile for sender and recipient", () => {
  const ts = Date.UTC(2026, 0, 1);
  const r = observeTransaction(spend("t1", "bc1qalice", "bc1qbob", 10e8), ts);
  assert.equal(r.spenders, 1);
  assert.ok(r.receivers >= 1);
  const alice = profileFor("bc1qalice")!;
  assert.equal(alice.observations, 1);
  assert.equal(alice.lastSpendAt, ts);
  // One observation is not a baseline: a median of one point is that point.
  assert.equal(alice.spendBaseline, null);
});

test("a receiving address is recorded but has no spend history", () => {
  const bob = profileFor("bc1qbob")!;
  assert.equal(bob.observations, 0);
  assert.equal(bob.lastSpendAt, null, "receiving is not spending");
});

test("baselines appear once there are enough observations", () => {
  let ts = Date.UTC(2026, 0, 2);
  for (let i = 0; i < 8; i++) {
    observeTransaction(spend(`t2-${i}`, "bc1qregular", `bc1qdest${i}`, 5e8 + i * 1e7), ts);
    ts += DAY;
  }
  const p = profileFor("bc1qregular")!;
  assert.equal(p.observations, 8);
  assert.ok(p.spendBaseline, "eight spends is enough for a median");
  assert.ok(p.gapBaseline, "gaps between them give an activity rhythm");
  // Spends were roughly 5 BTC; the median must land there, not at the extreme.
  const medianBtc = p.spendBaseline.median / 1e8;
  assert.ok(medianBtc > 4.9 && medianBtc < 5.5, `median was ${medianBtc} BTC`);
  // Gaps were one day each.
  assert.ok(Math.abs(p.gapBaseline.median - DAY) < 1000, `gap median ${p.gapBaseline.median}`);
});

test("gaps are measured between consecutive spends, and the first has none", () => {
  // A gap needs two points. Recording zero for the first spend would teach the
  // baseline that this address normally spends with no delay at all.
  const rows = getDb()
    .prepare("SELECT gap_ms FROM btc_address_spends WHERE address = ? ORDER BY id")
    .all("bc1qregular") as Array<{ gap_ms: number | null }>;
  assert.equal(rows[0]!.gap_ms, null);
  assert.ok(rows.slice(1).every((r) => r.gap_ms !== null && r.gap_ms > 0));
});

test("drain ratio is recorded from the pre-spend balance", () => {
  const ts = Date.UTC(2026, 1, 1);
  // Spends 30 BTC and 70 BTC remains, so 30% of a 100 BTC balance left.
  observeTransaction(spend("t3", "bc1qdrainer", "bc1qelsewhere", 30e8), ts, {
    balanceOf: () => 70e8,
  });
  const row = getDb()
    .prepare("SELECT drain_ratio FROM btc_address_spends WHERE address = ?")
    .get("bc1qdrainer") as { drain_ratio: number };
  assert.ok(Math.abs(row.drain_ratio - 0.3) < 0.001, `ratio was ${row.drain_ratio}`);
});

test("an unreadable balance leaves the drain ratio null, not zero", () => {
  const ts = Date.UTC(2026, 1, 2);
  observeTransaction(spend("t4", "bc1qnobalance", "bc1qsomewhere", 5e8), ts, {
    balanceOf: () => null,
  });
  const row = getDb()
    .prepare("SELECT drain_ratio FROM btc_address_spends WHERE address = ?")
    .get("bc1qnobalance") as { drain_ratio: number | null };
  assert.equal(row.drain_ratio, null, "not measured must not read as drained nothing");
});

test("counterparties accumulate and novelty is computed against them", () => {
  let ts = Date.UTC(2026, 2, 1);
  for (const dest of ["bc1qx", "bc1qy", "bc1qz"]) {
    observeTransaction(spend(`t5-${dest}`, "bc1qsocial", dest, 1e8), ts);
    ts += DAY;
  }
  const p = profileFor("bc1qsocial")!;
  assert.ok(p.counterparties >= 3, `counterparties was ${p.counterparties}`);

  const known = countNovelDestinations("bc1qsocial", ["bc1qx", "bc1qy"]);
  assert.equal(known.novel, 0, "already-paid destinations are not novel");
  const mixed = countNovelDestinations("bc1qsocial", ["bc1qx", "bc1qbrandnew"]);
  assert.equal(mixed.novel, 1);
  assert.equal(mixed.total, 2);
});

test("change returning to the sender is not counted as a counterparty", () => {
  const ts = Date.UTC(2026, 2, 20);
  const selfChange: RawTx = {
    txid: "t6",
    vin: [{ txid: "t6-in", sequence: 0xffffffff, prevout: { value: 10e8, scriptpubkey_address: "bc1qself" } }],
    vout: [
      { value: 4e8, scriptpubkey_address: "bc1qpayee" },
      { value: 5.9e8, scriptpubkey_address: "bc1qself" },
    ],
    fee: 1000, weight: 800,
  };
  observeTransaction(selfChange, ts);
  const rows = getDb()
    .prepare("SELECT counterparty FROM btc_counterparties WHERE address = ?")
    .all("bc1qself") as Array<{ counterparty: string }>;
  assert.ok(!rows.some((r) => r.counterparty === "bc1qself"), "paying yourself is not a relationship");
  assert.ok(rows.some((r) => r.counterparty === "bc1qpayee"));
});

test("the spend ring is bounded per address, keeping the newest", () => {
  let ts = Date.UTC(2026, 3, 1);
  for (let i = 0; i < 30; i++) {
    observeTransaction(spend(`t7-${i}`, "bc1qbusy", `bc1qd${i}`, 1e8 + i), ts);
    ts += 3_600_000;
  }
  pruneProfiles(10, 500);
  const rows = getDb()
    .prepare("SELECT value_sats FROM btc_address_spends WHERE address = ? ORDER BY id DESC")
    .all("bc1qbusy") as Array<{ value_sats: number }>;
  assert.equal(rows.length, 10);
  // The newest spend was the largest, so keeping the newest keeps it.
  assert.equal(rows[0]!.value_sats, 1e8 + 29);
});

test("pruning one busy address does not touch a quiet one", () => {
  // The reason the ring is bounded per address rather than globally: the cold
  // wallet is where the signal is, and a busy exchange must not evict it.
  const before = getDb()
    .prepare("SELECT COUNT(*) n FROM btc_address_spends WHERE address = ?")
    .get("bc1qregular") as { n: number };
  pruneProfiles(10, 500);
  const after = getDb()
    .prepare("SELECT COUNT(*) n FROM btc_address_spends WHERE address = ?")
    .get("bc1qregular") as { n: number };
  assert.equal(after.n, before.n);
});

test("profile stats report coverage honestly", () => {
  const s = profileStats();
  assert.ok(s.addresses > 0);
  assert.ok(s.withHistory <= s.addresses, "cannot have more histories than addresses");
});

/* ------------------------------------------------------------------ */
/* The point of the whole module                                       */
/* ------------------------------------------------------------------ */

test("the SAME transaction is judged differently by two different histories", () => {
  const now = Date.UTC(2026, 5, 1);

  // A busy address: spends about this much, every day, right up to now.
  // The window must END at `now` — an earlier draft ran 60 days from 200 days
  // ago, which left the "busy" wallet 141 days silent and therefore dormant by
  // its own standards. It scored high for exactly the right reason, against a
  // fixture that did not describe what it claimed to.
  let ts = now - 60 * DAY;
  for (let i = 0; i < 60; i++) {
    // Balance left behind is ~80 BTC against a ~20 BTC spend, so this wallet
    // routinely moves about a fifth of what it holds. An earlier draft left
    // 2,000 BTC behind, making its habitual drain 1.1% — against which the 20%
    // test transaction was genuinely 18x abnormal, and the engine said so
    // correctly. The fixture, not the engine, was failing to describe a wallet
    // for which this transaction is ordinary.
    observeTransaction(spend(`busy-${i}`, "bc1qhotwallet", `bc1qcustomer${i}`, 20e8 + (i % 7) * 1e8), ts, {
      balanceOf: () => 80e8,
    });
    ts += DAY;
  }

  // A quiet address: six small spends, years apart.
  ts = now - 6 * 365 * DAY;
  for (let i = 0; i < 6; i++) {
    observeTransaction(spend(`quiet-${i}`, "bc1qcoldwallet", `bc1qfriend${i}`, 0.05e8), ts, {
      balanceOf: () => 100e8,
    });
    ts += 300 * DAY;
  }

  const busy = profileFor("bc1qhotwallet")!;
  const cold = profileFor("bc1qcoldwallet")!;
  assert.ok(busy.gapBaseline && cold.gapBaseline, "both need an activity rhythm");
  assert.ok(
    cold.gapBaseline.median > busy.gapBaseline.median * 50,
    "the cold wallet's normal silence must be far longer",
  );

  // One transaction, evaluated against each history.
  const tx = spend("judgeme", "bc1qsubject", "bc1qbrandnewdest", 20e8);
  const features = extractFeatures(tx);
  const common = { tx, features, now, balanceBefore: 100e8 };

  const busyRisk = assess(detectPatterns({ ...common, senderProfile: busy })).risk;
  const coldRisk = assess(detectPatterns({ ...common, senderProfile: cold })).risk;

  assert.ok(
    coldRisk > busyRisk,
    `identical transaction: cold ${coldRisk} must outrank busy ${busyRisk}`,
  );
});

test("history raises confidence even when risk is unchanged", () => {
  const now = Date.UTC(2026, 5, 1);
  const tx = spend("conf", "bc1qsubject2", "bc1qdest", 5e8);
  const common = { tx, features: extractFeatures(tx), now, balanceBefore: 50e8 };
  const none = assess(detectPatterns({ ...common, senderProfile: null }));
  const known = assess(detectPatterns({ ...common, senderProfile: profileFor("bc1qhotwallet") }));
  assert.ok(
    known.confidence >= none.confidence,
    `a known address must not be less certain: ${none.confidence} → ${known.confidence}`,
  );
});
