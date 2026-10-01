import { describe, expect, it } from "vitest";
import {
  attestationMode,
  checkPlayVerdict,
  issueChallenge,
  requireMobileAttestation,
  type PlayIntegrityVerdict,
  type Verifier,
} from "../index";

// T-M5 (audit P1-9): a mobile money action with a missing, forged, replayed or
// foreign attestation is 403 in enforce mode; web traffic is untouched.

const CFG = { androidPackage: "com.furlpay.app", androidCertDigests: ["PLAY_SIGNING_DIGEST"] };
const ENV = {
  FURLPAY_ATTESTATION_MODE: "enforce",
  ANDROID_PACKAGE_NAME: "com.furlpay.app",
  FURLPAY_PLAY_CERT_DIGESTS: "PLAY_SIGNING_DIGEST",
};

function genuine(nonce: string, now = Date.now()): PlayIntegrityVerdict {
  return {
    requestDetails: { requestPackageName: "com.furlpay.app", requestHash: nonce, timestampMillis: String(now) },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "com.furlpay.app", certificateSha256Digest: ["PLAY_SIGNING_DIGEST"] },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
  };
}

const headers = (h: Record<string, string>) => ({ headers: { get: (n: string) => h[n.toLowerCase()] ?? null } });
const mobile = (nonce: string, token = "tok", platform = "android") =>
  headers({
    "x-furlpay-client": "mobile-android/2.2.0",
    "x-furlpay-attestation-platform": platform,
    "x-furlpay-attestation-nonce": nonce,
    "x-furlpay-attestation-token": token,
  });
const verifier = (v: (nonce: string) => PlayIntegrityVerdict, captured: { nonce: string }): Verifier => ({
  decodePlay: async () => v(captured.nonce),
  verifyAppAttest: async () => ({ ok: false, reason: "app_attest_not_implemented" }),
});

describe("checkPlayVerdict", () => {
  it("accepts a genuine verdict over our nonce", () => {
    expect(checkPlayVerdict(genuine("n1"), "n1", CFG)).toEqual({ ok: true });
  });
  it.each([
    ["another app", (v: PlayIntegrityVerdict) => ((v.requestDetails!.requestPackageName = "com.evil"), v), "package_mismatch"],
    ["a different nonce", (v: PlayIntegrityVerdict) => ((v.requestDetails!.requestHash = "other"), v), "nonce_mismatch"],
    ["a stale verdict", (v: PlayIntegrityVerdict) => ((v.requestDetails!.timestampMillis = String(Date.now() - 3_600_000)), v), "verdict_stale"],
    ["a sideloaded build", (v: PlayIntegrityVerdict) => ((v.appIntegrity!.appRecognitionVerdict = "UNRECOGNIZED_VERSION"), v), "app_not_play_recognized"],
    ["a re-signed build", (v: PlayIntegrityVerdict) => ((v.appIntegrity!.certificateSha256Digest = ["ATTACKER"]), v), "certificate_mismatch"],
    ["an emulator / rooted device", (v: PlayIntegrityVerdict) => ((v.deviceIntegrity!.deviceRecognitionVerdict = []), v), "device_not_genuine"],
  ])("refuses %s", (_l, mutate, reason) => {
    expect(checkPlayVerdict(mutate(genuine("n1")), "n1", CFG)).toEqual({ ok: false, reason });
  });
  it("refuses everything when no signing certificate is configured (never a silent pass)", () => {
    expect(checkPlayVerdict(genuine("n1"), "n1", { ...CFG, androidCertDigests: [] })).toEqual({ ok: false, reason: "no_expected_certificate_configured" });
  });
});

describe("requireMobileAttestation (enforce)", () => {
  it("allows a genuine attestation over a fresh nonce", async () => {
    const { nonce } = await issueChallenge("u1", "transfer.gasless");
    const cap = { nonce };
    expect(await requireMobileAttestation(mobile(nonce), "u1", "transfer.gasless", verifier(genuine, cap), ENV)).toBeNull();
  });

  it("a replayed nonce is refused (single use)", async () => {
    const { nonce } = await issueChallenge("u1", "transfer.gasless");
    const cap = { nonce };
    await requireMobileAttestation(mobile(nonce), "u1", "transfer.gasless", verifier(genuine, cap), ENV);
    const again = await requireMobileAttestation(mobile(nonce), "u1", "transfer.gasless", verifier(genuine, cap), ENV);
    expect(again?.status).toBe(403);
    expect(await again!.json()).toMatchObject({ reason: "nonce_replayed" });
  });

  it("a forged token (Google rejects it) is 403", async () => {
    const { nonce } = await issueChallenge("u1", "transfer.gasless");
    const forged: Verifier = { decodePlay: async () => { throw new Error("decodeIntegrityToken 400"); }, verifyAppAttest: async () => ({ ok: false }) };
    const res = await requireMobileAttestation(mobile(nonce, "forged"), "u1", "transfer.gasless", forged, ENV);
    expect(res?.status).toBe(403);
  });

  it("a nonce issued to another user or purpose is refused", async () => {
    const { nonce } = await issueChallenge("u2", "transfer.gasless");
    expect((await requireMobileAttestation(mobile(nonce), "u1", "transfer.gasless", verifier(genuine, { nonce }), ENV))?.status).toBe(403);
    const { nonce: n2 } = await issueChallenge("u1", "wallet.link");
    expect((await requireMobileAttestation(mobile(n2), "u1", "transfer.gasless", verifier(genuine, { nonce: n2 }), ENV))?.status).toBe(403);
  });

  it("missing headers on a mobile request are 403", async () => {
    const res = await requireMobileAttestation(headers({ "x-furlpay-client": "mobile-ios/1" }), "u1", "transfer.gasless", verifier(genuine, { nonce: "" }), ENV);
    expect(res?.status).toBe(403);
  });

  it("iOS is refused until App Attest verification exists (fail closed)", async () => {
    const { nonce } = await issueChallenge("u1", "transfer.gasless");
    const res = await requireMobileAttestation(mobile(nonce, "tok", "ios"), "u1", "transfer.gasless", verifier(genuine, { nonce }), ENV);
    expect(await res!.json()).toMatchObject({ reason: "app_attest_not_implemented" });
  });

  it("web traffic is never subject to it", async () => {
    expect(await requireMobileAttestation(headers({}), "u1", "transfer.gasless", verifier(genuine, { nonce: "" }), ENV)).toBeNull();
  });
});

describe("rollout modes", () => {
  it("defaults to off; report never blocks", async () => {
    expect(attestationMode({})).toBe("off");
    expect(attestationMode({ FURLPAY_ATTESTATION_MODE: "bogus" })).toBe("off");
    const res = await requireMobileAttestation(mobile("x".repeat(43)), "u1", "transfer.gasless", verifier(genuine, { nonce: "" }), { ...ENV, FURLPAY_ATTESTATION_MODE: "report" });
    expect(res).toBeNull();
  });
});
