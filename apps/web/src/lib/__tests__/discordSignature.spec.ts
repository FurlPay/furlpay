import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// The Ed25519 check on the interactions endpoint.
//
// This is the front door of the payments bot and it had no tests at all. The
// signature is not one control among several — it is the ONLY thing standing
// between the open internet and every handler behind it. `/api/discord/
// interactions` is a public POST endpoint: if the check is wrong, anyone can
// post a JSON body naming any snowflake in `member.user.id` and the router
// will treat it as that person. Every downstream protection — the admin
// allowlist, per-user account isolation, the verification gate — trusts the
// identity in that envelope, and the signature is the entire reason that trust
// is warranted.
//
// So these tests attack it as a forger would, with a real Ed25519 keypair
// rather than a mock, because a mocked verifier proves nothing about whether
// the real one accepts a forgery.
// ---------------------------------------------------------------------------

const keypair = crypto.generateKeyPairSync("ed25519");
// The raw 32-byte key, which is the form Discord publishes and the form the
// implementation has to wrap in DER SPKI itself.
const rawPublicKey = keypair.publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

let verifyDiscordSignature: (b: string, s: string | null, t: string | null) => boolean;

beforeAll(async () => {
  // The module captures the key at import time, so the env has to be set
  // before the import rather than before the call.
  process.env.DISCORD_PUBLIC_KEY = rawPublicKey;
  ({ verifyDiscordSignature } = await import("../discord"));
});

/** Sign exactly what Discord signs: timestamp concatenated with the raw body. */
function sign(timestamp: string, body: string, key = keypair.privateKey): string {
  return crypto.sign(null, Buffer.from(timestamp + body), key).toString("hex");
}

const BODY = JSON.stringify({ type: 2, member: { user: { id: "770000000000000001" } } });
const TS = "1757030400";

describe("a genuine Discord signature is accepted", () => {
  it("verifies a correctly signed body", () => {
    expect(verifyDiscordSignature(BODY, sign(TS, BODY), TS)).toBe(true);
  });

  it("is case-insensitive about hex, as Discord's own encoding varies", () => {
    const sig = sign(TS, BODY);
    expect(verifyDiscordSignature(BODY, sig.toUpperCase(), TS)).toBe(true);
  });
});

describe("forgery is rejected", () => {
  it("rejects a body altered after signing", () => {
    // The whole point. An attacker who captures one valid interaction must not
    // be able to swap the snowflake inside it for somebody else's.
    const sig = sign(TS, BODY);
    const tampered = BODY.replace("770000000000000001", "111111111111111111");
    expect(verifyDiscordSignature(tampered, sig, TS)).toBe(false);
  });

  it("rejects a signature made with a different key", () => {
    // Anyone can run an Ed25519 signer. Only Discord's key may pass.
    const attacker = crypto.generateKeyPairSync("ed25519");
    expect(verifyDiscordSignature(BODY, sign(TS, BODY, attacker.privateKey), TS)).toBe(false);
  });

  it("rejects a valid signature replayed under a different timestamp", () => {
    // The timestamp is inside the signed bytes, so changing it must invalidate
    // the signature rather than being silently ignored.
    expect(verifyDiscordSignature(BODY, sign(TS, BODY), "1757030401")).toBe(false);
  });

  it("rejects a signature for a different body entirely", () => {
    const other = JSON.stringify({ type: 2, member: { user: { id: "999" } } });
    expect(verifyDiscordSignature(BODY, sign(TS, other), TS)).toBe(false);
  });
});

describe("malformed input fails closed", () => {
  it("rejects a missing signature", () => {
    expect(verifyDiscordSignature(BODY, null, TS)).toBe(false);
  });

  it("rejects a missing timestamp", () => {
    expect(verifyDiscordSignature(BODY, sign(TS, BODY), null)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyDiscordSignature(BODY, "", TS)).toBe(false);
  });

  it("rejects non-hex and wrong-length signatures without throwing", () => {
    // A throw here would surface as a 500 rather than a 401, and an endpoint
    // that 500s on a malformed probe is an endpoint Discord will drop.
    for (const bad of ["zz", "not-hex", "ab".repeat(63), "ab".repeat(65), "  "]) {
      expect(() => verifyDiscordSignature(BODY, bad, TS)).not.toThrow();
      expect(verifyDiscordSignature(BODY, bad, TS), bad).toBe(false);
    }
  });

  it("rejects a signature of the right length that is not a valid point", () => {
    expect(verifyDiscordSignature(BODY, "f".repeat(128), TS)).toBe(false);
  });
});

describe("the empty body case", () => {
  it("still requires a signature over it", () => {
    // An unsigned empty POST must not be mistaken for a benign no-op.
    expect(verifyDiscordSignature("", "ab".repeat(64), TS)).toBe(false);
    expect(verifyDiscordSignature("", sign(TS, ""), TS)).toBe(true);
  });
});
