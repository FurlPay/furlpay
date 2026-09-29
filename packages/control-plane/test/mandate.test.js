"use strict";
// ---------------------------------------------------------------------------
// Intent mandates: shape coherence, liveness, canonicalization.
//
// TWO PROPERTIES UNDER TEST.
//
//   1. STRUCTURAL VALIDATION IS SEPARATE FROM SIGNATURE VALIDATION, AND BOTH ARE
//      REQUIRED. A correctly signed mandate with a negative cap or an expiry in
//      the past is a mandate whose author did not mean what it says. Signature
//      checks catch tampering and say nothing about coherence.
//
//   2. THE SIGNING PAYLOAD EXCLUDES OUR LIFECYCLE BOOKKEEPING. Revoking a
//      mandate must not invalidate the signature, or we lose the ability to
//      prove what the mandate said.
// ---------------------------------------------------------------------------
const test = require("node:test");
const assert = require("node:assert");
const {
  validateMandateShape,
  mandateLiveness,
  mandateSigningPayload,
  authorityScopeOf,
  remainingCumulative,
  canonicalize,
  MAX_MANDATE_LIFETIME_MS,
} = require("../dist/index.js");

const NOW = Date.parse("2026-09-28T12:00:00Z");
const USDC = (m) => String(Math.round(m * 1e6));

function mandate(o = {}) {
  return {
    mandateId: "mand_01HXYZ7894",
    organizationId: "org_1",
    principalId: "corp_org_8849201",
    delegatedTo: "did:agent:cloudflare:research-crawler.example.cloudflare.pay",
    authorityScope: {
      currency: "USDC",
      maxAmountPerTxAtomic: USDC(50),
      maxCumulativeAtomic: USDC(500),
      spendingWindowSeconds: 86400,
      allowedMerchantDomains: ["api.financialmodelingprep.com", "data.sec.gov", "api.deepseek.com"],
      allowedRails: ["stablecoin_cctp", "x402_usdc_arbitrum"],
      requireHumanApprovalAboveAtomic: USDC(100),
      ...(o.scope ?? {}),
    },
    issuedAt: "2026-09-28T00:15:00Z",
    expiresAt: "2026-09-29T00:00:00Z",
    nonce: "c9f83a21-9984-482a-a92c-687f2b1d3e8a",
    policyVersion: "cp-2026-09-28",
    status: "ACTIVE",
    ...o.top,
  };
}

// ── Shape ────────────────────────────────────────────────────────────────

test("a well-formed mandate passes shape validation", () => {
  assert.deepStrictEqual(validateMandateShape(mandate()), { ok: true });
});

const SHAPE_FAILURES = [
  ["missing_ids", { top: { mandateId: "" } }],
  ["missing_ids", { top: { principalId: "" } }],
  ["missing_ids", { top: { delegatedTo: "" } }],
  ["nonce_missing", { top: { nonce: "" } }],
  ["policy_version_missing", { top: { policyVersion: "" } }],
  ["currency_missing", { scope: { currency: "" } }],
  ["amount_unparseable", { scope: { maxAmountPerTxAtomic: "1.5" } }],
  ["amount_unparseable", { scope: { maxCumulativeAtomic: "abc" } }],
  ["amount_not_positive", { scope: { maxAmountPerTxAtomic: "0" } }],
  ["amount_not_positive", { scope: { maxCumulativeAtomic: "-1", maxAmountPerTxAtomic: "-2" } }],
  ["per_tx_exceeds_cumulative", { scope: { maxAmountPerTxAtomic: USDC(1000), maxCumulativeAtomic: USDC(100) } }],
  ["window_invalid", { scope: { spendingWindowSeconds: 0 } }],
  ["window_invalid", { scope: { spendingWindowSeconds: -1 } }],
  ["window_invalid", { scope: { spendingWindowSeconds: 1.5 } }],
  ["approval_threshold_unparseable", { scope: { requireHumanApprovalAboveAtomic: "10.5" } }],
  ["expiry_invalid", { top: { expiresAt: "not-a-date" } }],
  ["expiry_before_issue", { top: { issuedAt: "2026-09-29T00:00:00Z", expiresAt: "2026-09-28T00:00:00Z" } }],
  ["not_before_after_expiry", { top: { notBefore: "2026-09-30T00:00:00Z" } }],
];

for (const [expected, override] of SHAPE_FAILURES) {
  test(`shape validation rejects with ${expected}`, () => {
    const out = validateMandateShape(mandate(override));
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.error, expected);
    assert.ok(out.detail && out.detail.length > 5, "the failure explains itself");
  });
}

test("a per-tx cap above the cumulative cap is rejected because it can never bind", () => {
  const out = validateMandateShape(
    mandate({ scope: { maxAmountPerTxAtomic: USDC(1000), maxCumulativeAtomic: USDC(100) } })
  );
  assert.strictEqual(out.error, "per_tx_exceeds_cumulative");
  assert.match(out.detail, /can never bind/);
});

test("a mandate longer than the maximum lifetime is refused", () => {
  // A mandate valid for a year is a standing wallet with extra steps.
  const out = validateMandateShape(
    mandate({ top: { issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-06-01T00:00:00Z" } })
  );
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.error, "expiry_invalid");
  assert.match(out.detail, /maximum/);
});

test("a mandate exactly at the maximum lifetime is accepted", () => {
  const issued = Date.parse("2026-01-01T00:00:00Z");
  const out = validateMandateShape(
    mandate({
      top: {
        issuedAt: "2026-01-01T00:00:00Z",
        expiresAt: new Date(issued + MAX_MANDATE_LIFETIME_MS).toISOString(),
      },
    })
  );
  assert.strictEqual(out.ok, true);
});

test("an equal per-tx and cumulative cap is coherent", () => {
  const out = validateMandateShape(
    mandate({ scope: { maxAmountPerTxAtomic: USDC(100), maxCumulativeAtomic: USDC(100) } })
  );
  assert.strictEqual(out.ok, true);
});

// ── Liveness ─────────────────────────────────────────────────────────────

test("an active, in-window mandate is live", () => {
  assert.deepStrictEqual(mandateLiveness(mandate(), NOW), { live: true });
});

test("stored status is checked BEFORE the clock, so REVOKED never reads as expired", () => {
  // "Revoked" and "expired" are different facts. Reporting a revocation as an
  // expiry reads like something that will resolve on its own.
  const revokedAndExpired = mandate({
    top: { status: "REVOKED", revokedReason: "project cancelled", expiresAt: "2026-09-01T00:00:00Z" },
  });
  const out = mandateLiveness(revokedAndExpired, NOW);
  assert.strictEqual(out.live, false);
  assert.strictEqual(out.reason, "revoked");
  assert.strictEqual(out.detail, "project cancelled");
});

test("a CONSUMED single-use mandate is not live, and says so distinctly", () => {
  const out = mandateLiveness(mandate({ top: { status: "CONSUMED" } }), NOW);
  assert.strictEqual(out.reason, "consumed");
});

test("an expired mandate is not live", () => {
  const out = mandateLiveness(mandate({ top: { expiresAt: "2026-09-28T11:00:00Z" } }), NOW);
  assert.strictEqual(out.live, false);
  assert.strictEqual(out.reason, "expired");
});

test("an unparseable expiry is treated as expired, not as valid forever", () => {
  const out = mandateLiveness(mandate({ top: { expiresAt: "garbage" } }), NOW);
  assert.strictEqual(out.live, false);
  assert.strictEqual(out.reason, "expired");
});

test("a mandate before its notBefore is not yet valid", () => {
  const out = mandateLiveness(mandate({ top: { notBefore: "2026-09-28T18:00:00Z" } }), NOW);
  assert.strictEqual(out.live, false);
  assert.strictEqual(out.reason, "not_yet_valid");
});

test("expiry is exclusive at the boundary — the instant of expiry is not live", () => {
  const at = "2026-09-28T12:00:00Z";
  assert.strictEqual(mandateLiveness(mandate({ top: { expiresAt: at } }), NOW).live, false);
  assert.strictEqual(mandateLiveness(mandate({ top: { expiresAt: at } }), NOW - 1).live, true);
});

// ── Signing payload ──────────────────────────────────────────────────────

test("the signing payload EXCLUDES our lifecycle bookkeeping", () => {
  // Including status would invalidate the signature the moment we revoked,
  // leaving us unable to prove what the mandate said.
  const active = mandate();
  const revoked = mandate({
    top: { status: "REVOKED", revokedAt: "2026-09-28T11:00:00Z", revokedReason: "cancelled" },
  });
  assert.strictEqual(
    mandateSigningPayload(active),
    mandateSigningPayload(revoked),
    "revocation must not change the signed bytes"
  );
  const payload = mandateSigningPayload(active);
  assert.ok(!payload.includes("REVOKED"));
  assert.ok(!payload.includes("revokedReason"));
  assert.ok(!payload.includes('"status"'));
});

test("the signing payload INCLUDES every field that bounds authority", () => {
  const payload = mandateSigningPayload(mandate());
  for (const field of [
    "mandateId",
    "principalId",
    "delegatedTo",
    "authorityScope",
    "expiresAt",
    "nonce",
    "policyVersion",
    "maxAmountPerTxAtomic",
    "maxCumulativeAtomic",
    "requireHumanApprovalAboveAtomic",
    "allowedMerchantDomains",
    "allowedRails",
  ]) {
    assert.ok(payload.includes(field), `${field} must be signed`);
  }
});

test("changing ANY bounding field changes the signing payload", () => {
  const base = mandateSigningPayload(mandate());
  const variants = [
    { scope: { maxAmountPerTxAtomic: USDC(51) } },
    { scope: { maxCumulativeAtomic: USDC(501) } },
    { scope: { requireHumanApprovalAboveAtomic: USDC(101) } },
    { scope: { allowedMerchantDomains: ["evil.com"] } },
    { scope: { allowedRails: ["visa_intelligent_commerce"] } },
    { scope: { spendingWindowSeconds: 3600 } },
    { top: { expiresAt: "2026-09-30T00:00:00Z" } },
    { top: { delegatedTo: "agent_other" } },
    { top: { nonce: "different" } },
    { top: { policyVersion: "cp-other" } },
  ];
  for (const v of variants) {
    assert.notStrictEqual(
      mandateSigningPayload(mandate(v)),
      base,
      `${JSON.stringify(v)} must change the signed bytes`
    );
  }
});

test("canonicalization is order-independent and drops undefined", () => {
  assert.strictEqual(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
  assert.strictEqual(canonicalize({ a: 1, b: undefined }), '{"a":1}');
  assert.strictEqual(canonicalize({ n: { z: 1, a: 2 } }), '{"n":{"a":2,"z":1}}');
  assert.strictEqual(canonicalize([3, 1, 2]), "[3,1,2]", "array order is meaningful and preserved");
});

test("two mandates differing only in key order produce identical signing bytes", () => {
  // Rebuild the object with every key order reversed, at both levels, so the
  // only difference is insertion order.
  const a = mandate();
  const reverseKeys = (obj) =>
    Object.keys(obj)
      .reverse()
      .reduce((acc, k) => {
        const v = obj[k];
        acc[k] = v && typeof v === "object" && !Array.isArray(v) ? reverseKeys(v) : v;
        return acc;
      }, {});
  const reordered = reverseKeys(a);
  assert.notStrictEqual(
    JSON.stringify(a),
    JSON.stringify(reordered),
    "the two objects really do serialize differently before canonicalization"
  );
  assert.strictEqual(mandateSigningPayload(a), mandateSigningPayload(reordered));
});

// ── Projections ──────────────────────────────────────────────────────────

test("authorityScopeOf carries every constraint across to the chain vocabulary", () => {
  const scope = authorityScopeOf(mandate().authorityScope);
  assert.strictEqual(scope.currency, "USDC");
  assert.strictEqual(scope.maxAmountPerTxAtomic, USDC(50));
  assert.strictEqual(scope.maxCumulativeAtomic, USDC(500));
  assert.strictEqual(scope.requireHumanApprovalAboveAtomic, USDC(100));
  assert.deepStrictEqual(scope.allowedRails, ["stablecoin_cctp", "x402_usdc_arbitrum"]);
  assert.strictEqual(scope.spendingWindowSeconds, 86400);
});

test("remainingCumulative never goes negative", () => {
  const m = mandate();
  assert.strictEqual(remainingCumulative(m, USDC(100)), USDC(400));
  assert.strictEqual(remainingCumulative(m, USDC(500)), "0");
  assert.strictEqual(remainingCumulative(m, USDC(9999)), "0", "over-spend clamps to zero");
  assert.strictEqual(remainingCumulative(m, "0"), USDC(500));
});

test("remainingCumulative refuses a non-integer spend figure", () => {
  assert.throws(() => remainingCumulative(mandate(), "1.5"));
});
