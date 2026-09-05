import { authenticateDeviceOwner } from "../../biometrics";
import {
  RISK,
  clearStepUp,
  needsStepUp,
  requireAuthFor,
  type RiskAction,
} from "../riskPolicy";

jest.mock("../../biometrics", () => ({
  authenticateDeviceOwner: jest.fn(),
}));

const mockAuth = authenticateDeviceOwner as jest.MockedFunction<typeof authenticateDeviceOwner>;

beforeEach(() => {
  mockAuth.mockReset();
  clearStepUp();
});

describe("the classification table", () => {
  it("classifies every money-moving action as high", () => {
    const mustBeHigh: RiskAction[] = [
      "send_funds",
      "withdraw",
      "swap",
      "bank_transfer",
      "authorize_agent_spend",
      "approve_agent_transaction",
      "change_withdrawal_destination",
    ];
    for (const a of mustBeHigh) expect(RISK[a]).toBe("high");
  });

  it("classifies every action that weakens security as high", () => {
    const mustBeHigh: RiskAction[] = [
      "change_security_settings",
      "add_passkey",
      "remove_passkey",
      "reveal_card_details",
      "change_card_limits",
      "change_agent_policy",
      "revoke_agent",
      "delete_account",
    ];
    for (const a of mustBeHigh) expect(RISK[a]).toBe("high");
  });

  it("keeps read-only actions low so the app is not a prompt machine", () => {
    expect(RISK.view_balance).toBe("low");
    expect(RISK.view_transactions).toBe("low");
  });

  it("keeps freezing a card at medium — it is the safe direction", () => {
    // Unfreezing goes through change_card_limits, which is high. Prompting to
    // freeze would slow down the one action a user takes in a panic.
    expect(RISK.freeze_card).toBe("medium");
    expect(RISK.change_card_limits).toBe("high");
  });
});

describe("requireAuthFor", () => {
  it("does not prompt for a low-risk action", async () => {
    await expect(requireAuthFor("view_balance", { reason: "x" })).resolves.toEqual({ ok: true });
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("does not prompt for a medium-risk action", async () => {
    await expect(requireAuthFor("change_profile", { reason: "x" })).resolves.toEqual({ ok: true });
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("prompts for a high-risk action", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    await expect(requireAuthFor("send_funds", { reason: "Send $10" })).resolves.toEqual({
      ok: true,
    });
    expect(mockAuth).toHaveBeenCalledWith("Send $10");
  });

  it("refuses when the user rejects the prompt", async () => {
    mockAuth.mockResolvedValue({ ok: false, reason: "rejected" });
    await expect(requireAuthFor("send_funds", { reason: "x" })).resolves.toEqual({
      ok: false,
      reason: "rejected",
    });
  });

  it("surfaces a device with no lock rather than passing it through", async () => {
    mockAuth.mockResolvedValue({ ok: false, reason: "no_device_lock" });
    await expect(requireAuthFor("send_funds", { reason: "x" })).resolves.toEqual({
      ok: false,
      reason: "no_device_lock",
    });
  });
});

describe("the step-up grace window", () => {
  it("honours a recent success so three payments in a row prompt once", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    const t0 = 1_000_000;

    await requireAuthFor("send_funds", { reason: "1" }, t0);
    await requireAuthFor("send_funds", { reason: "2" }, t0 + 10_000);
    await requireAuthFor("send_funds", { reason: "3" }, t0 + 60_000);

    expect(mockAuth).toHaveBeenCalledTimes(1);
  });

  it("prompts again once the window has passed", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    const t0 = 1_000_000;
    await requireAuthFor("send_funds", { reason: "1" }, t0);
    await requireAuthFor("send_funds", { reason: "2" }, t0 + 120_001);
    expect(mockAuth).toHaveBeenCalledTimes(2);
  });

  it("never lets a security-settings change ride an existing window", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    const t0 = 1_000_000;
    await requireAuthFor("send_funds", { reason: "send" }, t0);
    // One second later — well inside the grace window.
    await requireAuthFor("remove_passkey", { reason: "remove" }, t0 + 1_000);
    expect(mockAuth).toHaveBeenCalledTimes(2);
  });

  it.each<RiskAction>([
    "change_security_settings",
    "add_passkey",
    "remove_passkey",
    "change_withdrawal_destination",
    "reveal_card_details",
    "delete_account",
    "change_agent_policy",
    "revoke_agent",
  ])("always prompts for %s", async (action) => {
    mockAuth.mockResolvedValue({ ok: true });
    const t0 = 1_000_000;
    await requireAuthFor("send_funds", { reason: "seed the window" }, t0);
    mockAuth.mockClear();
    await requireAuthFor(action, { reason: "x" }, t0 + 1_000);
    expect(mockAuth).toHaveBeenCalledTimes(1);
  });

  it("does not open a window when authentication failed", async () => {
    const t0 = 1_000_000;
    mockAuth.mockResolvedValue({ ok: false, reason: "rejected" });
    await requireAuthFor("send_funds", { reason: "1" }, t0);

    mockAuth.mockResolvedValue({ ok: true });
    await requireAuthFor("send_funds", { reason: "2" }, t0 + 1_000);
    // A rejected attempt must not authorize the next one.
    expect(mockAuth).toHaveBeenCalledTimes(2);
  });

  it("clearStepUp closes the window immediately (app lock / sign-out)", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    const t0 = 1_000_000;
    await requireAuthFor("send_funds", { reason: "1" }, t0);

    clearStepUp();

    await requireAuthFor("send_funds", { reason: "2" }, t0 + 1_000);
    expect(mockAuth).toHaveBeenCalledTimes(2);
  });

  it("force: true bypasses the window", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    const t0 = 1_000_000;
    await requireAuthFor("send_funds", { reason: "1" }, t0);
    await requireAuthFor("send_funds", { reason: "2", force: true }, t0 + 1_000);
    expect(mockAuth).toHaveBeenCalledTimes(2);
  });
});

describe("needsStepUp", () => {
  it("is false for low and medium", () => {
    expect(needsStepUp("view_balance")).toBe(false);
    expect(needsStepUp("freeze_card")).toBe(false);
  });

  it("is true for a high action with no open window", () => {
    expect(needsStepUp("send_funds")).toBe(true);
  });

  it("is false for a high action inside an open window", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    const t0 = 1_000_000;
    await requireAuthFor("send_funds", { reason: "1" }, t0);
    expect(needsStepUp("send_funds", t0 + 1_000)).toBe(false);
  });

  it("stays true for an always-prompt action even inside a window", async () => {
    mockAuth.mockResolvedValue({ ok: true });
    const t0 = 1_000_000;
    await requireAuthFor("send_funds", { reason: "1" }, t0);
    expect(needsStepUp("remove_passkey", t0 + 1_000)).toBe(true);
  });
});
