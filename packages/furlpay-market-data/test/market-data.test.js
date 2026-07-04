"use strict";
// Contract tests — run against the compiled output, entirely in demo mode
// (no API keys, no network). Build first:  npm run build && npm test
const test = require("node:test");
const assert = require("node:assert");
const { MarketData } = require("../dist/index.js");

test("demo mode when no keys", () => {
  const md = new MarketData();
  assert.strictEqual(md.live, false);
});

test("quote is deterministic per symbol", async () => {
  const md = new MarketData();
  const a = await md.quote("AAPL");
  const b = await md.quote("AAPL");
  assert.strictEqual(a.source, "demo");
  assert.strictEqual(a.price, b.price);
  assert.ok(a.price > 0);
  assert.strictEqual(a.symbol, "AAPL");
});

test("different symbols yield different prices", async () => {
  const md = new MarketData();
  const a = await md.quote("AAPL");
  const b = await md.quote("MSFT");
  assert.notStrictEqual(a.price, b.price);
});

test("quotes() resolves all symbols", async () => {
  const md = new MarketData();
  const rows = await md.quotes(["AAPL", "VOO", "NVDA"]);
  assert.strictEqual(rows.length, 3);
  rows.forEach((q) => assert.ok(q.price > 0));
});

test("bars returns requested count, chronological, valid OHLC", async () => {
  const md = new MarketData();
  const { bars, source, interval } = await md.bars("VOO", { interval: "daily", limit: 30 });
  assert.strictEqual(source, "demo");
  assert.strictEqual(interval, "daily");
  assert.strictEqual(bars.length, 30);
  for (let i = 1; i < bars.length; i++) {
    assert.ok(bars[i].t >= bars[i - 1].t, "bars must be chronological");
  }
  bars.forEach((b) => {
    assert.ok(b.h >= b.l);
    assert.ok(b.h >= b.o && b.h >= b.c);
    assert.ok(b.l <= b.o && b.l <= b.c);
    assert.ok(b.v > 0);
  });
});

test("search matches by symbol and name", async () => {
  const md = new MarketData();
  const bySym = await md.search("AAPL");
  assert.ok(bySym.some((m) => m.symbol === "AAPL"));
  const byName = await md.search("vanguard");
  assert.ok(byName.some((m) => m.type === "ETF"));
});

test("live=true when a key is supplied", () => {
  const md = new MarketData({ alphaVantageKey: "demo-key" });
  assert.strictEqual(md.live, true);
});

test("live quote fails soft to demo when provider errors", async () => {
  // fetch that always rejects → must fall back to demo, never throw.
  const md = new MarketData({
    alphaVantageKey: "bad",
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  const q = await md.quote("AAPL");
  assert.strictEqual(q.source, "demo");
  assert.ok(q.price > 0);
});
