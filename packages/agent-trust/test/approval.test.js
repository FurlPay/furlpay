import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { generateKeypair } from "../dist/src/index.js";
import {
  issueApproval,
  verifyApproval,
  approvalFromExtra,
  X402_APPROVAL_EXTRA_KEY,
} from "../dist/src/approval.js";

// ---------------------------------------------------------------------------
// Step-up approval evidence for bare x402.
//
// Every test here is really one question: does this prove a human approved THIS
// payment, or only that a human once approved something? The difference is the
// whole value of the format, and it is invisible unless the tests attack the
// binding rather than the happy path.
// ---------------------------------------------------------------------------

const user = generateKeypair("user");
const other = generateKeypair("user");
const MANDATE = "mnd_abc";
const HASH = "0xpaymenthash";

const base = {
  userPrivateKeyPem: user.privateKeyPem,
  userPublicKeyPem: user.publicKeyPem,
  mandateId: MANDATE,
  paymentHash: HASH,
};

const check = (over = {}) =>
  verifyApproval(over.approval ?? issueApproval(base), {
    userPublicKeyPem: user.publicKeyPem,
    paymentHash: HASH,
    mandateId: MANDATE,
    maxAgeSeconds: 300,
    ...over,
  });

test("a fresh approval for this payment verifies", () => {
  const r = check();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.userKeyId, user.keyId);
});

test("AN APPROVAL FOR ANOTHER PAYMENT DOES NOT TRANSFER", () => {
  // Without this the format proves only that the user approved something, and
  // one approval would step up every above-threshold payment thereafter.
  const approval = issueApproval({ ...base, paymentHash: "0xsomeotherpayment" });
  assert.strictEqual(check({ approval }).reason, "payment_mismatch");
});

test("an approval issued under another mandate does not transfer", () => {
  // Stops evidence minted under a $50 mandate being presented under a $5000 one.
  const approval = issueApproval({ ...base, mandateId: "mnd_different" });
  assert.strictEqual(check({ approval }).reason, "mandate_mismatch");
});

test("a valid signature from the WRONG user is refused", () => {
  // The signature proves someone signed. The key id inside the claims is what
  // proves it was the user this mandate names.
  const approval = issueApproval({
    ...base,
    userPrivateKeyPem: other.privateKeyPem,
    userPublicKeyPem: other.publicKeyPem,
  });
  // Verified against the OTHER key it is internally consistent...
  assert.strictEqual(
    verifyApproval(approval, {
      userPublicKeyPem: other.publicKeyPem,
      paymentHash: HASH,
      mandateId: MANDATE,
      maxAgeSeconds: 300,
    }).ok,
    true
  );
  // ...but presented for our mandate's user, it fails at the signature.
  assert.strictEqual(check({ approval }).reason, "signature_invalid");
});

test("an approval whose claimed key id is not the verifying key is refused", () => {
  // Hand-built: correct signature over claims naming a DIFFERENT key id. The
  // signature check alone would pass this.
  const claims = {
    v: 1, m: MANDATE, h: HASH, k: other.keyId,
    t: Math.floor(Date.now() / 1000), n: "abc",
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = crypto.sign(null, Buffer.from(payload), user.privateKeyPem).toString("base64url");
  assert.strictEqual(check({ approval: { payload, signature } }).reason, "key_mismatch");
});

test("a tampered payload does not verify", () => {
  const approval = issueApproval(base);
  const claims = JSON.parse(Buffer.from(approval.payload, "base64url").toString("utf8"));
  claims.h = "0xattacker-chosen";
  const tampered = Buffer.from(JSON.stringify(claims)).toString("base64url");
  assert.strictEqual(check({ approval: { ...approval, payload: tampered } }).reason, "signature_invalid");
});

test("stale evidence expires", () => {
  // An approval with no age bound authorizes above-threshold payments forever,
  // which is the thing a threshold exists to prevent.
  const now = Math.floor(Date.now() / 1000);
  const approval = issueApproval({ ...base, nowSeconds: now - 600 });
  assert.strictEqual(check({ approval, maxAgeSeconds: 300 }).reason, "expired");
  assert.strictEqual(check({ approval, maxAgeSeconds: 900 }).ok, true);
});

test("future-dated evidence is refused, not treated as very fresh", () => {
  const now = Math.floor(Date.now() / 1000);
  const approval = issueApproval({ ...base, nowSeconds: now + 3600 });
  assert.strictEqual(check({ approval }).reason, "future_dated");
});

test("a little clock skew is tolerated", () => {
  const now = Math.floor(Date.now() / 1000);
  const approval = issueApproval({ ...base, nowSeconds: now + 30 });
  assert.strictEqual(check({ approval }).ok, true);
});

test("malformed input is refused rather than throwing", () => {
  assert.strictEqual(verifyApproval(null, { userPublicKeyPem: user.publicKeyPem, paymentHash: HASH, mandateId: MANDATE, maxAgeSeconds: 300 }).reason, "malformed");
  assert.strictEqual(check({ approval: { payload: "!!!", signature: "!!!" } }).reason, "signature_invalid");
  assert.strictEqual(check({ approval: { payload: 5, signature: "x" } }).reason, "malformed");
});

test("two approvals of the same payment are distinguishable", () => {
  // The nonce exists so an operator can tell a re-approval from a replay.
  const a = issueApproval(base);
  const b = issueApproval(base);
  assert.notStrictEqual(a.payload, b.payload);
});

// ── transport ──────────────────────────────────────────────────────────────

test("it rides in x402 `extra` with no new transport", () => {
  const approval = issueApproval(base);
  const xPaymentExtra = { [X402_APPROVAL_EXTRA_KEY]: approval };
  assert.deepStrictEqual(approvalFromExtra(xPaymentExtra), approval);
});

test("extraction never trusts what it finds", () => {
  assert.strictEqual(approvalFromExtra(undefined), null);
  assert.strictEqual(approvalFromExtra({}), null);
  assert.strictEqual(approvalFromExtra({ approval: "a-string" }), null);
  assert.strictEqual(approvalFromExtra({ approval: { payload: 1, signature: 2 } }), null);
});

test("the wire form is two base64url strings and nothing else", () => {
  // "Minimal and portable" as an assertion: anything that can carry two short
  // strings can carry this, which is why it needs no AP2 envelope.
  const approval = issueApproval(base);
  assert.deepStrictEqual(Object.keys(approval).sort(), ["payload", "signature"]);
  assert.match(approval.payload, /^[A-Za-z0-9_-]+$/);
  assert.match(approval.signature, /^[A-Za-z0-9_-]+$/);
});
