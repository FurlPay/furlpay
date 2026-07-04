"use strict";
// Contract tests — run against compiled output, entirely in demo mode
// (no keys, no network). Build first:  npm run build && npm test
const test = require("node:test");
const assert = require("node:assert");
const { TravelClient, MCC, buildTools } = require("../dist/index.js");

const DATES = { checkIn: "2026-08-01", checkOut: "2026-08-04" }; // 3 nights

test("demo mode when no keys", () => {
  assert.strictEqual(new TravelClient().live, false);
});

test("searchStays: deterministic, correct nights, respects price cap", async () => {
  const c = new TravelClient();
  const a = await c.searchStays({ city: "London", ...DATES });
  const b = await c.searchStays({ city: "London", ...DATES });
  assert.ok(a.length > 0);
  assert.strictEqual(a[0].quoteId, b[0].quoteId, "deterministic");
  assert.strictEqual(a[0].nights, 3);
  assert.strictEqual(a[0].totalUsd, Math.round(a[0].nightlyUsd * 3 * 100) / 100);

  const capped = await c.searchStays({ city: "London", ...DATES, maxNightlyUsd: 150 });
  capped.forEach((s) => assert.ok(s.nightlyUsd <= 150));
});

test("searchFlights returns demo quotes", async () => {
  const flights = await new TravelClient().searchFlights({ from: "LHR", to: "JFK", date: "2026-08-01" });
  assert.ok(flights.length > 0);
  assert.strictEqual(flights[0].from, "LHR");
  assert.ok(flights[0].totalUsd > 0);
});

test("travala route: x402 proof + 10% cbBTC rebate, 7/3 split", async () => {
  const c = new TravelClient();
  const bk = await c.authorizeBooking({ amountUsd: 200, source: "travala" });
  assert.strictEqual(bk.status, "authorized");
  assert.ok(bk.authorization.x402, "has x402 proof");
  assert.strictEqual(bk.authorization.x402.network, "base");
  assert.strictEqual(bk.authorization.simulated, true);
  assert.ok(bk.rebate, "accrues rebate");
  assert.strictEqual(bk.rebate.currency, "cbBTC");
  assert.strictEqual(bk.rebate.totalUsd, 20); // 10% of 200
  assert.strictEqual(bk.rebate.developerUsd, 14); // 70%
  assert.strictEqual(bk.rebate.treasuryUsd, 6); // 30%
  assert.strictEqual(bk.rebate.bookingId, bk.id);
});

test("legacy route: single-use MCC-locked Visa VCN, no rebate", async () => {
  const c = new TravelClient();
  const bk = await c.authorizeBooking({ amountUsd: 320, source: "legacy", mcc: MCC.LODGING });
  assert.ok(bk.authorization.card, "has card");
  assert.strictEqual(bk.authorization.card.singleUse, true);
  assert.deepStrictEqual(bk.authorization.card.mccWhitelist, ["7011"]);
  assert.strictEqual(bk.authorization.card.limitUsd, 320);
  assert.ok(/^\d{4}$/.test(bk.authorization.card.last4));
  assert.strictEqual(bk.rebate, undefined, "no rebate on legacy route");
});

test("legacy route defaults MCC to lodging (7011)", async () => {
  const bk = await new TravelClient().authorizeBooking({ amountUsd: 100, source: "legacy" });
  assert.deepStrictEqual(bk.authorization.card.mccWhitelist, [MCC.LODGING]);
});

test("agent budget is enforced", async () => {
  const c = new TravelClient();
  c.setAgentBudget("agent_1", 250);
  await c.authorizeBooking({ amountUsd: 200, source: "travala", agentId: "agent_1" });
  assert.strictEqual(c.getAgentBudget("agent_1").remaining, 50);
  await assert.rejects(
    () => c.authorizeBooking({ amountUsd: 100, source: "travala", agentId: "agent_1" }),
    /exceeds remaining budget/,
  );
});

test("rejects non-positive amount", async () => {
  await assert.rejects(() => new TravelClient().authorizeBooking({ amountUsd: 0, source: "travala" }), /> 0/);
});

test("confirm and cancel lifecycle", async () => {
  const c = new TravelClient();
  const bk = await c.authorizeBooking({ amountUsd: 150, source: "travala" });
  assert.strictEqual(c.confirmBooking(bk.id).status, "confirmed");
  assert.strictEqual(c.cancelBooking(bk.id).status, "cancelled");
  assert.throws(() => c.confirmBooking(bk.id), /cancelled/);
});

test("listRebates aggregates developer + treasury, excludes cancelled", async () => {
  const c = new TravelClient({ developerWallet: "0xDev" });
  const b1 = await c.authorizeBooking({ amountUsd: 200, source: "travala" }); // dev 14
  await c.authorizeBooking({ amountUsd: 100, source: "travala" }); // dev 7
  const cancel = await c.authorizeBooking({ amountUsd: 500, source: "travala" });
  c.cancelBooking(cancel.id); // excluded
  const r = c.listRebates();
  assert.strictEqual(r.developerWallet, "0xDev");
  assert.strictEqual(r.developerTotalUsd, 21); // 14 + 7
  assert.strictEqual(r.treasuryTotalUsd, 9); // 6 + 3
  assert.strictEqual(r.accruals.length, 2);
});

test("trust gate: booking without a mandateToken is rejected when a verifier is set", async () => {
  const c = new TravelClient({ trust: { verifyBookingToken: async () => ({ ok: true }) } });
  await assert.rejects(() => c.authorizeBooking({ amountUsd: 100, source: "travala" }), /mandateToken required/);
});

test("trust gate: verifier rejection blocks authorization with its reason", async () => {
  const c = new TravelClient({
    trust: { verifyBookingToken: async () => ({ ok: false, reason: "mandate expired" }) },
  });
  await assert.rejects(
    () => c.authorizeBooking({ amountUsd: 100, source: "travala", mandateToken: "tok" }),
    /mandate rejected: mandate expired/,
  );
});

test("trust gate: verifier sees the resolved MCC and exact claims; decision lands on the booking", async () => {
  let seen;
  const c = new TravelClient({
    trust: {
      verifyBookingToken: async (token, claims) => {
        seen = { token, claims };
        return { ok: true, agentKeyId: "ak_test", mandateId: "mnd_test", remainingUsd: 400 };
      },
    },
  });
  const bk = await c.authorizeBooking({ amountUsd: 320, source: "legacy", mandateToken: "tok_1" });
  assert.strictEqual(seen.token, "tok_1");
  assert.deepStrictEqual(seen.claims, { amountUsd: 320, mcc: "7011", source: "legacy" }); // MCC defaulted before verify
  assert.deepStrictEqual(bk.trust, { agentKeyId: "ak_test", mandateId: "mnd_test", remainingUsd: 400 });
});

test("no verifier configured → bookings work without a token (back-compat)", async () => {
  const bk = await new TravelClient().authorizeBooking({ amountUsd: 50, source: "travala" });
  assert.strictEqual(bk.trust, undefined);
});

test("MCP tools are well-formed and cover the flow", () => {
  const tools = buildTools(new TravelClient());
  const names = tools.map((t) => t.name);
  assert.ok(names.length >= 7);
  for (const t of tools) {
    assert.ok(t.name.startsWith("travel_"));
    assert.ok(t.description);
    assert.strictEqual(t.inputSchema.type, "object");
    assert.strictEqual(typeof t.handler, "function");
  }
  ["travel_search_stays", "travel_authorize_booking", "travel_list_rebates"].forEach((n) =>
    assert.ok(names.includes(n)),
  );
});

test("authorize tool executes end-to-end", async () => {
  const tools = buildTools(new TravelClient());
  const authorize = tools.find((t) => t.name === "travel_authorize_booking");
  const out = await authorize.handler({ amountUsd: 200, source: "travala" });
  assert.strictEqual(out.rebate.developerUsd, 14);
});
