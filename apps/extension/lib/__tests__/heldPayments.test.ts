import { describe, expect, it } from "vitest";
import { hasNoQueue, heldAmountLabel, parseHeldPayments } from "../heldPayments";

const entry = (payment: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id: "cpap_1",
  authorizationId: "cpa_1",
  deadline: "2026-10-12T10:15:00.000Z",
  onTimeout: "DENY",
  payment: {
    amount: "1250500000",
    amountMajor: "1250.500000",
    asset: "USDC",
    recipientDestination: "0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc",
    reason: "amount above approval threshold",
    ...payment,
  },
  ...extra,
});

describe("parseHeldPayments", () => {
  it("reads the server's queue", () => {
    expect(parseHeldPayments({ approvals: [entry()] })).toEqual([
      {
        id: "cpap_1",
        deadline: "2026-10-12T10:15:00.000Z",
        onTimeout: "DENY",
        amount: "1250500000",
        amountMajor: "1250.500000",
        asset: "USDC",
        payee: "0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc",
        reason: "amount above approval threshold",
      },
    ]);
  });

  it("drops entries without an id, integer amount or asset", () => {
    const list = parseHeldPayments({
      approvals: [entry({ amount: "1.5" }), entry({ asset: null }), entry({}, { id: "" }), null, entry()],
    });
    expect(list).toHaveLength(1);
  });

  it("falls back from destination to merchant to recipient id", () => {
    expect(parseHeldPayments({ approvals: [entry({ recipientDestination: null, merchantDomain: "acme.example" })] })[0]?.payee).toBe(
      "acme.example"
    );
  });

  it("is empty for a malformed body", () => {
    expect(parseHeldPayments(undefined)).toEqual([]);
  });
});

describe("heldAmountLabel", () => {
  it("formats the server's major amount without rounding", () => {
    expect(heldAmountLabel({ amount: "1", amountMajor: "1250.500000", asset: "USDC" })).toBe("1,250.50 USDC");
    expect(heldAmountLabel({ amount: "1", amountMajor: "0.123456", asset: "USDC" })).toBe("0.123456 USDC");
  });
  it("never re-scales an amount the server could not", () => {
    expect(heldAmountLabel({ amount: "42", amountMajor: null, asset: "FOO" })).toBe("42 atomic units (FOO)");
  });
});

describe("hasNoQueue", () => {
  it("treats a missing organization as no queue, not an error", () => {
    expect(hasNoQueue("no_organization")).toBe(true);
    expect(hasNoQueue("control_plane_unavailable")).toBe(false);
  });
});
