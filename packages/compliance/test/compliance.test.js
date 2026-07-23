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

test("AML blocks a real OFAC SDN address", () => {
  // A real address from the bundled OFAC SDN snapshot.
  const r = c.screenWallet("0x0330070fd38ec3bb94f58fa55d40368271e9e54a");
  assert.strictEqual(r.action, "block");
  assert.strictEqual(r.sanctioned, true);
});

test("AML allows a clean address", () => {
  const r = c.screenWallet("0x1111111111111111111111111111111111111111");
  assert.strictEqual(r.action, "allow");
  assert.strictEqual(r.sanctioned, false);
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
  // Boundaries are DERIVED from the tier table, not hardcoded. This assertion
  // previously pinned $500 to tier 0 and broke when the tier-0 single-transfer
  // cap was tightened to $50 during the caps consolidation — the test was
  // encoding one specific policy rather than the rule that policy expresses.
  const t0Cap = c.TIERS[0].maxSingleTransferUsd;
  const t2Cap = c.TIERS[2].maxSingleTransferUsd;

  assert.strictEqual(c.requiredTierForAmount(t0Cap), 0, "at the cap, still tier 0");
  assert.strictEqual(c.requiredTierForAmount(t0Cap + 1), 1, "one dollar over escalates");
  assert.strictEqual(c.requiredTierForAmount(t2Cap), 2);
  assert.strictEqual(c.requiredTierForAmount(t2Cap + 1), 3, "above the top cap needs the top tier");

  // Caps must be strictly increasing, or a higher tier could permit less.
  for (const t of [1, 2, 3]) {
    assert.ok(
      c.TIERS[t].maxSingleTransferUsd > c.TIERS[t - 1].maxSingleTransferUsd,
      `tier ${t} must allow more than tier ${t - 1}`
    );
  }

  const gate = c.gateByTier(0, t2Cap, "transfer");
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
