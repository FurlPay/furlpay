// Tests for the whale classifier and the host-ordering rules.
//
// These target the claims the channel makes about its own numbers. A test here
// failing means an embed would be telling the reader something untrue — that a
// consolidation was a transfer, that issuance was a whale, or that a sampled
// count was complete.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, btcStr, SATS_PER_BTC } from "./whales.js";
import { hostsFor, DEFAULT_HOSTS, type HostSpec } from "./client.js";
import { congestionOf, hashrateStr } from "./network.js";
import { incidentKey } from "./threats.js";
import { severityOf } from "./types.js";

const BTC = SATS_PER_BTC;

function tx(over: Partial<Parameters<typeof classify>[0]> = {}): Parameters<typeof classify>[0] {
  return {
    txid: "a".repeat(64),
    vin: [{ prevout: { value: 100 * BTC, scriptpubkey_address: "bc1qsender" } }],
    vout: [{ value: 99 * BTC, scriptpubkey_address: "bc1qrecipient" }],
    size: 200,
    weight: 800,
    fee: 1000,
    status: { confirmed: true, block_height: 966016, block_time: 1788839547 },
    ...over,
  } as Parameters<typeof classify>[0];
}

const opts = (over: Partial<Parameters<typeof classify>[1]> = {}) => ({
  minSats: 50 * BTC,
  priceUsd: 78_885,
  sanctioned: new Set<string>(),
  ...over,
});

test("a transaction below the threshold is not a whale", () => {
  const t = tx({ vout: [{ value: 49 * BTC, scriptpubkey_address: "bc1qx" }] });
  assert.equal(classify(t, opts()), null);
});

test("value is the sum of ALL outputs, not just the largest", () => {
  const t = tx({
    vout: [
      { value: 30 * BTC, scriptpubkey_address: "bc1qa" },
      { value: 25 * BTC, scriptpubkey_address: "bc1qb" },
    ],
  });
  const w = classify(t, opts());
  assert.ok(w, "55 BTC across two outputs clears a 50 BTC threshold");
  assert.equal(w.valueSats, 55 * BTC);
  assert.equal(w.topOutSats, 30 * BTC, "largest output is reported separately");
  assert.equal(w.nOut, 2);
});

test("the coinbase is never a whale — it is issuance, not a transfer", () => {
  // Every block has one, and at a 3.125 BTC subsidy plus fees it would clear a
  // low threshold and appear in the feed 144 times a day as a fake movement.
  const t = tx({
    vin: [{ is_coinbase: true, prevout: null }],
    vout: [{ value: 300 * BTC, scriptpubkey_address: "bc1qminer" }],
  });
  assert.equal(classify(t, opts()), null);
});

test("a self-spend is flagged rather than presented as a transfer", () => {
  const t = tx({
    vin: [
      { prevout: { value: 60 * BTC, scriptpubkey_address: "bc1qwallet" } },
      { prevout: { value: 40 * BTC, scriptpubkey_address: "bc1qwallet2" } },
    ],
    vout: [{ value: 99 * BTC, scriptpubkey_address: "bc1qwallet" }],
  });
  const w = classify(t, opts());
  assert.ok(w);
  assert.equal(w.selfSpend, true, "the largest output pays an address that funded the inputs");
});

test("a genuine transfer is not flagged as a self-spend", () => {
  const w = classify(tx(), opts());
  assert.ok(w);
  assert.equal(w.selfSpend, false);
});

test("sanctions screening matches an input address", () => {
  const w = classify(tx(), opts({ sanctioned: new Set(["bc1qsender"]) }));
  assert.ok(w);
  assert.equal(w.sanctioned, true);
  assert.equal(w.sanctionedAddr, "bc1qsender");
});

test("sanctions screening matches an output address", () => {
  const w = classify(tx(), opts({ sanctioned: new Set(["bc1qrecipient"]) }));
  assert.ok(w);
  assert.equal(w.sanctionedAddr, "bc1qrecipient");
});

test("an empty sanctions set flags nothing — screening is simply off", () => {
  const w = classify(tx(), opts({ sanctioned: new Set() }));
  assert.ok(w);
  assert.equal(w.sanctioned, false);
});

test("a confirmed whale is dated by its block, not by when it was scanned", () => {
  // Catch-up runs walk old blocks. Stamping them "now" would push yesterday's
  // whales into today's 24h digest and count them a second time.
  const blockTime = 1788839547;
  const w = classify(tx(), opts());
  assert.ok(w);
  assert.equal(w.firstSeen, blockTime * 1000);
  assert.notEqual(w.firstSeen, Date.now());
});

test("USD value is null when no price was readable, never zero", () => {
  const w = classify(tx(), opts({ priceUsd: null }));
  assert.ok(w);
  assert.equal(w.valueUsd, null, "a missing price must not render as $0");
});

test("block-walked transactions carry block provenance", () => {
  const w = classify(tx(), opts());
  assert.ok(w);
  assert.equal(w.discovery, "block");
});

test("host ordering puts the permissive host first for bulk Esplora work", () => {
  // Measured: blockstream took 183 requests in 52s clean; emzy 429s above
  // ~0.5 rps. Walking a block against emzy first would fail every time.
  const ordered = hostsFor(DEFAULT_HOSTS, "esplora");
  assert.equal(new URL(ordered[0]!.base).hostname, "blockstream.info");
});

test("esplora-only hosts are never offered for /v1 endpoints", () => {
  const ordered = hostsFor(DEFAULT_HOSTS, "v1");
  assert.ok(ordered.length > 0);
  for (const h of ordered) {
    assert.ok(h.caps.includes("v1"), `${h.base} was offered for v1 without the capability`);
  }
  assert.ok(
    !ordered.some((h) => h.base.includes("blockstream")),
    "blockstream serves no /v1 — asking it would 404, not fail over",
  );
});

test("a capability with no host yields an empty list rather than a wrong host", () => {
  const only: HostSpec[] = [{ base: "https://x/api", caps: ["esplora"], rps: 1, note: "" }];
  assert.deepEqual(hostsFor(only, "v1"), []);
});

test("congestion bands are measured in blocks of backlog", () => {
  assert.equal(congestionOf(500_000)!.band, "clear");
  assert.equal(congestionOf(2_000_000)!.band, "normal");
  assert.equal(congestionOf(8_000_000)!.band, "busy");
  assert.equal(congestionOf(20_000_000)!.band, "congested");
  assert.equal(congestionOf(60_000_000)!.band, "backlogged");
  // The measured live value on 2026-09-08 was ~40.8M vbytes.
  assert.equal(congestionOf(40_781_250)!.band, "backlogged");
});

test("congestion of an unreadable mempool is null, not 'clear'", () => {
  assert.equal(congestionOf(null), null);
});

test("hashrate renders at the scale the network actually runs at", () => {
  // Measured 2026-09-08: 9.15e20 H/s.
  assert.equal(hashrateStr(915_034_742_971_876_000_000), "915.0 EH/s");
  assert.equal(hashrateStr(null), "N/A");
});

test("incident identity comes from the record, not from arrival order", () => {
  // The feed republishes its whole history on every fetch, so a stable key is
  // the only thing standing between us and re-alerting 1,257 old incidents.
  assert.equal(incidentKey("Cozy V2", 1788652800), incidentKey(" cozy v2 ", 1788652800));
  assert.notEqual(incidentKey("Cozy V2", 1788652800), incidentKey("Cozy V2", 1788652801));
});

test("severity bands follow reported loss, and an unquantified loss is not critical", () => {
  assert.equal(severityOf(320_000_000), "critical");
  assert.equal(severityOf(1_727_782), "notable");
  assert.equal(severityOf(163_326), "minor");
  assert.equal(severityOf(null), "minor", "unknown loss must not be inflated to critical");
});

test("BTC formatting keeps precision that matters at each scale", () => {
  assert.equal(btcStr(2437_5709_0000), "2,437.57 BTC");
  assert.equal(btcStr(50 * BTC), "50.0000 BTC");
});
