// ---------------------------------------------------------------------------
// Tests for @furlpay/google-mpc
// ---------------------------------------------------------------------------

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
  maxTransactionAmount,
  allowedRecipients,
  requireApproval,
  velocityLimit,
  sanctionsCheck,
  allowedChains,
  businessHoursOnly,
  validateCedarSyntax,
  GoogleMpcSigner,
} from "../index.js";

// ── Cedar policy builders ───────────────────────────────────────────────────

describe("Cedar policy builders", () => {
  it("maxTransactionAmount produces a FORBID policy", () => {
    const p = maxTransactionAmount(10_000);
    assert.equal(p.effect, "FORBID");
    assert.ok(p.cedarPolicy.includes('decimal("10000.00")'));
    assert.ok(p.cedarPolicy.startsWith("forbid"));
    assert.ok(p.cedarPolicy.endsWith(";"));
  });

  it("maxTransactionAmount rejects non-positive", () => {
    assert.throws(() => maxTransactionAmount(0), /positive/);
    assert.throws(() => maxTransactionAmount(-1), /positive/);
    assert.throws(() => maxTransactionAmount(NaN), /positive/);
  });

  it("allowedRecipients produces a PERMIT policy with addresses", () => {
    const addrs = ["0xABC123", "0xDEF456"];
    const p = allowedRecipients(addrs);
    assert.equal(p.effect, "PERMIT");
    assert.ok(p.cedarPolicy.includes('"0xabc123"')); // lowercased
    assert.ok(p.cedarPolicy.includes('"0xdef456"'));
    assert.ok(p.cedarPolicy.startsWith("permit"));
  });

  it("allowedRecipients rejects empty list", () => {
    assert.throws(() => allowedRecipients([]), /at least one/);
  });

  it("requireApproval produces a FORBID policy", () => {
    const p = requireApproval(3);
    assert.equal(p.effect, "FORBID");
    assert.ok(p.cedarPolicy.includes("3"));
    assert.ok(p.cedarPolicy.includes("approvals.count"));
  });

  it("requireApproval rejects zero/negative", () => {
    assert.throws(() => requireApproval(0), /positive/);
    assert.throws(() => requireApproval(-1), /positive/);
  });

  it("velocityLimit produces a FORBID policy", () => {
    const p = velocityLimit(50_000, 3600);
    assert.equal(p.effect, "FORBID");
    assert.ok(p.cedarPolicy.includes('decimal("50000.00")'));
    assert.ok(p.cedarPolicy.includes("3600"));
    assert.ok(p.cedarPolicy.includes("velocity"));
  });

  it("sanctionsCheck produces a FORBID policy", () => {
    const p = sanctionsCheck();
    assert.equal(p.effect, "FORBID");
    assert.ok(p.cedarPolicy.includes("sanctioned"));
  });

  it("allowedChains produces a FORBID-unless policy", () => {
    const p = allowedChains(["ethereum", "solana"]);
    assert.equal(p.effect, "FORBID");
    assert.ok(p.cedarPolicy.includes('"ethereum"'));
    assert.ok(p.cedarPolicy.includes('"solana"'));
    assert.ok(p.cedarPolicy.includes("unless"));
  });

  it("businessHoursOnly produces a FORBID-unless policy", () => {
    const p = businessHoursOnly(9, 17);
    assert.equal(p.effect, "FORBID");
    assert.ok(p.cedarPolicy.includes("9"));
    assert.ok(p.cedarPolicy.includes("17"));
  });
});

// ── Cedar syntax validation ─────────────────────────────────────────────────

describe("validateCedarSyntax", () => {
  it("accepts valid policies from builders", () => {
    const p = maxTransactionAmount(1000);
    assert.deepEqual(validateCedarSyntax(p.cedarPolicy), []);
  });

  it("rejects empty input", () => {
    const issues = validateCedarSyntax("");
    assert.ok(issues.length > 0);
    assert.ok(issues[0]!.includes("empty"));
  });

  it("rejects missing semicolon", () => {
    const issues = validateCedarSyntax('permit (principal, action, resource) when { true }');
    assert.ok(issues.some((i) => i.includes("semicolon")));
  });

  it("rejects unbalanced braces", () => {
    const issues = validateCedarSyntax('forbid (principal, action, resource) when { ;');
    assert.ok(issues.some((i) => i.includes("braces")));
  });

  it("rejects missing permit/forbid", () => {
    const issues = validateCedarSyntax('allow (principal, action, resource);');
    assert.ok(issues.some((i) => i.includes("permit") || i.includes("forbid")));
  });
});

// ── GoogleMpcSigner (mock mode) ─────────────────────────────────────────────

describe("GoogleMpcSigner (mock mode)", () => {
  let signer: GoogleMpcSigner;

  before(() => {
    // Ensure we're in development mode (mock path)
    delete process.env.GOOGLE_MPC_PROJECT_ID;
    delete process.env.GOOGLE_MPC_LOCATION;
    process.env.NODE_ENV = "test";
    signer = GoogleMpcSigner.fromEnv();
  });

  it("reports not using real MPC", () => {
    assert.equal(signer.usingRealMpc, false);
  });

  it("produces a valid mock signature", async () => {
    const hash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const result = await signer.sign(hash);
    assert.equal(result.cosigned, true);
    assert.deepEqual(result.shares, ["A", "B"]);
    assert.ok(result.signature.startsWith("0x"));
    assert.ok(result.signature.length > 10);
  });

  it("produces deterministic signatures for the same input", async () => {
    const hash = "deadbeef".repeat(8);
    const r1 = await signer.sign(hash);
    const r2 = await signer.sign(hash);
    assert.equal(r1.signature, r2.signature);
  });

  it("refuses when off-chain policy says no", async () => {
    const hash = "1234".repeat(16);
    await assert.rejects(
      () => signer.sign(hash, undefined, { approved: false, reasons: ["velocity breach"] }),
      /velocity breach/
    );
  });

  it("refuses in production mode", async () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const s = new GoogleMpcSigner({ mpcConfig: null });
      await assert.rejects(
        () => s.sign("1234".repeat(16)),
        /disabled in production/
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});
