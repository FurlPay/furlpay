import { describe, it, expect } from "vitest";
import { describeOrderOutcome, ORDER_TICKET_TYPES } from "@/lib/markets/orderTicket";
import { OrderSchema } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// The order ticket must not tell a user their money moved when it has not.
//
// THE BUG. The trade sheet set a boolean from a 200 and rendered "Order filled".
// A 200 from /api/investing/order does not mean filled — a limit order rests at
// the venue as `accepted`, a market order can be `partially_filled`, and an
// indeterminate submission returns 202 with `status: "unknown"`. Every one of
// those said "Order filled".
//
// The claim under test: only an actual fill is described as a fill, and anything
// unrecognised is described as unconfirmed rather than rounded up to success.
// ---------------------------------------------------------------------------

describe("only a real fill is reported as filled", () => {
  it("reports `filled` as filled", () => {
    const o = describeOrderOutcome("filled");
    expect(o.tone).toBe("filled");
    expect(o.title).toBe("Order filled");
    expect(o.detail("buy", "$100.00", "AAPL")).toMatch(/Bought \$100\.00 of AAPL/);
  });

  it("does NOT report a resting order as filled", () => {
    // The common case that was wrong: a limit order the user placed above the
    // market. Nothing has been bought, and saying so invites them to spend money
    // they still have.
    for (const status of ["accepted", "new", "pending_new", "submitted"]) {
      const o = describeOrderOutcome(status);
      expect(o.tone, status).toBe("resting");
      expect(o.title, status).not.toMatch(/filled/i);
      expect(o.detail("buy", "$100.00", "AAPL"), status).toMatch(/Nothing has been bought or sold yet/);
    }
  });

  it("distinguishes a PARTIAL fill from a complete one", () => {
    const o = describeOrderOutcome("partially_filled");
    expect(o.tone).toBe("resting");
    expect(o.title).toBe("Partially filled");
  });

  it("describes the indeterminate case as unconfirmed, and says to CHECK not retry", () => {
    // The 202 path. Both "filled" and "failed" are guesses here, and each leads
    // the user to do the wrong thing — spend money they may not have, or place a
    // second order that may double the position.
    const o = describeOrderOutcome("unknown");
    expect(o.tone).toBe("unknown");
    expect(o.title).toMatch(/not confirmed/i);
    const detail = o.detail("buy", "$100.00", "AAPL");
    expect(detail).toMatch(/may have been accepted/i);
    expect(detail).toMatch(/before placing another/i);
  });

  it("reports rejection and cancellation as nothing having moved", () => {
    for (const status of ["rejected", "canceled", "cancelled"]) {
      const o = describeOrderOutcome(status);
      expect(o.tone, status).toBe("rejected");
      expect(o.detail("buy", "$100.00", "AAPL"), status).toMatch(/cancelled|Nothing was bought or sold/i);
    }
  });

  it("treats an UNRECOGNISED status as unknown rather than success", () => {
    // The default branch is the one that decides whether this module fails safe.
    // A future provider status must not arrive as a green "filled".
    const o = describeOrderOutcome("some_new_provider_status");
    expect(o.tone).toBe("unknown");
    expect(o.title).not.toMatch(/filled/i);
    expect(o.detail("buy", "$1.00", "AAPL")).toContain("some_new_provider_status");
  });

  it("never returns the `filled` tone for any non-fill status", () => {
    // Stated as a sweep so a new branch cannot quietly become the exception.
    const nonFills = [
      "accepted", "new", "pending_new", "submitted", "unknown",
      "rejected", "canceled", "cancelled", "partially_filled", "gibberish", "",
    ];
    for (const s of nonFills) {
      expect(describeOrderOutcome(s).tone, s).not.toBe("filled");
    }
  });
});

describe("the ticket's order types match what the API accepts", () => {
  it("every tab is a type OrderSchema will accept", () => {
    // A mismatch here is a 400 that looks like a broken order rather than a
    // broken label, so the two lists are checked against each other directly.
    for (const t of ORDER_TICKET_TYPES) {
      const parsed = OrderSchema.safeParse({
        symbol: "AAPL",
        side: "buy",
        notional: 100,
        type: t.value,
        time_in_force: "gtc",
        ...(t.value === "limit" || t.value === "stop_limit" ? { limit_price: 150 } : {}),
        ...(t.value === "stop" || t.value === "stop_limit" ? { stop_price: 140 } : {}),
        ...(t.value === "trailing_stop" ? { trail_percent: 5 } : {}),
      });
      expect(parsed.success, `${t.value} must be accepted by OrderSchema`).toBe(true);
    }
  });

  it("offers the five types the backend supports, market first", () => {
    expect(ORDER_TICKET_TYPES.map((t) => t.value)).toEqual([
      "market",
      "limit",
      "stop",
      "stop_limit",
      "trailing_stop",
    ]);
  });

  it("rejects a trail above 100%, which can never trigger", () => {
    const parsed = OrderSchema.safeParse({
      symbol: "AAPL",
      side: "sell",
      notional: 100,
      type: "trailing_stop",
      trail_percent: 150,
    });
    expect(parsed.success).toBe(false);
  });
});
