// Server-verified Fingerprint Pay inside the single authorization boundary.
//
// WHY IT LIVES HERE AND NOT IN useSend. authorizeMoneyMove is the one function
// every money path goes through — manual Send, Swap, a co-pilot action, an agent
// spend. Putting the biometric upgrade in the send screen would have given Send
// a server-verified proof and left every other money path on the local boolean,
// which is how the pre-existing confirmWithBiometrics divergence happened in the
// first place. One boundary, one upgrade.
//
// The behaviour under test is the BRANCHING, because collapsing these four
// outcomes is what makes a payment flow either unsafe or infuriating:
//
//   ok          -> return the proof so the caller can bind it to the transfer
//   unsupported -> fall through to the local gate (no passkey is not a failure)
//   cancelled   -> stop, and do NOT re-prompt locally for something just refused
//   rejected    -> stop; a local boolean must not rescue a server refusal

jest.mock("@/lib/biometricPay", () => ({
  isFingerprintPaySupported: jest.fn(() => true),
  authorizePaymentWithFingerprint: jest.fn(),
}));

jest.mock("@/lib/security/tamperDetection", () => ({
  isDeviceCompromised: jest.fn(() => false),
}));

jest.mock("@/lib/security/riskPolicy", () => ({
  requireAuthFor: jest.fn(async () => ({ ok: true })),
}));

import { authorizeMoneyMove } from "../authorize";
import {
  authorizePaymentWithFingerprint,
  isFingerprintPaySupported,
} from "@/lib/biometricPay";
import { requireAuthFor } from "@/lib/security/riskPolicy";

const mockBio = authorizePaymentWithFingerprint as jest.Mock;
const mockSupported = isFingerprintPaySupported as jest.Mock;
const mockLocalAuth = requireAuthFor as jest.Mock;

const PAYMENT = { amount: 25.5, asset: "USDC", recipient: "0xAAA1", chain: "base" };

/** A low-value send, so the risk engine allows rather than blocks or reviews. */
const input = (extra: Record<string, unknown> = {}) => ({
  action: "send_funds" as const,
  amountUsd: 25,
  reason: "Send $25 to 0xAAA1",
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSupported.mockReturnValue(true);
  mockLocalAuth.mockResolvedValue({ ok: true });
});

describe("when the payment is authorised by hardware", () => {
  it("returns the proof for the caller to bind to the transfer", async () => {
    mockBio.mockResolvedValue({ ok: true, proofId: "bio_proof_1", expiresInSeconds: 120 });

    const res = await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect(res.ok).toBe(true);
    expect((res as { biometricProof?: string }).biometricProof).toBe("bio_proof_1");
  });

  it("forwards the payment intent unchanged", async () => {
    // Any mutation here would change the digest the server re-derives, break the
    // binding, and silently drop the payment back to TOTP.
    mockBio.mockResolvedValue({ ok: true, proofId: "p", expiresInSeconds: 120 });
    await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect(mockBio).toHaveBeenCalledWith(PAYMENT);
  });

  it("does NOT also run the local prompt", async () => {
    // Two prompts for one approval teaches people to tap through them.
    mockBio.mockResolvedValue({ ok: true, proofId: "p", expiresInSeconds: 120 });
    await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect(mockLocalAuth).not.toHaveBeenCalled();
  });
});

describe("a device with no passkey falls back, it does not fail", () => {
  it("uses the local gate and still allows the send", async () => {
    mockBio.mockResolvedValue({ ok: false, reason: "unsupported" });

    const res = await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect(res.ok).toBe(true);
    expect(mockLocalAuth).toHaveBeenCalledTimes(1);
  });

  it("carries no proof, so the server applies its own step-up", async () => {
    mockBio.mockResolvedValue({ ok: false, reason: "unsupported" });
    const res = await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect((res as { biometricProof?: string }).biometricProof).toBeUndefined();
  });

  it("skips the ceremony entirely when the platform reports no support", async () => {
    mockSupported.mockReturnValue(false);
    const res = await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect(mockBio).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });
});

describe("cancelling is a decision, not an error", () => {
  it("declines without re-prompting locally", async () => {
    // Falling through to the local prompt here would re-ask for an approval the
    // user has just actively refused.
    mockBio.mockResolvedValue({ ok: false, reason: "cancelled" });

    const res = await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect(res.ok).toBe(false);
    expect((res as { kind: string }).kind).toBe("declined");
    expect(mockLocalAuth).not.toHaveBeenCalled();
  });

  it("says nothing was sent, without blaming the user", async () => {
    mockBio.mockResolvedValue({ ok: false, reason: "cancelled" });
    const res = await authorizeMoneyMove(input({ payment: PAYMENT }));
    const message = (res as { message: string }).message;
    expect(message).toMatch(/nothing was sent/i);
    expect(message).not.toMatch(/fail|error/i);
  });

  it("resolves rather than throwing, so the UI can render the state", async () => {
    mockBio.mockResolvedValue({ ok: false, reason: "cancelled" });
    await expect(authorizeMoneyMove(input({ payment: PAYMENT }))).resolves.toBeDefined();
  });
});

describe("a server refusal is final", () => {
  it("does not let the local gate rescue it", async () => {
    // The critical branch. If "rejected" fell through, a device that can always
    // pass a local fingerprint would convert a server refusal into a send.
    mockBio.mockResolvedValue({ ok: false, reason: "rejected", message: "Approval expired." });

    const res = await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect(res.ok).toBe(false);
    expect((res as { kind: string }).kind).toBe("auth_failed");
    expect(mockLocalAuth).not.toHaveBeenCalled();
  });

  it("surfaces the server's own wording", async () => {
    mockBio.mockResolvedValue({ ok: false, reason: "rejected", message: "Approval expired." });
    const res = await authorizeMoneyMove(input({ payment: PAYMENT }));
    expect((res as { message: string }).message).toBe("Approval expired.");
  });
});

describe("callers that do not name a payment", () => {
  it("keep the old local-gate behaviour exactly", async () => {
    // Swap, card actions and co-pilot confirmations pass no `payment` yet. They
    // must be unchanged by this, not quietly downgraded or upgraded.
    const res = await authorizeMoneyMove(input());
    expect(res.ok).toBe(true);
    expect(mockBio).not.toHaveBeenCalled();
    expect(mockLocalAuth).toHaveBeenCalledTimes(1);
  });
});

describe("risk is still evaluated first", () => {
  it("never shows a biometric prompt for a payment that would be blocked", async () => {
    // Prompting for something that was never going to be submitted trains people
    // to authorize things that then fail — the habit an attacker wants.
    const res = await authorizeMoneyMove(
      input({ amountUsd: 10_000_000, payment: { ...PAYMENT, amount: 10_000_000 } })
    );
    if (!res.ok && (res.kind === "blocked" || res.kind === "review")) {
      expect(mockBio).not.toHaveBeenCalled();
    } else {
      // The engine allowed it; then the ceremony is expected to have run.
      expect(mockBio).toHaveBeenCalled();
    }
  });
});
