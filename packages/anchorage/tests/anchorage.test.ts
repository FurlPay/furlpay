// ---------------------------------------------------------------------------
// Tests for @furlpay/anchorage
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  canonicalRequest,
  signCanonical,
  verifyCanonical,
  authHeaders,
  verifyWebhook,
  EventDeduplicator,
} from "../index.js";

// ── Ed25519 request signing ─────────────────────────────────────────────────

describe("Ed25519 request signing", () => {
  // Generate a throwaway Ed25519 keypair for tests
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("canonicalRequest formats correctly without body", () => {
    const cr = canonicalRequest("GET", "/v2/vaults", 1700000000);
    assert.equal(cr, "GET\n/v2/vaults\n1700000000\n");
  });

  it("canonicalRequest formats correctly with body", () => {
    const body = '{"amount":"100"}';
    const cr = canonicalRequest("POST", "/v2/transfers", 1700000000, body);
    const expectedHash = crypto.createHash("sha256").update(body).digest("hex");
    assert.equal(cr, `POST\n/v2/transfers\n1700000000\n${expectedHash}`);
  });

  it("sign and verify round-trip works", () => {
    const cr = canonicalRequest("POST", "/v2/transfers", 1700000000, '{"test":true}');
    const sig = signCanonical(cr, privPem);
    assert.ok(sig.length > 0);
    assert.ok(verifyCanonical(cr, sig, pubPem));
  });

  it("verify rejects tampered canonical request", () => {
    const cr = canonicalRequest("POST", "/v2/transfers", 1700000000, '{"test":true}');
    const sig = signCanonical(cr, privPem);
    const tampered = cr.replace("POST", "PUT");
    assert.equal(verifyCanonical(tampered, sig, pubPem), false);
  });

  it("verify rejects wrong key", () => {
    const { publicKey: otherPub } = crypto.generateKeyPairSync("ed25519");
    const otherPem = otherPub.export({ type: "spki", format: "pem" }).toString();
    const cr = canonicalRequest("GET", "/v2/vaults", 1700000000);
    const sig = signCanonical(cr, privPem);
    assert.equal(verifyCanonical(cr, sig, otherPem), false);
  });

  it("authHeaders returns all required headers", () => {
    const headers = authHeaders("GET", "/v2/vaults", "test-api-key", privPem);
    assert.equal(headers["Api-Access-Key"], "test-api-key");
    assert.ok(headers["Api-Signature"]!.length > 0);
    assert.ok(Number(headers["Api-Timestamp"]) > 0);
  });
});

// ── Webhook verification ────────────────────────────────────────────────────

describe("Webhook verification", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  function makeSignedEvent(overrides?: Partial<Record<string, unknown>>) {
    const event = {
      eventId: "evt_test_001",
      eventType: "TRANSFER_COMPLETED",
      timestamp: new Date().toISOString(),
      payload: { transferId: "txn_123", status: "COMPLETED" },
      signature: "",
      ...overrides,
    };
    const body = JSON.stringify(event);
    const sig = crypto.sign(null, new Uint8Array(Buffer.from(body)), privateKey).toString("base64");
    return { body, sig };
  }

  it("accepts a valid signed webhook", () => {
    const { body, sig } = makeSignedEvent();
    const result = verifyWebhook(body, sig, { signingPublicKey: pubPem });
    assert.equal(result.valid, true);
    assert.ok(result.event);
    assert.equal(result.event!.eventType, "TRANSFER_COMPLETED");
  });

  it("rejects a tampered body", () => {
    const { body, sig } = makeSignedEvent();
    const tampered = body.replace("COMPLETED", "FAILED");
    const result = verifyWebhook(tampered, sig, { signingPublicKey: pubPem });
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes("Signature"));
  });

  it("rejects a wrong key", () => {
    const { publicKey: otherPub } = crypto.generateKeyPairSync("ed25519");
    const otherPem = otherPub.export({ type: "spki", format: "pem" }).toString();
    const { body, sig } = makeSignedEvent();
    const result = verifyWebhook(body, sig, { signingPublicKey: otherPem });
    assert.equal(result.valid, false);
  });

  it("rejects stale events", () => {
    const old = new Date(Date.now() - 600_000).toISOString(); // 10 min ago
    const { body, sig } = makeSignedEvent({ timestamp: old });
    const result = verifyWebhook(body, sig, { signingPublicKey: pubPem, maxAgeSecs: 300 });
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes("old"));
  });

  it("rejects malformed JSON", () => {
    const result = verifyWebhook("not json", "sig", { signingPublicKey: pubPem });
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes("JSON"));
  });
});

// ── Event deduplicator ──────────────────────────────────────────────────────

describe("EventDeduplicator", () => {
  it("first event is not a duplicate", () => {
    const dedup = new EventDeduplicator();
    assert.equal(dedup.isDuplicate("evt_001"), false);
  });

  it("second occurrence is a duplicate", () => {
    const dedup = new EventDeduplicator();
    dedup.isDuplicate("evt_002");
    assert.equal(dedup.isDuplicate("evt_002"), true);
  });

  it("evicts oldest when at capacity", () => {
    const dedup = new EventDeduplicator(3);
    dedup.isDuplicate("a"); // seen: [a]
    dedup.isDuplicate("b"); // seen: [a, b]
    dedup.isDuplicate("c"); // seen: [a, b, c]
    dedup.isDuplicate("d"); // evicts "a", seen: [b, c, d]
    assert.equal(dedup.isDuplicate("a"), false); // "a" was evicted, fresh again
    assert.equal(dedup.isDuplicate("d"), true);  // "d" is still tracked
  });
});
