import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  kycTransitionAllowed,
  occurredAtMs,
  recordApplied,
  staleEvent,
} from "../webhookOrdering";

// ---------------------------------------------------------------------------
// Ordering is a different problem from idempotency, and the tests have to keep
// that straight.
//
// webhookGuard already makes "the same event twice" safe. It cannot make "two
// DIFFERENT events, in the wrong order" safe, because each id is genuinely new
// and each claim genuinely succeeds. That is the gap these tests pin: a
// delayed `deposit.reversed` applied after a later `deposit.settled` leaves a
// balance that is wrong, with every event processed exactly once.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const R = () => `deposit:test:${Math.random().toString(36).slice(2)}`;

describe("staleEvent — the high-water mark per resource", () => {
  it("lets the first event for a resource through", async () => {
    expect(await staleEvent({ resource: R(), occurredAtMs: 1_000 })).toBe(false);
  });

  it("drops an event older than one already applied to the same resource", async () => {
    const resource = R();
    await recordApplied({ resource, occurredAtMs: 5_000 });
    expect(await staleEvent({ resource, occurredAtMs: 4_999 })).toBe(true);
  });

  it("does NOT drop an event with an equal timestamp", async () => {
    // Providers stamp bursts of related events with the same millisecond.
    // Dropping the second would lose a real change, and a true duplicate is
    // already handled by webhookGuard's id claim.
    const resource = R();
    await recordApplied({ resource, occurredAtMs: 5_000 });
    expect(await staleEvent({ resource, occurredAtMs: 5_000 })).toBe(false);
  });

  it("lets a newer event through and moves the mark forward", async () => {
    const resource = R();
    await recordApplied({ resource, occurredAtMs: 5_000 });
    expect(await staleEvent({ resource, occurredAtMs: 6_000 })).toBe(false);
    await recordApplied({ resource, occurredAtMs: 6_000 });
    expect(await staleEvent({ resource, occurredAtMs: 5_500 })).toBe(true);
  });

  it("never moves the mark BACKWARDS", async () => {
    const resource = R();
    await recordApplied({ resource, occurredAtMs: 9_000 });
    await recordApplied({ resource, occurredAtMs: 1_000 });
    // If the mark had regressed, this older event would now be accepted.
    expect(await staleEvent({ resource, occurredAtMs: 8_000 })).toBe(true);
  });

  it("keeps resources independent", async () => {
    const a = R();
    const b = R();
    await recordApplied({ resource: a, occurredAtMs: 9_000 });
    expect(await staleEvent({ resource: b, occurredAtMs: 1_000 })).toBe(false);
  });

  it("lets an unorderable event through rather than guessing", async () => {
    // No usable timestamp is not the same statement as "old". Dropping it
    // would discard a real event because the provider omitted a field.
    const resource = R();
    await recordApplied({ resource, occurredAtMs: 9_000 });
    expect(await staleEvent({ resource, occurredAtMs: Number.NaN })).toBe(false);
  });
});

describe("occurredAtMs — providers are inconsistent about units", () => {
  it("passes milliseconds through", () => {
    expect(occurredAtMs(1_760_000_000_000)).toBe(1_760_000_000_000);
  });

  it("scales seconds up to milliseconds", () => {
    // Guessing this wrong by 1000x would make every event look ancient and
    // drop the lot.
    expect(occurredAtMs(1_760_000_000)).toBe(1_760_000_000_000);
  });

  it("parses an ISO timestamp", () => {
    expect(occurredAtMs("2026-09-06T00:00:00.000Z")).toBe(Date.parse("2026-09-06T00:00:00.000Z"));
  });

  it("parses a numeric string in either unit", () => {
    expect(occurredAtMs("1760000000")).toBe(1_760_000_000_000);
    expect(occurredAtMs("1760000000000")).toBe(1_760_000_000_000);
  });

  it("returns NaN for anything unusable", () => {
    for (const bad of [undefined, null, "", "not-a-date", {}, []]) {
      expect(Number.isNaN(occurredAtMs(bad)), String(bad)).toBe(true);
    }
  });
});

describe("kycTransitionAllowed — a retry may not demote a verified user", () => {
  it("refuses verified -> unverified", () => {
    // The concrete failure: a delayed `inquiry.failed` lands after a later
    // approval and silently strips a user who may already have transacted
    // against the higher tier cap.
    expect(kycTransitionAllowed("verified", "unverified")).toBe(false);
  });

  it("refuses verified -> pending", () => {
    expect(kycTransitionAllowed("verified", "pending")).toBe(false);
  });

  it("permits verified -> verified (a harmless redelivery)", () => {
    expect(kycTransitionAllowed("verified", "verified")).toBe(true);
  });

  it("permits every forward transition", () => {
    expect(kycTransitionAllowed("unverified", "pending")).toBe(true);
    expect(kycTransitionAllowed("unverified", "verified")).toBe(true);
    expect(kycTransitionAllowed("pending", "verified")).toBe(true);
  });

  it("permits the normal unhappy path, pending -> unverified", () => {
    expect(kycTransitionAllowed("pending", "unverified")).toBe(true);
  });
});
