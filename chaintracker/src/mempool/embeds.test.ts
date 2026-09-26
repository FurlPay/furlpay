// Tests for the rendering rules that keep the channel honest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fitEntries } from "./embeds.js";

test("entries that fit are all kept", () => {
  assert.equal(fitEntries(["a", "b", "c"], 100), "a\nb\nc");
});

test("an entry is never cut in half", () => {
  // The bug this replaces: slice(0, 1024) left "**165.61" dangling — a number
  // with no unit, no link, and no sign that anything had been dropped.
  const entries = ["**2,437.57 BTC** · $192M", "**1,254.53 BTC** · $98.91M", "**672.66 BTC** · $53.04M"];
  const out = fitEntries(entries, 60);
  for (const line of out.split("\n")) {
    if (line.startsWith("-#")) continue;
    assert.ok(entries.includes(line), `"${line}" is not a whole entry`);
  }
});

test("dropping entries is stated, not silent", () => {
  const out = fitEntries(["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"], 25);
  assert.match(out, /\+\d+ more/, "a truncated list must say how many it dropped");
});

test("the result never exceeds the limit", () => {
  const entries = Array.from({ length: 40 }, (_, i) => `entry number ${i} with some padding text`);
  for (const limit of [50, 120, 400, 1024]) {
    const out = fitEntries(entries, limit);
    assert.ok(out.length <= limit, `limit ${limit} produced ${out.length} chars`);
  }
});

test("an empty list renders as empty, not as a stray marker", () => {
  assert.equal(fitEntries([], 100), "");
});

test("a single entry too large for the limit yields the notice rather than a fragment", () => {
  const out = fitEntries(["x".repeat(500)], 50);
  assert.ok(!out.includes("x".repeat(60)), "must not emit a truncated fragment");
  assert.match(out, /\+1 more not shown/);
});
