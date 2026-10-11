import { afterEach, describe, expect, it, vi } from "vitest";
import { captureHold, createHold, listHolds, releaseHold } from "../escrow";

// SEC-P2-001: escrow holds move only held → captured | released | expired.
// Every other transition is refused, and only the owner can act.

afterEach(() => vi.useRealTimers());

const hold = (user = "u-a", amount = 100) => createHold(user, "card-1", "Hotel", amount);

describe("escrow hold state machine", () => {
  it("a captured hold cannot be released (no refund of an already-paid capture)", () => {
    const h = hold();
    captureHold(h.id, 60, "u-a");
    expect(() => releaseHold(h.id, "u-a")).toThrow(/already captured/);
    expect(h).toMatchObject({ status: "captured", capturedAmount: 60 });
  });

  it("a released hold cannot be released or captured again", () => {
    const h = hold();
    releaseHold(h.id, "u-a");
    expect(() => releaseHold(h.id, "u-a")).toThrow(/already released/);
    expect(() => captureHold(h.id, 10, "u-a")).toThrow(/already released/);
  });

  it("a hold cannot be captured twice", () => {
    const h = hold();
    captureHold(h.id, 40, "u-a");
    expect(() => captureHold(h.id, 40, "u-a")).toThrow(/already captured/);
  });

  it("an expired hold is neither capturable nor releasable, even before a listing expires it", () => {
    vi.useFakeTimers();
    const h = hold();
    vi.setSystemTime(Date.now() + 8 * 86_400_000); // past the 7-day TTL
    expect(() => captureHold(h.id, 10, "u-a")).toThrow(/already expired/);
    expect(() => releaseHold(h.id, "u-a")).toThrow(/already expired/);
    expect(h).toMatchObject({ status: "expired", capturedAmount: 0 });
  });

  it("capture amount must be positive and within the authorization", () => {
    const h = hold("u-a", 50);
    expect(() => captureHold(h.id, 0, "u-a")).toThrow();
    expect(() => captureHold(h.id, -5, "u-a")).toThrow();
    expect(() => captureHold(h.id, 50.01, "u-a")).toThrow(/exceeds/);
    expect(h.status).toBe("held");
  });

  it("user B can neither see, capture nor release user A's hold", () => {
    const h = hold("u-a");
    expect(() => captureHold(h.id, 10, "u-b")).toThrow(/not found/);
    expect(() => releaseHold(h.id, "u-b")).toThrow(/not found/);
    expect(listHolds("u-b").some((x) => x.id === h.id)).toBe(false);
    expect(h.status).toBe("held");
  });
});
