"use strict";
// Contract tests — run against the compiled output, entirely in demo mode
// (no API key, no network). Build first:  npm run build && npm test
const test = require("node:test");
const assert = require("node:assert");
const { AutoInvest, isDue, nextRun } = require("../dist/index.js");

const D = (iso) => new Date(iso);

function sched(overrides = {}) {
  return {
    id: "s1",
    symbol: "VOO",
    amount: 10,
    currency: "USDC",
    frequency: "weekly",
    active: true,
    createdAt: "2026-07-01T00:00:00.000Z", // Wed
    ...overrides,
  };
}

test("demo mode when no key", () => {
  assert.strictEqual(new AutoInvest().live, false);
});

test("add validates inputs", () => {
  const ai = new AutoInvest();
  assert.throws(() => ai.add({ symbol: "VOO", amount: 0, frequency: "daily" }));
  assert.throws(() => ai.add({ symbol: "VOO", amount: 5, frequency: "weekly", dayOfWeek: 9 }));
  assert.throws(() => ai.add({ symbol: "VOO", amount: 5, frequency: "monthly", dayOfMonth: 31 }));
});

test("add normalises and stores schedule", () => {
  const ai = new AutoInvest();
  const s = ai.add({ symbol: "voo", amount: 10, frequency: "weekly", dayOfWeek: 1 });
  assert.strictEqual(s.symbol, "VOO");
  assert.strictEqual(s.currency, "USDC");
  assert.strictEqual(s.active, true);
  assert.strictEqual(ai.list().length, 1);
  assert.strictEqual(ai.get(s.id).id, s.id);
});

test("nextRun: weekly lands on configured day + hour (UTC)", () => {
  const s = sched({ frequency: "weekly", dayOfWeek: 1, hour: 14 }); // Monday 14:00
  const nr = nextRun(s, D("2026-07-01T00:00:00.000Z")); // Wed
  assert.strictEqual(nr.getUTCDay(), 1);
  assert.strictEqual(nr.getUTCHours(), 14);
  assert.strictEqual(nr.toISOString(), "2026-07-06T14:00:00.000Z"); // next Monday
});

test("nextRun: daily rolls to configured hour, next day if passed", () => {
  const s = sched({ frequency: "daily", hour: 14 });
  const before = nextRun(s, D("2026-07-01T10:00:00.000Z"));
  assert.strictEqual(before.toISOString(), "2026-07-01T14:00:00.000Z");
  const after = nextRun(s, D("2026-07-01T15:00:00.000Z"));
  assert.strictEqual(after.toISOString(), "2026-07-02T14:00:00.000Z");
});

test("nextRun: monthly clamps to configured day", () => {
  const s = sched({ frequency: "monthly", dayOfMonth: 15, hour: 9 });
  const nr = nextRun(s, D("2026-07-20T00:00:00.000Z")); // past the 15th
  assert.strictEqual(nr.toISOString(), "2026-08-15T09:00:00.000Z");
});

test("isDue: true only once reached, false when paused", () => {
  const s = sched({ frequency: "daily", hour: 14, createdAt: "2026-07-01T00:00:00.000Z" });
  assert.strictEqual(isDue(s, D("2026-07-01T13:59:00.000Z")), false);
  assert.strictEqual(isDue(s, D("2026-07-01T14:00:00.000Z")), true);
  assert.strictEqual(isDue({ ...s, active: false }, D("2026-07-02T00:00:00.000Z")), false);
});

test("isDue: does not refire within the same period after lastRun", () => {
  const s = sched({ frequency: "weekly", dayOfWeek: 1, hour: 14, lastRun: "2026-07-06T14:00:00.000Z" });
  assert.strictEqual(isDue(s, D("2026-07-07T14:00:00.000Z")), false); // Tue, same week
  assert.strictEqual(isDue(s, D("2026-07-13T14:00:00.000Z")), true); // next Monday
});

test("runDue: simulates orders and records lastRun", async () => {
  const ai = new AutoInvest({ schedules: [sched({ frequency: "daily", hour: 14 })] });
  const results = await ai.runDue(D("2026-07-01T14:30:00.000Z"));
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].simulated, true);
  assert.strictEqual(results[0].symbol, "VOO");
  assert.ok(ai.get("s1").lastRun, "lastRun recorded");
  // Second run same day is not due anymore.
  const again = await ai.runDue(D("2026-07-01T15:00:00.000Z"));
  assert.strictEqual(again.length, 0);
});

test("runNow ignores the due check", async () => {
  const ai = new AutoInvest({ schedules: [sched({ frequency: "monthly", dayOfMonth: 1 })] });
  const r = await ai.runNow("s1", D("2026-07-15T00:00:00.000Z"));
  assert.strictEqual(r.status, "simulated");
});

test("live order posts to the investing endpoint", async () => {
  const calls = [];
  const ai = new AutoInvest({
    apiKey: "fp_live_sk_x",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "ord_1", status: "accepted" }) };
    },
    schedules: [sched({ frequency: "daily", hour: 14 })],
  });
  const r = await ai.runNow("s1", D("2026-07-01T14:30:00.000Z"));
  assert.strictEqual(r.orderId, "ord_1");
  assert.strictEqual(r.status, "accepted");
  assert.match(calls[0].url, /\/investing\/orders$/);
  assert.deepStrictEqual(calls[0].body, { symbol: "VOO", side: "buy", notional: 10, currency: "USDC" });
});

test("failed live order is captured, not thrown", async () => {
  const ai = new AutoInvest({
    apiKey: "fp_live_sk_x",
    fetchImpl: async () => ({ ok: false, status: 402, text: async () => JSON.stringify({ error: "insufficient funds" }) }),
    schedules: [sched({ frequency: "daily", hour: 14 })],
  });
  const r = await ai.runNow("s1", D("2026-07-01T14:30:00.000Z"));
  assert.strictEqual(r.status, "failed");
  assert.strictEqual(r.error, "insufficient funds");
});
