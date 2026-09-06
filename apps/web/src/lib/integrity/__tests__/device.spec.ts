import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkDevice,
  deviceIdForKey,
  deviceTrustTier,
  getDevice,
  recordAttestation,
  registerDevice,
  revokeDevice,
  rotateDeviceKey,
} from "../device";
import { consumeChallenge, issueChallenge, CHALLENGE_TTL_MS } from "../challenge";

// ---------------------------------------------------------------------------
// Device registry and signing challenge.
//
// The property under test: a device identifier the CLIENT chooses is a
// suggestion, not an identity, and trust is a conclusion the server reaches
// rather than a claim the client makes.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
let n = 0;
const key = () => `SPKI_PUBLIC_KEY_${++n}_${"x".repeat(40)}`;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("device identity is server-derived", () => {
  it("derives the id from the public key, deterministically", async () => {
    // A self-asserted id can be copied to a second device along with the
    // token, and then both devices are "the same device".
    const k = key();
    expect(deviceIdForKey(k)).toBe(deviceIdForKey(k));
    expect(deviceIdForKey(k)).not.toBe(deviceIdForKey(key()));
    expect(deviceIdForKey(k)).toMatch(/^dev_[0-9a-f]{32}$/);
  });

  it("returns the same device when the same key re-registers", async () => {
    const k = key();
    const a = await registerDevice({ userId: "u1", publicKey: k, platform: "android" }, NOW);
    const b = await registerDevice({ userId: "u1", publicKey: k, platform: "android" }, NOW);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.device.deviceId).toBe(b.device.deviceId);
  });

  it("REFUSES a key already bound to another user", async () => {
    // Rebinding would let an attacker who compromised one account inherit a
    // trusted device record.
    const k = key();
    await registerDevice({ userId: "u1", publicKey: k, platform: "android" }, NOW);
    const stolen = await registerDevice({ userId: "u2", publicKey: k, platform: "android" }, NOW);
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.reason).toBe("key_bound_to_other_user");
  });

  it("rejects a malformed public key", async () => {
    for (const bad of ["", "short", "x".repeat(5000)]) {
      const r = await registerDevice({ userId: "u1", publicKey: bad, platform: "android" }, NOW);
      expect(r.ok, bad.slice(0, 10)).toBe(false);
    }
  });
});

describe("trust is a conclusion, not a claim", () => {
  it("starts PENDING — registration proves nothing", async () => {
    const r = await registerDevice({ userId: "u1", publicKey: key(), platform: "android" }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.device.status).toBe("pending");
      expect(r.device.attestationStatus).toBe("attestation_missing");
    }
  });

  it("REFUSES to sign from a pending device", async () => {
    const r = await registerDevice({ userId: "u1", publicKey: key(), platform: "android" }, NOW);
    if (!r.ok) throw new Error("setup");
    const check = await checkDevice({
      deviceId: r.device.deviceId,
      userId: "u1",
      appInstanceId: r.device.appInstanceId,
    });
    expect(check.ok).toBe(false);
    expect(check.refusals).toContain("device_not_trusted");
  });

  it("promotes to TRUSTED only on a verified attestation", async () => {
    const r = await registerDevice({ userId: "u1", publicKey: key(), platform: "android" }, NOW);
    if (!r.ok) throw new Error("setup");
    const attested = await recordAttestation(r.device.deviceId, "hardware_trusted", NOW);
    expect(attested!.status).toBe("trusted");
    expect(deviceTrustTier(attested!)).toBe("hardware");
  });

  it("does NOT promote on a missing attestation", async () => {
    // On a platform where we cannot verify, the correct answer is that we have
    // not verified — not that the device is fine.
    const r = await registerDevice({ userId: "u1", publicKey: key(), platform: "android" }, NOW);
    if (!r.ok) throw new Error("setup");
    const after = await recordAttestation(r.device.deviceId, "attestation_missing", NOW);
    expect(after!.status).toBe("pending");
    expect(deviceTrustTier(after!)).toBe("untrusted");
  });

  it("does NOT promote on an INVALID attestation", async () => {
    const r = await registerDevice({ userId: "u1", publicKey: key(), platform: "android" }, NOW);
    if (!r.ok) throw new Error("setup");
    const after = await recordAttestation(r.device.deviceId, "attestation_invalid", NOW);
    expect(after!.status).not.toBe("trusted");
  });

  it("distinguishes hardware from software backing", async () => {
    const r = await registerDevice({ userId: "u1", publicKey: key(), platform: "android" }, NOW);
    if (!r.ok) throw new Error("setup");
    const soft = await recordAttestation(r.device.deviceId, "software_only", NOW);
    expect(soft!.status).toBe("trusted");
    // Trusted, and weaker. The tier is what policy reads.
    expect(deviceTrustTier(soft!)).toBe("basic");
  });
});

describe("revocation and rotation", () => {
  async function trusted(userId = "u1") {
    const r = await registerDevice({ userId, publicKey: key(), platform: "android" }, NOW);
    if (!r.ok) throw new Error("setup");
    await recordAttestation(r.device.deviceId, "hardware_trusted", NOW);
    return (await getDevice(r.device.deviceId))!;
  }

  it("BLOCKS a revoked device", async () => {
    const d = await trusted();
    await revokeDevice(d.deviceId, "user_reported_lost", NOW);
    const check = await checkDevice({
      deviceId: d.deviceId,
      userId: "u1",
      appInstanceId: d.appInstanceId,
    });
    expect(check.ok).toBe(false);
    expect(check.refusals).toContain("device_revoked");
  });

  it("bumps the key version on revoke, invalidating outstanding authorizations", async () => {
    // Retroactive revocation without a scan: every authorization records the
    // key version it was minted under.
    const d = await trusted();
    const revoked = await revokeDevice(d.deviceId, "compromised", NOW);
    expect(revoked!.keyVersion).toBe(d.keyVersion + 1);

    const check = await checkDevice({
      deviceId: d.deviceId,
      userId: "u1",
      appInstanceId: d.appInstanceId,
      expectedKeyVersion: d.keyVersion,
    });
    expect(check.refusals).toContain("key_version_mismatch");
  });

  it("REFUSES to re-register a revoked device", async () => {
    // Terminal. A revoked device does not come back by re-registering.
    const k = key();
    const r = await registerDevice({ userId: "u1", publicKey: k, platform: "android" }, NOW);
    if (!r.ok) throw new Error("setup");
    await revokeDevice(r.device.deviceId, "stolen", NOW);
    const again = await registerDevice({ userId: "u1", publicKey: k, platform: "android" }, NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("device_revoked");
  });

  it("RESETS trust on key rotation", async () => {
    // Inheriting the old key's trust would make rotation a way to launder an
    // unattested key into a trusted record.
    const d = await trusted();
    const rotated = await rotateDeviceKey(d.deviceId, key(), NOW);
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      expect(rotated.device.status).toBe("pending");
      expect(rotated.device.attestationStatus).toBe("attestation_missing");
      expect(rotated.device.keyVersion).toBe(d.keyVersion + 1);
    }
  });

  it("BLOCKS a device belonging to another user", async () => {
    const d = await trusted("u1");
    const check = await checkDevice({
      deviceId: d.deviceId,
      userId: "u2",
      appInstanceId: d.appInstanceId,
    });
    expect(check.refusals).toContain("device_not_owned");
  });

  it("BLOCKS a mismatched app instance", async () => {
    const d = await trusted();
    const check = await checkDevice({
      deviceId: d.deviceId,
      userId: "u1",
      appInstanceId: "inst_" + "9".repeat(32),
    });
    expect(check.refusals).toContain("app_instance_mismatch");
  });

  it("BLOCKS an unknown device", async () => {
    const check = await checkDevice({
      deviceId: "dev_" + "0".repeat(32),
      userId: "u1",
      appInstanceId: "inst_" + "0".repeat(32),
    });
    expect(check.refusals).toEqual(["device_not_found"]);
  });
});

describe("signing challenge", () => {
  const base = {
    userId: "u1",
    deviceId: "dev_" + "a".repeat(32),
    appInstanceId: "inst_" + "b".repeat(32),
    walletId: "0x" + "9f".repeat(20),
    transactionId: "itx_1",
    transactionVersion: 1,
    canonicalDigest: "d".repeat(64),
  };

  it("issues an unpredictable, bound challenge", async () => {
    const a = await issueChallenge(base, NOW);
    const b = await issueChallenge(base, NOW);
    // From the CSPRNG. A guessable challenge lets an attacker pre-compute
    // attestation evidence for one not yet issued.
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.challengeId).not.toBe(b.challengeId);
    expect(Buffer.from(a.nonce, "base64url").length).toBe(32);
  });

  it("consumes exactly once", async () => {
    const c = await issueChallenge(base, NOW);
    const args = { ...base, challengeId: c.challengeId, nonce: c.nonce };
    expect((await consumeChallenge(args, NOW)).ok).toBe(true);
    const replay = await consumeChallenge(args, NOW);
    expect(replay.ok).toBe(false);
    expect(replay.refusals).toContain("challenge_replayed");
  });

  it("BLOCKS concurrent consumption", async () => {
    const c = await issueChallenge(base, NOW);
    const args = { ...base, challengeId: c.challengeId, nonce: c.nonce };
    const [x, y] = await Promise.all([consumeChallenge(args, NOW), consumeChallenge(args, NOW)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
  });

  it("BLOCKS a wrong nonce", async () => {
    const c = await issueChallenge(base, NOW);
    const r = await consumeChallenge(
      { ...base, challengeId: c.challengeId, nonce: "A".repeat(43) },
      NOW
    );
    expect(r.refusals).toContain("challenge_nonce_mismatch");
  });

  it("BLOCKS an expired challenge", async () => {
    const c = await issueChallenge(base, NOW);
    const r = await consumeChallenge(
      { ...base, challengeId: c.challengeId, nonce: c.nonce },
      NOW + CHALLENGE_TTL_MS + 1_000
    );
    expect(r.ok).toBe(false);
  });

  it("BLOCKS every principal substitution", async () => {
    // A challenge valid for a different device, wallet or transaction is a
    // bearer token, and a bearer token that unlocks signing is worse than the
    // problem this solves.
    const cases: [string, Record<string, unknown>][] = [
      ["challenge_user_mismatch", { userId: "u2" }],
      ["challenge_device_mismatch", { deviceId: "dev_" + "9".repeat(32) }],
      ["challenge_app_instance_mismatch", { appInstanceId: "inst_" + "9".repeat(32) }],
      ["challenge_wallet_mismatch", { walletId: "0x" + "11".repeat(20) }],
      ["challenge_transaction_mismatch", { transactionId: "itx_other" }],
      ["challenge_version_mismatch", { transactionVersion: 2 }],
      ["challenge_digest_mismatch", { canonicalDigest: "e".repeat(64) }],
    ];
    for (const [expected, override] of cases) {
      const c = await issueChallenge(base, NOW);
      const r = await consumeChallenge(
        { ...base, ...override, challengeId: c.challengeId, nonce: c.nonce },
        NOW
      );
      expect(r.ok, expected).toBe(false);
      expect(r.refusals, expected).toContain(expected);
    }
  });

  it("BLOCKS an unknown challenge id", async () => {
    const r = await consumeChallenge(
      { ...base, challengeId: "chal_" + "0".repeat(32), nonce: "x".repeat(43) },
      NOW
    );
    expect(r.refusals).toContain("challenge_not_found");
  });
});
