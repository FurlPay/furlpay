// Tests for the WebSocket snapshot conversion.
//
// The unit mismatch below is the reason this file exists. Measured 2026-09-08
// against mempool.emzy.de and blockstream.info at the same instant:
//
//   socket  mempoolInfo.total_fee = 0.10059785   over 82,842 transactions
//   REST    /mempool  total_fee   = 6010034      over 35,541 transactions
//
// Read as satoshis the socket figure is 1.2e-6 sats per transaction, which is
// impossible. Read as BTC it is 121 sats per transaction, against the REST
// host's 169 — the same order, as it should be. So the socket reports BTC and
// the REST endpoint reports satoshis, and the conversion has to know that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotFromStream } from "./run.js";
import type { StreamStats } from "./stream.js";
import type { NetworkSnapshot } from "./types.js";

const prior: NetworkSnapshot = {
  ts: Date.now() - 60_000,
  tipHeight: 966016,
  mempoolCount: 1,
  mempoolVsize: 1,
  mempoolTotalFee: 1,
  fees: { fastest: 1, halfHour: 1, hour: 1, economy: 1, minimum: 1 },
  projectedBlocks: 1,
  difficultyChangePct: 1,
  difficultyProgressPct: 1,
  retargetEta: 1,
  hashrate: 9.15e20,
  priceUsd: 78_885,
  sources: ["blockstream.info"],
};

const live: StreamStats = {
  fees: { fastestFee: 2, halfHourFee: 1, hourFee: 1, economyFee: 1, minimumFee: 1 },
  mempoolInfo: { size: 82_842, bytes: 41_885_663, usage: 246_223_488, total_fee: 0.10059785 },
  da: { progressPercent: 17.46, difficultyChange: 3.677, estimatedRetargetDate: 1_789_805_041_016 },
  mempoolBlocks: 8,
  priceUsd: 78_844,
};

test("socket total_fee is converted from BTC to satoshis", () => {
  const s = snapshotFromStream(live, prior);
  assert.equal(s.mempoolTotalFee, 10_059_785);
  // The failure this guards against: storing 0.1 where 10,059,785 belongs.
  assert.ok(s.mempoolTotalFee! > 1_000_000, "a BTC figure stored raw would read as ~0 sats");
});

test("fee-per-transaction lands in a physically possible range", () => {
  const s = snapshotFromStream(live, prior);
  const perTx = s.mempoolTotalFee! / s.mempoolCount!;
  assert.ok(perTx > 1 && perTx < 100_000, `${perTx} sats/tx is not a real fee`);
});

test("mempool size and vsize come straight across", () => {
  const s = snapshotFromStream(live, prior);
  assert.equal(s.mempoolCount, 82_842);
  assert.equal(s.mempoolVsize, 41_885_663);
});

test("tip height is carried forward, not nulled", () => {
  // No block message arrives in a quiet minute. The tip does not become
  // unknown just because nothing was mined.
  const s = snapshotFromStream(live, prior);
  assert.equal(s.tipHeight, 966016);
});

test("hashrate stays null rather than being derived from difficulty", () => {
  // The socket carries no hashrate. Deriving one would print an estimate in a
  // field the board labels as a reading.
  const s = snapshotFromStream(live, { ...prior, hashrate: null });
  assert.equal(s.hashrate, null);
});

test("a snapshot with no prior reading still renders", () => {
  const s = snapshotFromStream(live, null);
  assert.equal(s.tipHeight, null);
  assert.equal(s.mempoolCount, 82_842);
  assert.equal(s.priceUsd, 78_844);
});

test("the price falls back to the last known one when the socket omits it", () => {
  const { priceUsd, ...noPrice } = live;
  void priceUsd;
  const s = snapshotFromStream(noPrice, prior);
  assert.equal(s.priceUsd, 78_885);
});

test("an empty stats object yields nulls, never zeros", () => {
  const s = snapshotFromStream({}, null);
  assert.equal(s.mempoolCount, null);
  assert.equal(s.mempoolTotalFee, null);
  assert.equal(s.fees.fastest, null);
  assert.equal(s.projectedBlocks, null);
});

test("the snapshot records that it came from the socket", () => {
  // Provenance is printed in the board footer; a websocket-derived reading
  // must not claim to have come from an HTTP host.
  assert.deepEqual(snapshotFromStream(live, prior).sources, ["websocket"]);
});
