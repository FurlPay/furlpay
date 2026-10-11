"use strict";
const test = require("node:test");
const assert = require("node:assert");
const s = require("../dist/index.js");

test("TOTP matches RFC 6238 test vector (SHA1, 8 digits, T=59)", () => {
  // RFC 6238 seed "12345678901234567890" in base32.
  const secret = s.base32Encode(Buffer.from("12345678901234567890"));
  const code = s.totp(secret, { digits: 8, time: 59, algorithm: "sha1" });
  assert.strictEqual(code, "94287082");
});

test("base32 encode/decode roundtrip", () => {
  const secret = s.generateSecret();
  assert.deepStrictEqual(s.base32Decode(secret).length > 0, true);
});

test("verifyTotp accepts a fresh code and rejects a wrong one", () => {
  const secret = s.generateSecret();
  const now = Math.floor(Date.now() / 1000);
  const code = s.totp(secret, { time: now });
  assert.strictEqual(s.verifyTotp(secret, code, { time: now }), true);
  assert.strictEqual(s.verifyTotp(secret, "000000", { time: now }), false);
});

test("step-up required for transfers >= $5000 and sensitive actions", () => {
  assert.strictEqual(s.requiresStepUp({ action: "transfer", amountUsd: 6000 }).required, true);
  assert.strictEqual(s.requiresStepUp({ action: "transfer", amountUsd: 100 }).required, false);
  assert.strictEqual(s.requiresStepUp({ action: "reveal_card" }).required, true);
});

test("MPC server share refuses to co-sign when policy fails", () => {
  const partial = s.clientPartialSign("0xhash", "passkey-proof");
  assert.throws(() => s.serverCoSign("0xhash", partial, { approved: false, reasons: ["velocity"] }));
});

test("MPC co-signs when policy approves", () => {
  const partial = s.clientPartialSign("0xhash", "passkey-proof");
  const res = s.serverCoSign("0xhash", partial, { approved: true });
  assert.strictEqual(res.cosigned, true);
  assert.match(res.signature, /^0x[0-9a-f]{130}$/);
});

test("mock MPC refuses to run in production (audit F-21)", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => s.clientPartialSign("0xhash", "proof"), /disabled in production/);
    assert.throws(
      () => s.serverCoSign("0xhash", { share: "A", value: "x" }, { approved: true }),
      /disabled in production/
    );
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("risk engine blocks automation and allows clean device", () => {
  assert.strictEqual(s.assessRisk({ automation: true }).action, "block");
  assert.strictEqual(s.assessRisk({}).action, "allow");
});
