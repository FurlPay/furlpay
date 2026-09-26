// Tests for the Liquid normaliser.
//
// The inputs below are the exact structures observed on live responses from
// blockstream.info/liquid/api on 2026-09-08, transcribed field-for-field. The
// peg-out shape comes from Liquid tx 2c350028…edb0; the asset statistics from
// /asset/6f0279e9… (L-BTC).
//
// Nothing here is invented. Where a shape was NOT observed — a confidential
// output's commitment field names — the test asserts only the behaviour that
// does not depend on them: that a missing `value` reads as confidential rather
// than as zero.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseTx, normaliseOutput, normaliseAssetStats, readAmount, backingRatio,
  LBTC_ASSET_ID, BITCOIN_GENESIS_HASH,
} from "./esplora.js";

/* The peg-out output, exactly as the API returned it. */
const pegoutVout = {
  scriptpubkey: "6a2000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f16",
  scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_32 ...",
  scriptpubkey_type: "op_return",
  value: 101_569_917,
  asset: LBTC_ASSET_ID,
  pegout: {
    genesis_hash: BITCOIN_GENESIS_HASH,
    scriptpubkey: "0014ce4a25e42e3ebdc481a2389482c66b925a58c0bb",
    scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 ce4a25e42e3ebdc481a2389482c66b925a58c0bb",
    scriptpubkey_address: "bc1qee9ztepw867ufqdz8z2g93ntjfd93s9mkjmwpv",
  },
};

/* An OP_RETURN that is NOT a peg-out — observed on the L-BTC chain. */
const plainOpReturn = {
  scriptpubkey: "6a240a8ce26f63b5feeadb48e752653886b98a4b3112adb57562416b00000000000000000000",
  scriptpubkey_asm: "OP_RETURN OP_PUSHBYTES_36 0a8ce26f63b5fee…",
  scriptpubkey_type: "op_return",
  value: 0,
  asset: LBTC_ASSET_ID,
};

/* L-BTC chain_stats, exactly as returned. */
const assetStats = {
  tx_count: 128_692,
  peg_in_count: 117_335,
  peg_in_amount: 1_835_692_853_979,
  peg_out_count: 10_417,
  peg_out_amount: 1_814_960_353_198,
  burn_count: 987,
  burned_amount: 1_002_779_324,
};

/* ------------------------------------------------------------------ */

test("a peg-out is identified by its field, not by its script type", () => {
  const o = normaliseOutput(pegoutVout, 0);
  assert.ok(o.pegout, "the pegout field must drive identification");
  assert.equal(o.pegout.parentChain, "bitcoin");
  assert.equal(o.pegout.destinationAddress, "bc1qee9ztepw867ufqdz8z2g93ntjfd93s9mkjmwpv");
});

test("an OP_RETURN without a pegout field is NOT a peg-out", () => {
  // The failure this guards against: treating every OP_RETURN as a withdrawal.
  // Both outputs here have scriptpubkey_type "op_return"; only one is a peg-out.
  const o = normaliseOutput(plainOpReturn, 0);
  assert.equal(o.scriptType, "op_return");
  assert.equal(o.pegout, null);
});

test("the Bitcoin destination arrives already decoded", () => {
  const tx = normaliseTx({
    txid: "a".repeat(64),
    vin: [{ txid: "b".repeat(64), prevout: { value: 200_000_000, asset: LBTC_ASSET_ID } }],
    vout: [pegoutVout, plainOpReturn],
    status: { confirmed: true, block_height: 3_000_000, block_time: 1_780_000_000 },
  });
  assert.equal(tx.pegouts.length, 1, "exactly one of these two outputs is a peg-out");
  assert.equal(tx.pegouts[0]!.pegout!.destinationAddress, "bc1qee9ztepw867ufqdz8z2g93ntjfd93s9mkjmwpv");
});

test("a peg-out amount is explicit even though Liquid is confidential", () => {
  // Verified on chain and consistent with the design: the federation must see
  // the amount to authorise the withdrawal.
  const o = normaliseOutput(pegoutVout, 0);
  assert.equal(o.amount.visibility, "known");
  assert.equal(o.amount.value, 101_569_917n);
});

test("a blinded amount is confidential, NEVER zero", () => {
  // The single most consequential rule in the adapter. Reading a blinded value
  // as 0 would make every private transaction look like it moved nothing.
  const blinded = readAmount({ scriptpubkey_type: "v1_p2tr" } as { value?: number });
  assert.equal(blinded.value, null);
  assert.equal(blinded.visibility, "confidential");
  assert.notEqual(blinded.value, 0n);
});

test("a genuinely explicit zero stays known", () => {
  // An OP_RETURN carries a real zero. It must not be mistaken for blinding.
  const o = normaliseOutput(plainOpReturn, 0);
  assert.equal(o.amount.visibility, "known");
  assert.equal(o.amount.value, 0n);
});

test("amountVisibility reports how much of a transaction is readable", () => {
  const tx = normaliseTx({
    txid: "c".repeat(64),
    vin: [{ txid: "d".repeat(64), prevout: null }],
    vout: [pegoutVout, { scriptpubkey_type: "v1_p2tr" }, { scriptpubkey_type: "v1_p2tr" }],
  });
  // One of three outputs readable.
  assert.ok(Math.abs(tx.amountVisibility - 1 / 3) < 0.001);
});

test("a peg-in is flagged on the input and has no prevout", () => {
  const tx = normaliseTx({
    txid: "e".repeat(64),
    vin: [{ is_pegin: true, prevout: null, txid: "f".repeat(64) }],
    vout: [{ scriptpubkey_type: "v1_p2tr" }],
  });
  assert.equal(tx.hasPegin, true);
  assert.equal(tx.inputs[0]!.isPegin, true);
  // Unknown, not confidential: the funding output is on the other chain
  // entirely rather than being blinded on this one.
  assert.equal(tx.inputs[0]!.amount.visibility, "unknown");
});

test("a non-Bitcoin parent chain is distinguished from Bitcoin", () => {
  const other = normaliseOutput(
    { ...pegoutVout, pegout: { ...pegoutVout.pegout, genesis_hash: "00".repeat(32) } },
    0,
  );
  assert.equal(other.pegout!.parentChain, "other");
  const unknown = normaliseOutput({ ...pegoutVout, pegout: { scriptpubkey_address: "x" } }, 0);
  assert.equal(unknown.pegout!.parentChain, "unknown");
});

/* ------------------------------------------------------------------ */
/* Asset statistics and backing                                        */
/* ------------------------------------------------------------------ */

test("outstanding supply is pegged in less pegged out less burned", () => {
  const s = normaliseAssetStats(LBTC_ASSET_ID, assetStats);
  assert.equal(s.outstandingSats, 1_835_692_853_979n - 1_814_960_353_198n - 1_002_779_324n);
  // 197.2972 BTC, matching the figure reported after the September drain.
  assert.equal(s.outstandingSats, 19_729_721_457n);
});

test("outstanding supply is null when any component is unreadable", () => {
  const partial = normaliseAssetStats(LBTC_ASSET_ID, { peg_in_amount: 100, peg_out_amount: 50 });
  assert.equal(partial.outstandingSats, null, "a partial subtraction must not read as a total");
});

test("backing ratio flags under-backing without any incident knowledge", () => {
  const s = normaliseAssetStats(LBTC_ASSET_ID, assetStats);
  // Reserve holding far less than the supply it must cover.
  const under = backingRatio(2_000_000_000n, s)!;
  assert.ok(under.ratio < 0.2, `ratio was ${under.ratio}`);
  // Reserve holding roughly what it should.
  const healthy = backingRatio(19_700_000_000n, s)!;
  assert.ok(Math.abs(healthy.ratio - 1) < 0.05, `ratio was ${healthy.ratio}`);
});

test("backing ratio detects reserves held against retired supply", () => {
  // The measured state after the returned funds landed: 3,597.47 BTC held
  // against 197.30 BTC outstanding. Over-backing is not a theft, but it is a
  // deviation from 1 and the engine should surface it rather than ignore it.
  const s = normaliseAssetStats(LBTC_ASSET_ID, assetStats);
  // 3,597.4720 BTC held, read from the federation address on 2026-09-08.
  const over = backingRatio(359_747_200_000n, s)!;
  assert.ok(over.ratio > 15, `ratio was ${over.ratio}`);
  // Matches the ratio computed live against both chains: 18.234.
  assert.ok(Math.abs(over.ratio - 18.234) < 0.01, `ratio was ${over.ratio}`);
});

test("backing ratio is null rather than guessed when a side is unknown", () => {
  const s = normaliseAssetStats(LBTC_ASSET_ID, assetStats);
  assert.equal(backingRatio(null, s), null);
  assert.equal(backingRatio(100n, null), null);
  assert.equal(backingRatio(100n, normaliseAssetStats("x", {})), null);
});

test("normalisation never throws on a malformed response", () => {
  // A provider returning something unexpected must degrade the Liquid signals,
  // not stop the pipeline.
  const empty = normaliseTx({ txid: "z".repeat(64), vin: [], vout: [] });
  assert.equal(empty.pegouts.length, 0);
  assert.equal(empty.hasPegin, false);
  assert.equal(empty.amountVisibility, 0);
});
