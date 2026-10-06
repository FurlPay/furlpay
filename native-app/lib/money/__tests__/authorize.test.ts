import { authorizeMoneyMove, riskWarningsFor } from "../authorize";
import { requireAuthFor, clearStepUp } from "@/lib/security/riskPolicy";

jest.mock("@/lib/security/riskPolicy", () => {
  const actual = jest.requireActual("@/lib/security/riskPolicy");
  return { ...actual, requireAuthFor: jest.fn() };
});

// Tamper detection is a native SDK; these tests drive its two outputs directly.
// Default: detection running, nothing found — the healthy-device baseline the
// rest of this file assumes.
jest.mock("@/lib/security/tamperDetection", () => ({
  isDeviceCompromised: jest.fn(() => false),
  isIntegrityUnknown: jest.fn(() => false),
}));
import { isDeviceCompromised, isIntegrityUnknown } from "@/lib/security/tamperDetection";
const mockCompromised = isDeviceCompromised as jest.Mock;
const mockUnknown = isIntegrityUnknown as jest.Mock;

const mockAuth = requireAuthFor as jest.MockedFunction<typeof requireAuthFor>;

beforeEach(() => {
  mockAuth.mockReset();
  mockAuth.mockResolvedValue({ ok: true });
  mockCompromised.mockReturnValue(false);
  mockUnknown.mockReturnValue(false);
  clearStepUp();
});

// P0-3 (audit 2026-10-05): tamper detection that is not running must neither
// silently allow nor block — it must demand proof of presence.
describe("tamper detection feeds the decision", () => {
  it("detection not running (config missing / start failed) → STEP_UP with a forced prompt, not ALLOW", async () => {
    mockUnknown.mockReturnValue(true);
    const res = await authorizeMoneyMove(send({ signals: { knownBeneficiary: true } }));
    expect(res.assessment.decision).toBe("STEP_UP");
    expect(res.assessment.rules.map((r) => r.id)).toContain("integrity_unknown");
    expect(mockAuth).toHaveBeenCalledWith("send_funds", expect.objectContaining({ force: true }));
    expect(res.ok).toBe(true); // proven presence → proceeds
  });

  it("detection not running and the user fails the prompt → nothing is sent", async () => {
    mockUnknown.mockReturnValue(true);
    mockAuth.mockResolvedValue({ ok: false, reason: "rejected" });
    const res = await authorizeMoneyMove(send({ signals: { knownBeneficiary: true } }));
    expect(res.ok).toBe(false);
  });

  it("a detected threat BLOCKS before any prompt", async () => {
    mockCompromised.mockReturnValue(true);
    const res = await authorizeMoneyMove(send());
    expect(res.ok === false && res.kind).toBe("blocked");
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("a caller cannot clear the detector's verdict by passing deviceCompromised: false", async () => {
    mockCompromised.mockReturnValue(true);
    const res = await authorizeMoneyMove(send({ signals: { deviceCompromised: false } }));
    expect(res.ok === false && res.kind).toBe("blocked");
  });

  it("a caller cannot clear unknown integrity by passing integrityUnknown: false", async () => {
    mockUnknown.mockReturnValue(true);
    const res = await authorizeMoneyMove(send({ signals: { integrityUnknown: false, knownBeneficiary: true } }));
    expect(res.assessment.decision).toBe("STEP_UP");
  });
});

const send = (over = {}) => ({
  action: "send_funds" as const,
  amountUsd: 50,
  reason: "Send $50 to 0xabc",
  ...over,
});

describe("BLOCK never reaches the network", () => {
  it("refuses before authentication is even attempted", async () => {
    const res = await authorizeMoneyMove(
      send({ signals: { deviceCompromised: true } })
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.kind).toBe("blocked");
    // Not merely "did not submit" — the user was never even prompted. Showing
    // a fingerprint sheet for something that was never going to be sent trains
    // people to authorize things that then fail.
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("explains which rule fired", async () => {
    const res = await authorizeMoneyMove(send({ signals: { deviceCompromised: true } }));
    expect(res.ok === false && res.message).toMatch(/rooted or modified/i);
  });
});

describe("REVIEW is not a submission and not a success", () => {
  it("does not authenticate and does not proceed", async () => {
    const res = await authorizeMoneyMove(
      send({ amountUsd: 500, signals: { accountAgeDays: 2 } })
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.kind).toBe("review");
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("never reports itself as ok", async () => {
    // Submitting-then-flagging would mean the money is committed while the UI
    // implies it is being considered.
    const res = await authorizeMoneyMove(
      send({ signals: { transactionsLast24h: 25 } })
    );
    expect(res.ok).toBe(false);
  });
});

describe("STEP_UP forces a fresh prompt", () => {
  it("authenticates with force, ignoring the grace window", async () => {
    await authorizeMoneyMove(send({ signals: { newDevice: true } }));
    expect(mockAuth).toHaveBeenCalledWith(
      "send_funds",
      expect.objectContaining({ force: true })
    );
  });

  it("proceeds when the user authenticates", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    const res = await authorizeMoneyMove(send({ signals: { newDevice: true } }));
    expect(res.ok).toBe(true);
  });

  it("refuses when the user fails the prompt", async () => {
    mockAuth.mockResolvedValue({ ok: false, reason: "rejected" });
    const res = await authorizeMoneyMove(send({ signals: { newDevice: true } }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.kind).toBe("auth_failed");
  });
});

describe("a device with no screen lock", () => {
  it("is refused, not waved through", async () => {
    // This is the case confirmWithBiometrics got wrong: it returned TRUE.
    mockAuth.mockResolvedValue({ ok: false, reason: "no_device_lock" });
    const res = await authorizeMoneyMove(send());
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.kind).toBe("no_device_lock");
    expect(res.ok === false && res.message).toMatch(/screen lock/i);
  });
});

describe("ALLOW", () => {
  it("proceeds after ordinary authentication", async () => {
    const res = await authorizeMoneyMove(send({ signals: { knownBeneficiary: true } }));
    expect(res.ok).toBe(true);
    expect(mockAuth).toHaveBeenCalledTimes(1);
  });

  it("still authenticates — ALLOW is a risk verdict, not an auth waiver", async () => {
    mockAuth.mockResolvedValue({ ok: false, reason: "rejected" });
    const res = await authorizeMoneyMove(send({ signals: { knownBeneficiary: true } }));
    expect(res.ok).toBe(false);
  });
});

describe("the client cannot override a decision", () => {
  it("has no parameter that asserts a verdict", () => {
    // The signal surface is inputs to the engine, never the answer. If a
    // `decision`/`allow`/`risk` input ever appears here, an LLM-authored or
    // user-editable payload could self-authorize.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "authorize.ts"),
      "utf8"
    );
    const iface = src.slice(
      src.indexOf("export interface AuthorizeInput"),
      src.indexOf("export async function authorizeMoneyMove")
    );
    for (const forbidden of ["decision:", "allow:", "risk:", "override", "skipAuth", "trusted:"]) {
      expect(iface).not.toContain(forbidden);
    }
  });

  it("ignores extra properties smuggled into signals", async () => {
    const res = await authorizeMoneyMove(
      send({
        signals: {
          deviceCompromised: true,
          // Not part of RiskSignals; must not change the outcome.
          decision: "ALLOW",
          allow: true,
        } as never,
      })
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.kind).toBe("blocked");
  });
});

describe("ordering is part of the contract", () => {
  it("evaluates risk BEFORE authentication in every branch", async () => {
    // BLOCK and REVIEW both return without prompting; only ALLOW/STEP_UP reach
    // the prompt. Together these pin the order.
    await authorizeMoneyMove(send({ signals: { deviceCompromised: true } }));
    expect(mockAuth).not.toHaveBeenCalled();

    await authorizeMoneyMove(send({ signals: { transactionsLast24h: 25 } }));
    expect(mockAuth).not.toHaveBeenCalled();

    await authorizeMoneyMove(send({ signals: { knownBeneficiary: true } }));
    expect(mockAuth).toHaveBeenCalledTimes(1);
  });
});

describe("the assessment travels with the outcome", () => {
  it("is present on success and on refusal, so the UI can explain either", async () => {
    const ok = await authorizeMoneyMove(send({ signals: { knownBeneficiary: true } }));
    expect(ok.assessment.decision).toBe("ALLOW");

    const no = await authorizeMoneyMove(send({ signals: { deviceCompromised: true } }));
    expect(no.assessment.decision).toBe("BLOCK");
    expect(no.assessment.rules.length).toBeGreaterThan(0);
  });
});

describe("riskWarningsFor", () => {
  it("surfaces a first-payment warning without blocking", () => {
    const w = riskWarningsFor("send_funds", 10, { knownBeneficiary: false });
    expect(w.length).toBeGreaterThan(0);
  });

  it("is quiet for a known destination", () => {
    expect(riskWarningsFor("send_funds", 10, { knownBeneficiary: true })).toEqual([]);
  });
});
