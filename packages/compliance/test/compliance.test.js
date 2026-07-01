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

test("tiered KYC: small amount needs no tier, large needs higher", () => {
  assert.strictEqual(c.requiredTierForAmount(500), 0);
  assert.strictEqual(c.requiredTierForAmount(50000), 2);
  const gate = c.gateByTier(0, 50000, "transfer");
  assert.strictEqual(gate.allowed, false);
  assert.ok(gate.upgradeRequires.length > 0);
});

test("reusable credential issues, verifies, and rejects tampering", () => {
  const attrs = { ageOver18: true, jurisdiction: "EEA", sanctionsClear: true, tier: 2 };
  const cred = c.issueCredential("sub_1", attrs, "issuer_secret");
  assert.strictEqual(c.verifyCredential(cred, "issuer_secret").valid, true);
  assert.strictEqual(c.verifyCredential(cred, "wrong_secret").valid, false);
  const proof = c.proveAttribute(cred, "jurisdiction", "issuer_secret");
  assert.strictEqual(proof.value, "EEA");
});

test("jurisdiction resolves and applies MiCA routing", () => {
  const j = c.resolveJurisdiction({ country: "DE" });
  assert.strictEqual(j.regime, "EEA");
  assert.ok(j.frameworks.includes("MiCA"));
  const pol = c.jurisdictionPolicy({ country: "DE" }, "USDT");
  assert.strictEqual(pol.stablecoin.allowed, false);
  assert.strictEqual(pol.stablecoin.routedTo, "EURC");
});

test("jurisdiction: KYC region beats country signal", () => {
  const j = c.resolveJurisdiction({ kycRegion: "US", country: "DE" });
  assert.strictEqual(j.regime, "US");
  assert.strictEqual(j.source, "kyc");
});
