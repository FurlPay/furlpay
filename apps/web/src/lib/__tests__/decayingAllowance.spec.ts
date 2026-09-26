import { describe, expect, it } from "vitest";
import {
  accrue,
  AllowanceConfigError,
  bucketRefillingOver,
  evaluateSpend,
  initBucket,
  refund,
  type BucketConfig,
} from "@/lib/agent/decayingAllowance";

const T0 = 1_756_000_000_000; // fixed epoch ms; no wall clock in these tests

/** $500 cap, fully refilling over 24h. */
const cfg: BucketConfig = bucketRefillingOver(50_000, 24);

describe("config validation", () => {
  it("rejects nonsense configuration rather than limping along", () => {
    const s = initBucket(cfg, T0);
    expect(() => accrue({ ...cfg, capMinor: 0 }, s, T0)).toThrow(AllowanceConfigError);
    expect(() => accrue({ ...cfg, capMinor: 1.5 }, s, T0)).toThrow(AllowanceConfigError);
    expect(() => accrue({ ...cfg, refillWindowSeconds: 0 }, s, T0)).toThrow(AllowanceConfigError);
    expect(() => accrue({ ...cfg, refillMinorPerWindow: -1 }, s, T0)).toThrow(AllowanceConfigError);
  });

  it("rejects a non-positive or fractional spend", () => {
    const s = initBucket(cfg, T0);
    for (const bad of [0, -1, 10.5, NaN]) {
      expect(() => evaluateSpend(cfg, s, bad, T0)).toThrow(AllowanceConfigError);
    }
  });
});

describe("bucket lifecycle", () => {
  it("starts full", () => {
    expect(initBucket(cfg, T0)).toEqual({ availableMinor: 50_000, updatedAtMs: T0 });
  });

  it("allows a spend within the balance and deducts exactly", () => {
    const d = evaluateSpend(cfg, initBucket(cfg, T0), 12_345, T0);
    expect(d.outcome).toBe("allow");
    if (d.outcome === "allow") {
      expect(d.availableAfterMinor).toBe(50_000 - 12_345);
    }
  });

  it("denies a spend past the balance and says when to retry", () => {
    let state = initBucket(cfg, T0);
    const first = evaluateSpend(cfg, state, 50_000, T0);
    expect(first.outcome).toBe("allow");
    if (first.outcome === "allow") state = first.state;

    // Bucket is now empty.
    const denied = evaluateSpend(cfg, state, 10_000, T0);
    expect(denied.outcome).toBe("deny");
    if (denied.outcome === "deny") {
      expect(denied.shortfallMinor).toBe(10_000);
      // 10,000 of 50,000 units at a 24h full refill = 1/5 of 24h = 4.8h.
      expect(denied.retryAtMs).toBe(T0 + Math.ceil((10_000 * 24 * 3600 * 1000) / 50_000));
    }
  });

  it("returns retryAtMs null when the spend exceeds the cap entirely", () => {
    const denied = evaluateSpend(cfg, { availableMinor: 0, updatedAtMs: T0 }, 60_000, T0);
    expect(denied.outcome).toBe("deny");
    if (denied.outcome === "deny") expect(denied.retryAtMs).toBeNull();
  });
});

describe("the burst property — why this exists alongside the daily budget", () => {
  it("lets an attacker take the bucket but not the day", () => {
    // Drain instantly.
    let state = initBucket(cfg, T0);
    const drain = evaluateSpend(cfg, state, 50_000, T0);
    if (drain.outcome === "allow") state = drain.state;

    // One second later the bucket has accrued well under a dollar, so a second
    // large spend is impossible — which is the whole point. A pure daily
    // budget would still have had its full remaining balance available here.
    const immediately = evaluateSpend(cfg, state, 10_000, T0 + 1_000);
    expect(immediately.outcome).toBe("deny");

    // An hour on, roughly 1/24th of the cap is available: ~2083 units.
    const afterAnHour = accrue(cfg, state, T0 + 3_600_000);
    expect(afterAnHour.availableMinor).toBe(Math.floor(50_000 / 24));
  });
});

describe("accrual arithmetic", () => {
  it("never exceeds the cap however long it sits", () => {
    const state = { availableMinor: 0, updatedAtMs: T0 };
    expect(accrue(cfg, state, T0 + 365 * 24 * 3600_000).availableMinor).toBe(50_000);
  });

  it("grants no allowance when the clock goes backwards", () => {
    const state = { availableMinor: 1_000, updatedAtMs: T0 };
    const out = accrue(cfg, state, T0 - 3_600_000);
    expect(out.availableMinor).toBe(1_000);
    expect(out.updatedAtMs).toBe(T0);
  });

  it("gives no free allowance to a caller that polls rapidly", () => {
    // THE key property. Accrual rounds down, so 1,000 sub-unit polls must not
    // compound into extra authority versus a single call over the same span.
    const start = { availableMinor: 0, updatedAtMs: T0 };
    const spanMs = 3_600_000;

    let polled = start;
    for (let i = 1; i <= 1000; i += 1) {
      polled = accrue(cfg, polled, T0 + (spanMs * i) / 1000);
    }
    const single = accrue(cfg, start, T0 + spanMs);

    expect(polled.availableMinor).toBeLessThanOrEqual(single.availableMinor);
  });

  it("does not strand fractional progress between calls", () => {
    // Inverse of the above: polling must not LOSE progress either, or a
    // frequently-checked bucket would never refill at all.
    const start = { availableMinor: 0, updatedAtMs: T0 };
    let polled = start;
    for (let i = 1; i <= 600; i += 1) {
      polled = accrue(cfg, polled, T0 + i * 6_000); // every 6s for an hour
    }
    const single = accrue(cfg, start, T0 + 3_600_000);
    // Allow one unit of rounding slack, but it must be in the same territory,
    // not zero.
    expect(polled.availableMinor).toBeGreaterThanOrEqual(single.availableMinor - 1);
  });

  it("holds the no-free-allowance property across many rates", () => {
    for (const hours of [1, 6, 24, 168]) {
      for (const cap of [100, 5_000, 50_000, 1_000_000]) {
        const c = bucketRefillingOver(cap, hours);
        const start = { availableMinor: 0, updatedAtMs: T0 };
        const span = hours * 3600_000;

        let polled = start;
        for (let i = 1; i <= 200; i += 1) polled = accrue(c, polled, T0 + (span * i) / 200);
        const single = accrue(c, start, T0 + span);

        expect(polled.availableMinor).toBeLessThanOrEqual(single.availableMinor);
        expect(polled.availableMinor).toBeLessThanOrEqual(c.capMinor);
      }
    }
  });
});

describe("single-spend step-up gate", () => {
  const stepUpCfg: BucketConfig = { ...cfg, singleSpendStepUpMinor: 20_000 };

  it("escalates a large spend even when the balance covers it", () => {
    const d = evaluateSpend(stepUpCfg, initBucket(stepUpCfg, T0), 20_000, T0);
    expect(d.outcome).toBe("step_up");
    if (d.outcome === "step_up") expect(d.thresholdMinor).toBe(20_000);
  });

  it("prefers step_up over deny, so the user is told the real reason", () => {
    // Empty bucket AND over the threshold: the honest answer is "confirm
    // this", not "insufficient funds" — which would send the user to top up
    // instead of looking at what their agent just tried to buy.
    const d = evaluateSpend(stepUpCfg, { availableMinor: 0, updatedAtMs: T0 }, 30_000, T0);
    expect(d.outcome).toBe("step_up");
  });

  it("leaves ordinary spends alone", () => {
    expect(evaluateSpend(stepUpCfg, initBucket(stepUpCfg, T0), 19_999, T0).outcome).toBe("allow");
  });
});

describe("refund", () => {
  it("returns authority for a spend that failed downstream", () => {
    let state = initBucket(cfg, T0);
    const d = evaluateSpend(cfg, state, 5_000, T0);
    if (d.outcome === "allow") state = d.state;
    expect(state.availableMinor).toBe(45_000);
    expect(refund(cfg, state, 5_000).availableMinor).toBe(50_000);
  });

  it("cannot overfill the bucket past its policy cap", () => {
    const state = initBucket(cfg, T0);
    expect(refund(cfg, state, 999_999).availableMinor).toBe(50_000);
  });

  it("rejects a non-positive refund", () => {
    expect(() => refund(cfg, initBucket(cfg, T0), 0)).toThrow(AllowanceConfigError);
  });
});
