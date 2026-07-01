"use strict";
const test = require("node:test");
const assert = require("node:assert");
const c = require("../dist/index.js");

test("webhook sign + constructEvent roundtrip", () => {
  const body = JSON.stringify({ id: "evt_1", type: "x" });
  const sig = c.signPayload(body, "whsec");
  assert.deepStrictEqual(c.constructEvent(body, sig, "whsec"), { id: "evt_1", type: "x" });
});

test("webhook rejects wrong secret", () => {
  const body = "{}";
  const sig = c.signPayload(body, "whsec");
  assert.throws(() => c.constructEvent(body, sig, "nope"));
});

test("MiCA blocks USDT in EEA and routes to EURC", () => {
  const d = c.evaluateStablecoin("USDT", "EEA");
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.routedTo, "EURC");
});

test("GENIUS blocks USDT in US and routes to USDC", () => {
  const d = c.evaluateStablecoin("USDT", "US");
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.routedTo, "USDC");
});

test("USDC allowed in EEA", () => {
  assert.strictEqual(c.evaluateStablecoin("USDC", "EEA").allowed, true);
});

test("AML blocks known OFAC address", () => {
  const r = c.screenWallet("0x000000000000000000000000000000000000dead");
  assert.strictEqual(r.action, "block");
  assert.strictEqual(r.sanctioned, true);
});

test("Travel Rule required above $1000", () => {
  const p = c.applyTravelRule({
    amountUsd: 5000,
    originator: { name: "A", accountId: "1" },
    beneficiary: { name: "B", accountId: "2", vasp: "coinbase" },
  });
  assert.strictEqual(p.required, true);
  assert.strictEqual(p.status, "attached");
});

test("Travel Rule not required below threshold", () => {
  const p = c.applyTravelRule({
    amountUsd: 100,
    originator: { name: "A", accountId: "1" },
    beneficiary: { name: "B", accountId: "2" },
  });
  assert.strictEqual(p.required, false);
});

test("FCA restricts UK promotions", () => {
  const p = c.promotionPolicy("UK");
  assert.strictEqual(p.referralBonusAllowed, false);
  assert.strictEqual(p.coolingOffHours, 24);
});

test("KYC verifies a valid adult identity", () => {
  const r = c.verifyIdentity({ fullName: "Jane Doe", dateOfBirth: "1990-01-01", documentNumber: "P123456", selfieProvided: true });
  assert.ok(["approved", "review"].includes(r.status));
});
