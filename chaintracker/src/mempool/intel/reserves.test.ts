// Tests for the drain detector, replayed against the real Liquid transaction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { detectDrain, indexWatchlist, matchFlagged, type Watchlist } from "./reserves.js";
import { extractFeatures, type RawTx } from "./features.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(HERE, "fixtures", "liquid-2026-09-06.json"), "utf8"),
) as { liquidDrain: RawTx; liquidReturn: RawTx };

const FEDERATION = "bc1qdlld6antmv4xug242ed83q7k4rqw50cwfns38szx4qu2f4jwaxxsuhwxxr";

// The address the drained funds actually landed on. Verified on chain: it
// received exactly 3,996.02 BTC, forwarded all of it, and holds nothing across
// just two transactions — a pass-through hop, not a destination.
//
// This is deliberately NOT the address public reporting named as the
// attacker's wallet. That one is bc1ql4mfu6…, which appears in the RETURN
// transaction's inputs rather than the drain's outputs, and holds 598.50 BTC —
// matching the retained amount in the reporting exactly. Taking the reported
// address on trust would have produced a flagged-address rule that never fires
// on the transaction it was written for.
const HOP = "bc1qgslsydz56d0ed6827hdemfmk5w2f6ldyc6wt7p";
const ATTACKER = "bc1ql4mfu6aundtkksxklfajs2h3t9nzcd6gyqjlte";

const list: Watchlist = {
  reserves: [{
    address: FEDERATION, label: "Liquid Federation", category: "sidechain-federation",
    note: null, source: null, alertFraction: 0.1,
  }],
  flagged: [
    { address: HOP, label: "Liquid exploit — first hop", category: "exploit-proceeds",
      note: null, source: null, alertFraction: 0 },
    { address: ATTACKER, label: "Liquid exploit — attacker wallet", category: "exploit-proceeds",
      note: null, source: null, alertFraction: 0 },
  ],
  watch: [],
  loadedAt: Date.now(), path: null, error: null,
};
const index = indexWatchlist(list);

test("the drain is detected and sized correctly", () => {
  // After the spend the federation held ~197 BTC, per public reporting.
  const balanceAfter = 197e8;
  const found = detectDrain(fixture.liquidDrain, index, () => balanceAfter);
  assert.equal(found.length, 1);
  const d = found[0]!;
  assert.equal(d.entry.label, "Liquid Federation");
  // All 83 inputs spent the federation address: 4,019.44 BTC.
  assert.equal(Math.round(d.spentSats / 1e8), 4019);
  // Pre-spend balance is what remained plus what left.
  assert.equal(Math.round(d.balanceBefore / 1e8), 4216);
  assert.ok(d.fractionOfBalance > 0.94, `fraction was ${d.fractionOfBalance}`);
});

test("the pre-spend balance is reconstructed, not read directly", () => {
  // Reading the post-spend balance as if it were the pre-spend one would make
  // a 95% drain look like 2,040% of the balance — or divide by ~0 on a total
  // sweep. This is the arithmetic that guards against that.
  const found = detectDrain(fixture.liquidDrain, index, () => 0);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.fractionOfBalance, 1, "a total drain is exactly 100%, never more");
});

test("receiving funds is not a drain", () => {
  // The return transaction pays the federation back. Only inputs count, so
  // this must produce no finding at all.
  const found = detectDrain(fixture.liquidReturn, index, () => 4000e8);
  assert.equal(found.length, 0, "a deposit must never register as a withdrawal");
});

test("a small spend from a reserve stays below the alert fraction", () => {
  const routine: RawTx = {
    txid: "e".repeat(64),
    vin: [{ txid: "f".repeat(64), sequence: 0xffffffff, prevout: { value: 5e8, scriptpubkey_address: FEDERATION } }],
    vout: [{ value: 4.99e8, scriptpubkey_address: "bc1qsomewhere" }],
    fee: 1000, weight: 800,
  };
  // 5 BTC out of a 4,200 BTC reserve is ordinary operation, not an incident.
  const found = detectDrain(routine, index, () => 4195e8);
  assert.equal(found.length, 0);
});

test("an unknown balance yields no finding rather than a guess", () => {
  const found = detectDrain(fixture.liquidDrain, index, () => null);
  assert.equal(found.length, 0, "a fraction of an unknown balance is not computable");
});

test("the address the drained funds landed on is matched as flagged", () => {
  const f = extractFeatures(fixture.liquidDrain);
  const hit = matchFlagged(f, fixture.liquidDrain, index);
  assert.ok(hit, "the destination of the drained funds must be flagged");
  assert.equal(hit.side, "output");
  assert.equal(hit.entry.label, "Liquid exploit — first hop");
});

test("the attacker wallet is matched on the return transaction's inputs", () => {
  // Funds came back FROM that wallet, so it appears as an input there. A
  // flagged-address check that only looked at outputs would miss it.
  const f = extractFeatures(fixture.liquidReturn);
  const hit = matchFlagged(f, fixture.liquidReturn, index);
  assert.ok(hit, "the attacker wallet must be matched where it actually appears");
  assert.equal(hit.side, "input");
  assert.equal(hit.entry.label, "Liquid exploit — attacker wallet");
});

test("flagged outranks reserve when an address is on both lists", () => {
  const both = indexWatchlist({
    ...list,
    reserves: [{ ...list.reserves[0]!, address: HOP }],
    flagged: [{ ...list.flagged[0]!, address: HOP }],
  });
  assert.equal(both.get(HOP)!.kind, "flagged");
});

test("an empty watchlist detects nothing and says nothing", () => {
  const empty = indexWatchlist({ ...list, reserves: [], flagged: [] });
  assert.equal(detectDrain(fixture.liquidDrain, empty, () => 197e8).length, 0);
  assert.equal(matchFlagged(extractFeatures(fixture.liquidDrain), fixture.liquidDrain, empty), null);
});
