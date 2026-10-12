import { ApiError, NetworkError, TimeoutError } from "../api";
import {
  amountLabel,
  classifyDecideError,
  parseQueue,
  payeeLabel,
  queueUnavailable,
  secondsLeft,
  type HeldPayment,
} from "../heldPayments";

// The shape GET /api/control-plane/approvals returns (apps/web
// lib/controlPlane/approvals.ts pendingApprovalQueue).
const entry = (payment: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id: "cpap_1",
  authorizationId: "cpa_1",
  approverRole: "finance_admin",
  requestedAt: "2026-10-12T10:00:00.000Z",
  deadline: "2026-10-12T10:15:00.000Z",
  onTimeout: "DENY",
  payment: {
    phase: "PENDING_APPROVAL",
    amount: "1250500000",
    amountMajor: "1250.500000",
    asset: "USDC",
    currency: "USD",
    network: "base",
    rail: "onchain",
    recipientId: "rcp_1",
    recipientDestination: "0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc",
    merchantDomain: null,
    agentId: "agt_1",
    mandateId: "mdt_1",
    reason: "amount above approval threshold",
    decidedAt: null,
    ...payment,
  },
  ...extra,
});

const pay = (overrides: Partial<HeldPayment["payment"]>) => ({ ...parseQueue({ approvals: [entry()] })[0].payment, ...overrides });

describe("parseQueue", () => {
  it("reads the server's queue", () => {
    const [p] = parseQueue({ approvals: [entry()] });
    expect(p).toMatchObject({ id: "cpap_1", authorizationId: "cpa_1", onTimeout: "DENY" });
    expect(p.payment).toMatchObject({ amount: "1250500000", amountMajor: "1250.500000", asset: "USDC" });
  });

  it("drops entries a person could not judge", () => {
    const list = parseQueue({
      approvals: [
        entry({ amount: undefined }),
        entry({ amount: "12.5" }), // atomic is an integer string; anything else is not the contract
        entry({ asset: "" }),
        entry({}, { id: undefined }),
        entry(),
      ],
    });
    expect(list).toHaveLength(1);
  });

  it("treats anything but HOLD as fail-closed DENY", () => {
    expect(parseQueue({ approvals: [entry({}, { onTimeout: "HOLD" })] })[0].onTimeout).toBe("HOLD");
    expect(parseQueue({ approvals: [entry({}, { onTimeout: "???" })] })[0].onTimeout).toBe("DENY");
  });

  it("is empty, not a throw, for a malformed body", () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue({ approvals: "nope" })).toEqual([]);
  });
});

describe("amountLabel", () => {
  it("groups and trims the server's major amount without rounding", () => {
    expect(amountLabel(pay({ amountMajor: "1250.500000" }))).toBe("1,250.50 USDC");
    expect(amountLabel(pay({ amountMajor: "1.000000" }))).toBe("1.00 USDC");
    expect(amountLabel(pay({ amountMajor: "0.123456" }))).toBe("0.123456 USDC");
    expect(amountLabel(pay({ amountMajor: "1000000.010000" }))).toBe("1,000,000.01 USDC");
  });

  it("keeps zero-decimal assets whole", () => {
    expect(amountLabel(pay({ amountMajor: "500", asset: "JPY" }))).toBe("500 JPY");
  });

  it("never re-scales an amount the server could not", () => {
    expect(amountLabel(pay({ amountMajor: null, amount: "42", asset: "FOO" }))).toBe("42 atomic units (FOO)");
  });
});

describe("payeeLabel", () => {
  it("prefers the destination, then the merchant, then the recipient id", () => {
    expect(payeeLabel(pay({}))).toBe("0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc");
    expect(payeeLabel(pay({ recipientDestination: null, merchantDomain: "acme.example" }))).toBe("acme.example");
    expect(payeeLabel(pay({ recipientDestination: null }))).toBe("rcp_1");
  });
});

describe("secondsLeft", () => {
  const now = Date.parse("2026-10-12T10:14:00.000Z");
  it("counts down to the deadline and stops at zero", () => {
    expect(secondsLeft("2026-10-12T10:15:00.000Z", now)).toBe(60);
    expect(secondsLeft("2026-10-12T10:00:00.000Z", now)).toBe(0);
  });
  it("is null with no usable deadline", () => {
    expect(secondsLeft(null, now)).toBeNull();
    expect(secondsLeft("not a date", now)).toBeNull();
  });
});

describe("classifyDecideError", () => {
  const api = (status: number, data: unknown) => new ApiError(status, "x", data);

  it("routes a step-up challenge to verification", () => {
    expect(classifyDecideError(api(401, { error: "step_up_required" }))).toEqual({ kind: "step_up" });
  });

  it("never treats a lost answer as a failure", () => {
    expect(classifyDecideError(new TimeoutError(15000)).kind).toBe("uncertain");
    expect(classifyDecideError(new NetworkError("offline")).kind).toBe("uncertain");
  });

  it("explains each conflict the server can return", () => {
    for (const code of ["already_decided", "not_awaiting_approval", "approval_timed_out", "phase_changed"]) {
      const out = classifyDecideError(api(409, { error: code }));
      expect(out.kind).toBe("conflict");
      expect((out as { message: string }).message).not.toMatch(/can no longer be decided/);
    }
    expect(classifyDecideError(api(404, { error: "not_found" })).kind).toBe("conflict");
  });

  it("shows the server's own message for anything else", () => {
    expect(classifyDecideError(api(503, { error: "approval_store_unavailable", message: "Store down." }))).toEqual({
      kind: "failed",
      message: "Store down.",
    });
  });
});

describe("queueUnavailable", () => {
  it("names the reason the server gave", () => {
    expect(queueUnavailable(new ApiError(403, "no_organization", { error: "no_organization" })).title).toBe("No organization");
    expect(
      queueUnavailable(new ApiError(403, "organization_inactive", { error: "organization_inactive", message: "This organization is suspended." }))
        .subtitle
    ).toBe("This organization is suspended.");
    expect(queueUnavailable(new ApiError(503, "control_plane_unavailable", { error: "control_plane_unavailable" })).title).toBe(
      "Approvals unavailable"
    );
  });
});
