// Fingerprint Pay — the native side of the server-verified, transaction-bound
// payment approval.
//
// WHAT IS ACTUALLY BEING PROTECTED HERE. lib/biometrics.ts already prompts for
// Face ID / fingerprint before a money action, but it returns a BOOLEAN INSIDE
// OUR OWN JAVASCRIPT — a patched build or a hooked LocalAuthentication can return
// `true` with no biometric at all, and the server never learns the difference.
// This module instead runs the WebAuthn ceremony so the assertion is signed in
// the secure element and verified server-side against a digest of the exact
// payment.
//
// The tests below are about the ORDER and the FIDELITY of that exchange:
//   * the intent reaches the server unmodified (any drift breaks the binding
//     server-side and silently downgrades to TOTP);
//   * the proof is only reported after the SERVER accepted it, never after the
//     local prompt;
//   * a user dismissing the sheet is not an error.
//
// It cannot and does not test that a finger touched a sensor. That needs a device.

jest.mock("react-native-passkey", () => ({
  Passkey: {
    isSupported: jest.fn(() => true),
    get: jest.fn(async () => ({ id: "cred_1", response: {} })),
  },
}));

jest.mock("../api", () => ({ api: jest.fn() }));

jest.mock("../haptics", () => ({
  haptic: { success: jest.fn(), error: jest.fn(), tap: jest.fn(), commit: jest.fn() },
}));

import { Passkey } from "react-native-passkey";
import { api } from "../api";
import { haptic } from "../haptics";
import {
  authorizePaymentWithFingerprint,
  fingerprintPayMessage,
  isFingerprintPaySupported,
  type FingerprintPayFailure,
} from "../biometricPay";

const mockApi = api as jest.Mock;
const mockGet = Passkey.get as jest.Mock;
const mockSupported = Passkey.isSupported as jest.Mock;

const INTENT = { amount: 25.5, asset: "USDC", recipient: "0xAAA1", chain: "base" };

/** Happy-path server: challenge, then verify. */
function serverAccepts() {
  mockApi.mockImplementation(async (path: string) => {
    if (path.endsWith("/challenge")) {
      return { challengeId: "bio_chal_1", options: { challenge: "abc", userVerification: "required" } };
    }
    return { proofId: "bio_proof_1", expiresInSeconds: 120 };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSupported.mockReturnValue(true);
  mockGet.mockResolvedValue({ id: "cred_1", response: {} });
});

describe("support detection", () => {
  it("reports supported when the platform authenticator is present", () => {
    expect(isFingerprintPaySupported()).toBe(true);
  });

  it("reports unsupported rather than throwing when the native module throws", () => {
    // Some OEM builds throw from isSupported(); a crash on the send screen would
    // be a far worse outcome than falling back to TOTP.
    mockSupported.mockImplementation(() => {
      throw new Error("no module");
    });
    expect(isFingerprintPaySupported()).toBe(false);
  });

  it("does not run the ceremony at all when unsupported", async () => {
    mockSupported.mockReturnValue(false);
    const res = await authorizePaymentWithFingerprint(INTENT);
    expect(res).toEqual({ ok: false, reason: "unsupported" });
    expect(mockApi).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("the happy path", () => {
  it("returns a server-minted proof", async () => {
    serverAccepts();
    const res = await authorizePaymentWithFingerprint(INTENT);
    expect(res).toEqual({ ok: true, proofId: "bio_proof_1", expiresInSeconds: 120 });
  });

  it("sends the intent to the server EXACTLY as given", async () => {
    // The server re-derives the payment digest from the transfer it is about to
    // execute. If this client rounded the amount or re-cased the address, the
    // binding would fail at spend time and the payment would silently fall back
    // to TOTP — a bug that only shows up on real money.
    serverAccepts();
    await authorizePaymentWithFingerprint(INTENT);

    const [path, opts] = mockApi.mock.calls[0];
    expect(path).toBe("/wallets/biometric-pay/challenge");
    expect(opts.method).toBe("POST");
    expect(opts.body).toEqual(INTENT);
  });

  it("hands the server's options to the authenticator untouched", async () => {
    // userVerification:"required" is what forces the biometric. Rewriting or
    // filtering these options client-side could downgrade the ceremony.
    serverAccepts();
    await authorizePaymentWithFingerprint(INTENT);
    expect(mockGet).toHaveBeenCalledWith({ challenge: "abc", userVerification: "required" });
  });

  it("returns the challengeId with the assertion so the server can pair them", async () => {
    serverAccepts();
    await authorizePaymentWithFingerprint(INTENT);
    const [path, opts] = mockApi.mock.calls[1];
    expect(path).toBe("/wallets/biometric-pay/verify");
    expect(opts.body).toEqual({ challengeId: "bio_chal_1", assertion: { id: "cred_1", response: {} } });
  });

  it("runs challenge -> prompt -> verify, in that order", async () => {
    const order: string[] = [];
    mockApi.mockImplementation(async (path: string) => {
      order.push(path.endsWith("/challenge") ? "challenge" : "verify");
      return path.endsWith("/challenge")
        ? { challengeId: "c", options: {} }
        : { proofId: "p", expiresInSeconds: 120 };
    });
    mockGet.mockImplementation(async () => {
      order.push("prompt");
      return { id: "cred_1" };
    });

    await authorizePaymentWithFingerprint(INTENT);
    expect(order).toEqual(["challenge", "prompt", "verify"]);
  });
});

describe("haptics confirm the SERVER, not the sensor", () => {
  it("buzzes success only after verification succeeds", async () => {
    serverAccepts();
    await authorizePaymentWithFingerprint(INTENT);
    expect(haptic.success).toHaveBeenCalledTimes(1);
  });

  it("does NOT buzz success when the server rejects the assertion", async () => {
    // Buzzing on the local biometric would tell the user they had paid before
    // anything was verified — the one place a confirmation must not be optimistic.
    mockApi.mockImplementation(async (path: string) => {
      if (path.endsWith("/challenge")) return { challengeId: "c", options: {} };
      throw new Error("Biometric verification failed.");
    });

    const res = await authorizePaymentWithFingerprint(INTENT);
    expect(res.ok).toBe(false);
    expect(haptic.success).not.toHaveBeenCalled();
    expect(haptic.error).toHaveBeenCalledTimes(1);
  });

  it("does not buzz at all when the user cancels", async () => {
    // A cancellation is a decision, not an outcome to signal.
    mockApi.mockResolvedValue({ challengeId: "c", options: {} });
    mockGet.mockRejectedValue(new Error("UserCancelled"));

    await authorizePaymentWithFingerprint(INTENT);
    expect(haptic.success).not.toHaveBeenCalled();
    expect(haptic.error).not.toHaveBeenCalled();
  });
});

describe("cancellation is not a failure", () => {
  it.each([
    ["UserCancelled", new Error("UserCancelled")],
    ["NotAllowedError", new Error("NotAllowedError: the operation was aborted")],
    ["an aborted sheet", new Error("The operation was aborted.")],
    ["a dismissed sheet", { error: "UserCancelled" }],
    ["a cancel string", new Error("User canceled the request")],
  ])("maps %s to cancelled", async (_label, thrown) => {
    mockApi.mockResolvedValue({ challengeId: "c", options: {} });
    mockGet.mockRejectedValue(thrown);

    const res = await authorizePaymentWithFingerprint(INTENT);
    expect(res).toEqual({ ok: false, reason: "cancelled" });
  });

  it("says nothing was sent", () => {
    expect(fingerprintPayMessage({ ok: false, reason: "cancelled" })).toMatch(/nothing was sent/i);
  });

  it("does not attempt verification after a cancellation", async () => {
    mockApi.mockResolvedValue({ challengeId: "c", options: {} });
    mockGet.mockRejectedValue(new Error("UserCancelled"));

    await authorizePaymentWithFingerprint(INTENT);
    expect(mockApi).toHaveBeenCalledTimes(1); // challenge only
  });
});

describe("failures a real user hits", () => {
  it("treats 'no passkey registered' as a setup state, not an error", async () => {
    // The caller offers enrolment for this, rather than showing a red error for
    // something the user has simply not done yet.
    mockApi.mockRejectedValue(new Error("No passkeys registered for biometric payment."));
    const res = await authorizePaymentWithFingerprint(INTENT);
    expect(res).toEqual({ ok: false, reason: "unsupported" });
  });

  it("surfaces an expired challenge as a retryable rejection", async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.endsWith("/challenge")) return { challengeId: "c", options: {} };
      throw new Error("Biometric payment challenge not found or expired. Please re-scan.");
    });

    const res = await authorizePaymentWithFingerprint(INTENT);
    expect(res.ok).toBe(false);
    expect((res as FingerprintPayFailure & { message: string }).message).toMatch(/expired/i);
  });

  it("never resolves ok when the network fails", async () => {
    mockApi.mockRejectedValue(new Error("Network request failed"));
    const res = await authorizePaymentWithFingerprint(INTENT);
    expect(res.ok).toBe(false);
  });

  it("has copy for every failure reason", () => {
    const reasons: FingerprintPayFailure[] = [
      { ok: false, reason: "unsupported" },
      { ok: false, reason: "cancelled" },
      { ok: false, reason: "rejected", message: "Server said no." },
    ];
    for (const r of reasons) {
      const msg = fingerprintPayMessage(r);
      expect(msg.length).toBeGreaterThan(0);
      // No blame, no false certainty about where the fault lies.
      expect(msg).not.toMatch(/you (did|failed)/i);
    }
  });
});

describe("no local-only shortcut", () => {
  it("never returns a proof without a server round trip", async () => {
    // The whole point: a local biometric alone must not yield an authorization.
    // If the verify call never happens, there is no proof.
    mockApi.mockImplementation(async (path: string) => {
      if (path.endsWith("/challenge")) return { challengeId: "c", options: {} };
      throw new Error("server unreachable");
    });

    const res = await authorizePaymentWithFingerprint(INTENT);
    expect(res.ok).toBe(false);
    expect(res).not.toHaveProperty("proofId");
  });

  it("does not import expo-local-authentication", () => {
    // Reaching for the local prompt here would reintroduce exactly the
    // client-trusted boolean this module exists to replace.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require("fs").readFileSync(require.resolve("../biometricPay.ts"), "utf8");
    expect(src).not.toContain("expo-local-authentication");
  });
});
