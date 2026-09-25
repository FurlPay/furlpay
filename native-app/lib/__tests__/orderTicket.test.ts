import { describeOrderOutcome, ORDER_TICKET_TYPES } from "../markets/orderTicket";

// ---------------------------------------------------------------------------
// The mobile order ticket must not tell a user their money moved when it has not.
//
// This screen already distinguished `filled` from `Placed`, which the web sheet
// did not. What it could NOT do is tell a RESTING order from an UNCONFIRMED one:
// both read as "Placed", and those need opposite actions. A resting limit order is
// working as intended and should be left alone; an unconfirmed submission must be
// checked before another order is placed, or the position may double.
//
// These also pin the contract with the server. The strings here are duplicated
// from apps/web (this app shares no code with it), so the test is what stops the
// copies drifting — a tab whose `type` the route does not accept produces a 400
// that reads as a broken order rather than a broken label.
// ---------------------------------------------------------------------------

describe("order outcome copy", () => {
  it("reports a fill as a fill", () => {
    const o = describeOrderOutcome("filled");
    expect(o.tone).toBe("filled");
    expect(o.title).toBe("Filled");
  });

  it("separates RESTING from UNCONFIRMED, which used to read the same", () => {
    const resting = describeOrderOutcome("accepted");
    const unknown = describeOrderOutcome("unknown");

    expect(resting.tone).toBe("resting");
    expect(resting.detail).toMatch(/Nothing bought or sold yet/);

    expect(unknown.tone).toBe("unknown");
    // The actionable difference: check before re-submitting.
    expect(unknown.detail).toMatch(/Check before placing another/i);

    expect(resting.tone).not.toBe(unknown.tone);
    expect(resting.detail).not.toBe(unknown.detail);
  });

  it("treats every resting-equivalent provider status the same way", () => {
    for (const s of ["accepted", "new", "pending_new", "submitted"]) {
      expect(describeOrderOutcome(s).tone).toBe("resting");
    }
  });

  it("reports a partial fill as partial, not complete", () => {
    expect(describeOrderOutcome("partially_filled").title).toBe("Partially filled");
    expect(describeOrderOutcome("partially_filled").tone).toBe("resting");
  });

  it("reports rejection and cancellation as nothing having moved", () => {
    for (const s of ["rejected", "canceled", "cancelled"]) {
      expect(describeOrderOutcome(s).tone).toBe("rejected");
    }
    expect(describeOrderOutcome("rejected").detail).toMatch(/Nothing moved/);
  });

  it("never reports an unrecognised status as filled", () => {
    // The default branch decides whether this fails safe. A future provider
    // status must not arrive as a green "Filled".
    const o = describeOrderOutcome("some_future_status");
    expect(o.tone).toBe("unknown");
    expect(o.detail).toContain("some_future_status");

    const nonFills = [
      "accepted", "new", "pending_new", "submitted", "unknown",
      "rejected", "canceled", "cancelled", "partially_filled", "", "weird",
    ];
    for (const s of nonFills) {
      expect(describeOrderOutcome(s).tone).not.toBe("filled");
    }
  });
});

describe("order types match the server contract", () => {
  it("offers exactly the five types OrderSchema accepts, market first", () => {
    // Mirrors apps/web/src/lib/markets/orderTicket.ts. If the web copy gains a
    // type, this list has to gain it too or mobile silently lacks the feature;
    // if the SERVER drops one, this list is where the 400 would come from.
    expect(ORDER_TICKET_TYPES.map((t) => t.value)).toEqual([
      "market",
      "limit",
      "stop",
      "stop_limit",
      "trailing_stop",
    ]);
  });

  it("gives every type a human label", () => {
    for (const t of ORDER_TICKET_TYPES) {
      expect(t.label.length).toBeGreaterThan(0);
      // The label is never the raw API value — `stop_limit` is not a phrase.
      expect(t.label).not.toContain("_");
    }
  });
});
