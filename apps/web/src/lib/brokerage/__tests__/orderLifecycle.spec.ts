import { describe, it, expect, beforeEach, vi } from "vitest";
import { canTransition, isTerminal, type BrokerageOrder, type OrderStatus } from "../types";
import { compareOrder, comparePositions, needsAttention } from "../reconcile";
import type { OrderRecord } from "../orderStore";

// ---------------------------------------------------------------------------
// Order lifecycle and reconciliation.
//
// These tests encode the two failure modes that turn an order bug into a money
// bug, and neither one produces an error at runtime:
//
//   1. A late event walking a terminal order backwards. Webhook delivery is
//      unordered and at-least-once, so a `fill` and an `accepted` for the same
//      order routinely arrive in the wrong order. Applying the stale one
//      re-opens a position that closed.
//
//   2. A reconciliation that could not run reporting a clean result. "Zero
//      findings" from an unreachable provider looks exactly like "everything
//      matches", and is the single most dangerous output this system can
//      produce.
// ---------------------------------------------------------------------------

describe("order state machine", () => {
  it("names exactly the states after which no fill can arrive", () => {
    expect(isTerminal("filled")).toBe(true);
    expect(isTerminal("canceled")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("expired")).toBe(true);

    // pending_cancel is NOT terminal — an order being cancelled can still fill
    // before the cancel reaches the venue. Treating it as finished would
    // abandon an order that goes on to execute.
    expect(isTerminal("pending_cancel")).toBe(false);
    expect(isTerminal("accepted")).toBe(false);
    expect(isTerminal("partially_filled")).toBe(false);
  });

  it("allows the ordinary forward path", () => {
    expect(canTransition("created", "submitted")).toBe(true);
    expect(canTransition("submitted", "accepted")).toBe(true);
    expect(canTransition("accepted", "partially_filled")).toBe(true);
    expect(canTransition("partially_filled", "filled")).toBe(true);
    expect(canTransition("accepted", "canceled")).toBe(true);
    expect(canTransition("accepted", "rejected")).toBe(true);
  });

  it("allows successive partial fills but no other self-transition", () => {
    // Several partials arrive for one order; each is a real event.
    expect(canTransition("partially_filled", "partially_filled")).toBe(true);
    // A repeated `filled` is a replayed event, not a second fill.
    expect(canTransition("filled", "filled")).toBe(false);
    expect(canTransition("accepted", "accepted")).toBe(false);
  });

  it("refuses to move an order out of a terminal state", () => {
    const terminal: OrderStatus[] = ["filled", "canceled", "rejected", "expired"];
    const anywhere: OrderStatus[] = ["accepted", "partially_filled", "submitted", "canceled", "filled"];
    for (const from of terminal) {
      for (const to of anywhere) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("refuses the specific regression: a late `accepted` after a fill", () => {
    // This is the one that re-opens a closed position.
    expect(canTransition("filled", "accepted")).toBe(false);
    expect(canTransition("canceled", "accepted")).toBe(false);
  });

  it("lets an unknown status be resolved once a real one arrives", () => {
    // `unknown` is what a provider status we do not model maps to. It must not
    // be a dead end, or an order would be stuck forever.
    expect(canTransition("unknown", "filled")).toBe(true);
    expect(canTransition("unknown", "canceled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

function record(partial: Partial<OrderRecord> = {}): OrderRecord {
  return {
    clientOrderId: "fp_test",
    userId: "user_1",
    symbol: "NVDA",
    side: "buy",
    type: "market",
    timeInForce: "day",
    qty: 10,
    notional: null,
    limitPrice: null,
    stopPrice: null,
    status: "filled",
    providerOrderId: "prov_1",
    provider: "alpaca",
    providerIsLive: true,
    filledQty: 10,
    filledAvgPrice: 100,
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:00:01.000Z",
    submittedAt: "2026-08-22T10:00:00.500Z",
    terminalAt: "2026-08-22T10:00:01.000Z",
    rejectReason: null,
    history: [],
    ...partial,
  };
}

function remote(partial: Partial<BrokerageOrder> = {}): BrokerageOrder {
  return {
    clientOrderId: "fp_test",
    providerOrderId: "prov_1",
    symbol: "NVDA",
    side: "buy",
    type: "market",
    timeInForce: "day",
    status: "filled",
    qty: 10,
    notional: null,
    limitPrice: null,
    stopPrice: null,
    filledQty: 10,
    filledAvgPrice: 100,
    submittedAt: "2026-08-22T10:00:00.500Z",
    filledAt: "2026-08-22T10:00:01.000Z",
    canceledAt: null,
    expiredAt: null,
    rejectReason: null,
    ...partial,
  };
}

describe("compareOrder", () => {
  it("matches an order that agrees on every field", () => {
    const f = compareOrder(record(), remote());
    expect(f.status).toBe("MATCHED");
    expect(f.severity).toBe("ok");
  });

  it("treats an unsubmitted order's absence at the provider as correct", () => {
    const f = compareOrder(record({ status: "created", filledQty: null, filledAvgPrice: null }), null);
    expect(f.status).toBe("MATCHED");
  });

  it("flags an order we think exists that the provider has never seen", () => {
    const f = compareOrder(record({ status: "filled" }), null);
    expect(f.status).toBe("DATABASE_AHEAD");
    expect(f.severity).toBe("critical");
  });

  it("flags a fill the provider reports that we have not booked", () => {
    // The unbooked-position case: real shares, no local record of them.
    const f = compareOrder(
      record({ status: "filled", filledQty: null, filledAvgPrice: null }),
      remote({ status: "filled", filledQty: 10 })
    );
    expect(f.status).toBe("PROVIDER_AHEAD");
    expect(f.severity).toBe("critical");
  });

  it("escalates when WE think an order is finished and the provider does not", () => {
    // Worse than lagging behind: the order can still fill, and we have stopped
    // watching it.
    const f = compareOrder(record({ status: "filled" }), remote({ status: "accepted", filledQty: null }));
    expect(f.status).toBe("STATUS_MISMATCH");
    expect(f.severity).toBe("critical");
  });

  it("treats merely lagging behind the provider as a warning", () => {
    const f = compareOrder(
      record({ status: "accepted", filledQty: null, filledAvgPrice: null }),
      remote({ status: "filled" })
    );
    expect(f.status).toBe("STATUS_MISMATCH");
    expect(f.severity).toBe("warning");
  });

  it("flags a quantity difference as critical", () => {
    const f = compareOrder(record({ filledQty: 10 }), remote({ filledQty: 9 }));
    expect(f.status).toBe("QUANTITY_MISMATCH");
    expect(f.severity).toBe("critical");
  });

  it("does not flag float noise in a fractional quantity", () => {
    // 1/3 of a share round-trips through decimal strings and doubles; the
    // difference here is a hundred-millionth of a share, not a real one.
    const f = compareOrder(record({ filledQty: 0.3333333333 }), remote({ filledQty: 0.33333333331 }));
    expect(f.status).toBe("MATCHED");
  });

  it("flags a price difference as a warning, not a critical", () => {
    // The position size is right, so this is a cost-basis error — wrong on a
    // tax form, not wrong about what the user owns.
    const f = compareOrder(record({ filledAvgPrice: 100 }), remote({ filledAvgPrice: 101 }));
    expect(f.status).toBe("PRICE_MISMATCH");
    expect(f.severity).toBe("warning");
  });

  it("does not flag a sub-tick price difference", () => {
    const f = compareOrder(record({ filledAvgPrice: 100.0 }), remote({ filledAvgPrice: 100.004 }));
    expect(f.status).toBe("MATCHED");
  });
});

describe("comparePositions", () => {
  it("matches equal positions", () => {
    const out = comparePositions([{ symbol: "NVDA", shares: 10 }], [{ symbol: "NVDA", qty: 10 }]);
    expect(out[0].status).toBe("MATCHED");
    expect(out[0].severity).toBe("ok");
  });

  it("treats EVERY position difference as critical", () => {
    // There is no size of ownership discrepancy that is merely informational.
    const out = comparePositions([{ symbol: "NVDA", shares: 10.5 }], [{ symbol: "NVDA", qty: 10 }]);
    expect(out[0].status).toBe("QUANTITY_MISMATCH");
    expect(out[0].severity).toBe("critical");
    expect(out[0].difference).toBeCloseTo(0.5);
  });

  it("finds a position the provider has that we do not", () => {
    const out = comparePositions([], [{ symbol: "AAPL", qty: 3 }]);
    expect(out[0].status).toBe("PROVIDER_AHEAD");
    expect(out[0].severity).toBe("critical");
  });

  it("finds a position we have that the provider does not", () => {
    const out = comparePositions([{ symbol: "AAPL", shares: 3 }], []);
    expect(out[0].status).toBe("DATABASE_AHEAD");
  });

  it("is case-insensitive about symbols", () => {
    const out = comparePositions([{ symbol: "nvda", shares: 5 }], [{ symbol: "NVDA", qty: 5 }]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("MATCHED");
  });

  it("orders findings by how large the discrepancy is", () => {
    const out = comparePositions(
      [
        { symbol: "A", shares: 1 },
        { symbol: "B", shares: 100 },
      ],
      [
        { symbol: "A", qty: 0 },
        { symbol: "B", qty: 0 },
      ]
    );
    expect(out[0].symbol).toBe("B");
  });
});

describe("needsAttention", () => {
  const base = {
    userId: "u",
    provider: "alpaca",
    providerIsLive: true,
    ranAt: "2026-08-22T00:00:00.000Z",
    orders: [],
    positions: [],
    summary: { ordersChecked: 0, ordersMatched: 0, positionsChecked: 0, positionsMatched: 0, critical: 0, warnings: 0 },
    incomplete: null,
  };

  it("is quiet on a clean, complete run", () => {
    expect(needsAttention(base)).toBe(false);
  });

  it("escalates any critical finding", () => {
    expect(needsAttention({ ...base, summary: { ...base.summary, critical: 1 } })).toBe(true);
  });

  it("escalates a run that could not complete", () => {
    // The important one: an unreachable provider produces zero findings, which
    // is indistinguishable from a pass unless incompleteness is itself an
    // alarm.
    expect(needsAttention({ ...base, incomplete: "positions unreadable" })).toBe(true);
  });
});
