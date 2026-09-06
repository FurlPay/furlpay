import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AUTHORIZATION_TTL_MS,
  clientSafeRefusal,
  consumeAuthorization,
  mintAuthorization,
} from "../authorization";
import { intentDigest, type CanonicalIntent } from "../canonical";
import type { SimulationResult, UserConfirmation } from "../boundary";
import type { AppIntegritySignal } from "../types";

// ---------------------------------------------------------------------------
// Signing authorization — the enforcement layer.
//
// The property under test: a caller cannot choose the bytes that get signed.
// Every attack from the brief is exercised end-to-end through mint → consume.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
let counter = 0;

function intent(over: Partial<CanonicalIntent> = {}): CanonicalIntent {
  return {
    action: "transfer",
    intentId: `itx_${++counter}`,
    accountId: "acc_1",
    chain: "arbitrum",
    assetId: "USDC.arbitrum",
    amountMinor: "10000000", // 10 USDC
    destination: "0x" + "a1".repeat(20),
    nonce: "nonce_1",
    issuedAt: NOW - 5_000,
    expiresAt: NOW + 300_000,
    ...over,
  };
}

const sim = (i: CanonicalIntent, over: Partial<SimulationResult> = {}): SimulationResult => ({
  outcome: "clean",
  boundDigest: intentDigest(i),
  provider: "test",
  simulatedAt: new Date(NOW - 3_000).toISOString(),
  warnings: [],
  ...over,
});

const conf = (i: CanonicalIntent, over: Partial<UserConfirmation> = {}): UserConfirmation => ({
  boundDigest: intentDigest(i),
  confirmedAt: new Date(NOW - 1_000).toISOString(),
  ...over,
});

const attest = (i: CanonicalIntent, over: Partial<AppIntegritySignal> = {}): AppIntegritySignal => ({
  platform: "android",
  verdict: "passed",
  requestBound: true,
  boundDigest: intentDigest(i),
  verifiedAt: new Date(NOW - 1_000).toISOString(),
  ...over,
});

const WALLET = "0x" + "9f".repeat(20);
const DEVICE = "dev_" + "a".repeat(32);
const INSTANCE = "inst_" + "b".repeat(32);
const CHALLENGE = "chal_" + "c".repeat(32);
const KEY_VERSION = 1;

/**
 * Principals every consume() call must supply.
 *
 * Written out because these fields were added AFTER the first tests, and spec
 * files are excluded from `tsc` (tsconfig.json). Omitting them left both sides
 * of each comparison `undefined`, so `undefined !== undefined` was false and
 * every new binding check passed vacuously — tests green, nothing proved.
 */
const PRINCIPALS = {
  userId: "user_1",
  walletId: WALLET,
  deviceId: DEVICE,
  appInstanceId: INSTANCE,
  currentDeviceKeyVersion: KEY_VERSION,
  challengeId: CHALLENGE,
} as const;

async function mintFor(i: CanonicalIntent, over: Record<string, unknown> = {}) {
  return mintAuthorization({
    intent: i,
    expected: { nonce: i.nonce, accountId: i.accountId },
    userId: "user_1",
    walletId: WALLET,
    deviceId: DEVICE,
    appInstanceId: INSTANCE,
    deviceKeyVersion: KEY_VERSION,
    challengeId: CHALLENGE,
    transactionVersion: 1,
    simulation: sim(i),
    integrity: attest(i),
    confirmation: conf(i),
    now: NOW,
    ...over,
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("minting requires every control to agree", () => {
  it("mints when simulation, attestation and confirmation all bind", async () => {
    const result = await mintFor(intent());
    expect(result.ok).toBe(true);
    expect(result.authorization!.authorizationId).toMatch(/^auth_[0-9a-f]{32}$/);
  });

  it("stores the INTENT, not just its digest", async () => {
    // Storing only a digest would mean trusting a value we cannot recompute —
    // the exact property this layer exists to remove.
    const i = intent();
    const result = await mintFor(i);
    expect(result.authorization!.intent).toEqual(i);
    expect(result.authorization!.canonicalDigest).toBe(intentDigest(i));
  });

  it("REFUSES to mint when the simulation is for another transaction", async () => {
    const result = await mintFor(intent(), { simulation: sim(intent({ amountMinor: "1" })) });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("simulation_unbound");
  });

  it("REFUSES to mint when the confirmation is for another transaction", async () => {
    const result = await mintFor(intent(), { confirmation: conf(intent({ amountMinor: "1" })) });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("confirmation_unbound");
  });

  it("REFUSES to mint on a malicious simulation", async () => {
    const i = intent();
    const result = await mintFor(i, { simulation: sim(i, { outcome: "malicious" }) });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("simulation_malicious");
  });

  it("MINTS with no attestation at all — the deliberate asymmetry", async () => {
    // Missing evidence is degraded, not contradictory. Hard-gating here would
    // block every device that cannot attest while an attacker moves platform.
    const result = await mintFor(intent(), { integrity: null });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/No device integrity signal/);
  });

  it("REFUSES a PASSING attestation bound to another transaction", async () => {
    // Contradictory evidence, not missing evidence. Always blocks.
    const result = await mintFor(intent(), { integrity: attest(intent({ amountMinor: "1" })) });
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("integrity_unbound");
  });
});

describe("ATTACK: the signed transaction differs from the authorized one", () => {
  it("BLOCKS a $10 authorization used to sign $10,000", async () => {
    const authorized = intent({ amountMinor: "10000000" });
    const minted = await mintFor(authorized);
    expect(minted.ok).toBe(true);

    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentTransactionVersion: 1,
      // The signer path rebuilt something else.
      aboutToSign: { ...authorized, amountMinor: "10000000000" },
      now: NOW + 1_000,
    });

    expect(consumed.ok).toBe(false);
    expect(consumed.failures).toContain("signing_payload_mismatch");
  });

  it("BLOCKS a recipient substitution at the signer", async () => {
    const authorized = intent();
    const minted = await mintFor(authorized);
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentTransactionVersion: 1,
      aboutToSign: { ...authorized, destination: "0x" + "ff".repeat(20) },
      now: NOW + 1_000,
    });
    expect(consumed.failures).toContain("signing_payload_mismatch");
  });

  it("BLOCKS a transfer rebuilt as an approval", async () => {
    const authorized = intent();
    const minted = await mintFor(authorized);
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentTransactionVersion: 1,
      aboutToSign: { ...authorized, action: "approve", spender: "0x" + "ee".repeat(20) },
      now: NOW + 1_000,
    });
    expect(consumed.failures).toContain("signing_payload_mismatch");
  });

  it("ALLOWS the honest path where nothing was rebuilt", async () => {
    // /api/mpc/sign signs the server's own stored intent and constructs
    // nothing, so there is no second build to cross-check.
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    });
    expect(consumed.ok).toBe(true);
    expect(consumed.authorization!.canonicalDigest).toBe(minted.authorization!.canonicalDigest);
  });
});

describe("ATTACK: replay", () => {
  it("BLOCKS a second use of the same authorization", async () => {
    const minted = await mintFor(intent());
    const id = minted.authorization!.authorizationId;
    const args = {
      authorizationId: id,
      ...PRINCIPALS,
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    };

    expect((await consumeAuthorization(args)).ok).toBe(true);
    const replay = await consumeAuthorization(args);
    expect(replay.ok).toBe(false);
    expect(replay.failures).toContain("authorization_replayed");
  });

  it("BLOCKS concurrent double-spend of one authorization", async () => {
    // The claim is an atomic SET NX taken BEFORE validation, so exactly one of
    // two simultaneous requests can win. On serverless these would be on
    // different instances, where nothing process-local would notice.
    const minted = await mintFor(intent());
    const args = {
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    };

    const [a, b] = await Promise.all([consumeAuthorization(args), consumeAuthorization(args)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.failures).toContain("authorization_replayed");
  });

  it("still recognises a replay after the authorization itself expired", async () => {
    // The consumed marker outlives the authorization, so a late replay reads
    // as a replay rather than as an unknown id.
    const minted = await mintFor(intent());
    const args = {
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentTransactionVersion: 1,
    };
    await consumeAuthorization({ ...args, now: NOW + 1_000 });
    const late = await consumeAuthorization({ ...args, now: NOW + AUTHORIZATION_TTL_MS + 60_000 });
    expect(late.failures).toContain("authorization_replayed");
  });
});

describe("ATTACK: expiry and TOCTOU", () => {
  it("BLOCKS an expired authorization", async () => {
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentTransactionVersion: 1,
      now: NOW + AUTHORIZATION_TTL_MS + 1_000,
    });
    expect(consumed.ok).toBe(false);
    // Either the record aged out of the store or the explicit expiry fired.
    // Both are correct refusals; neither signs.
    expect(
      consumed.failures.includes("authorization_expired") ||
        consumed.failures.includes("authorization_not_found")
    ).toBe(true);
  });

  it("BLOCKS when the transaction moved after authorization — TOCTOU", async () => {
    // A mutation requires a NEW security cycle, never a silent re-sign of the
    // changed transaction.
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentTransactionVersion: 2, // advanced since mint
      now: NOW + 1_000,
    });
    expect(consumed.ok).toBe(false);
    expect(consumed.failures).toContain("transaction_version_mismatch");
  });

  it("BLOCKS an unknown authorization id", async () => {
    const consumed = await consumeAuthorization({
      authorizationId: "auth_" + "0".repeat(32),
      ...PRINCIPALS,
      currentTransactionVersion: 1,
      now: NOW,
    });
    expect(consumed.failures).toContain("authorization_not_found");
  });
});

describe("ATTACK: authorization theft across principals", () => {
  it("BLOCKS a different user presenting the authorization", async () => {
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      userId: "user_2", // not the minting user
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    });
    expect(consumed.ok).toBe(false);
    expect(consumed.failures).toContain("authorization_user_mismatch");
  });

  it("BLOCKS signing with a different wallet than authorized", async () => {
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      walletId: "0x" + "11".repeat(20),
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    });
    expect(consumed.ok).toBe(false);
    expect(consumed.failures).toContain("authorization_wallet_mismatch");
  });
});

describe("ATTACK: device and app-instance substitution", () => {
  // These are the tests that make the new bindings non-vacuous. Each supplies
  // a REAL value on one side and a DIFFERENT real value on the other, so the
  // comparison is exercised rather than being undefined === undefined.

  it("BLOCKS an authorization presented from a different device", async () => {
    // The stolen-token replay. A valid session for the right user, on the
    // wrong phone, must not be able to spend an authorization.
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      deviceId: "dev_" + "9".repeat(32),
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    });
    expect(consumed.ok).toBe(false);
    expect(consumed.failures).toContain("authorization_device_mismatch");
  });

  it("BLOCKS a different app instance on the same device", async () => {
    // Catches "restored from a backup" and "reinstalled alongside": same
    // hardware, different installation.
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      appInstanceId: "inst_" + "9".repeat(32),
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    });
    expect(consumed.ok).toBe(false);
    expect(consumed.failures).toContain("authorization_app_instance_mismatch");
  });

  it("BLOCKS after the device key rotated or was revoked", async () => {
    // Retroactive revocation. Revoking bumps the key version, so outstanding
    // authorizations stop verifying without having to enumerate and delete
    // them — a scan a KV store cannot do atomically.
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      currentDeviceKeyVersion: KEY_VERSION + 1,
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    });
    expect(consumed.ok).toBe(false);
    expect(consumed.failures).toContain("authorization_device_key_rotated");
  });

  it("BLOCKS a challenge from a different operation", async () => {
    // Prevents splicing two half-authorised flows into one signature.
    const minted = await mintFor(intent());
    const consumed = await consumeAuthorization({
      authorizationId: minted.authorization!.authorizationId,
      ...PRINCIPALS,
      challengeId: "chal_" + "9".repeat(32),
      currentTransactionVersion: 1,
      now: NOW + 1_000,
    });
    expect(consumed.ok).toBe(false);
    expect(consumed.failures).toContain("authorization_challenge_mismatch");
  });

  it("records the principals on the authorization so they can be checked", async () => {
    // Guards against a regression where the fields stop being persisted and
    // every comparison silently becomes undefined === undefined again.
    const minted = await mintFor(intent());
    const a = minted.authorization!;
    expect(a.deviceId).toBe(DEVICE);
    expect(a.appInstanceId).toBe(INSTANCE);
    expect(a.deviceKeyVersion).toBe(KEY_VERSION);
    expect(a.challengeId).toBe(CHALLENGE);
  });
});

describe("client-safe refusals do not map the defences", () => {
  it("collapses every binding mismatch to one opaque message", async () => {
    // The difference between "your simulation was for another transaction" and
    // "your confirmation was" is exactly what an attacker uses to find the seam.
    const messages = new Set(
      (
        [
          ["simulation_unbound"],
          ["confirmation_unbound"],
          ["integrity_unbound"],
          ["signing_payload_mismatch"],
          ["transaction_version_mismatch"],
          ["authorization_user_mismatch"],
        ] as const
      ).map((f) => clientSafeRefusal([...f]).error)
    );
    expect(messages).toEqual(new Set(["authorization_invalid"]));
  });

  it("names expiry and replay, which the legitimate client must handle", () => {
    expect(clientSafeRefusal(["authorization_expired"]).error).toBe("authorization_expired");
    expect(clientSafeRefusal(["authorization_expired"]).retryable).toBe(true);
    expect(clientSafeRefusal(["authorization_replayed"]).error).toBe("authorization_already_used");
    expect(clientSafeRefusal(["authorization_replayed"]).retryable).toBe(false);
  });

  it("never leaks a digest or an internal reason string", () => {
    const safe = clientSafeRefusal(["signing_payload_mismatch", "integrity_unbound"]);
    expect(JSON.stringify(safe)).not.toMatch(/[0-9a-f]{64}/);
    expect(JSON.stringify(safe)).not.toMatch(/integrity_unbound|payload_mismatch/);
  });
});
