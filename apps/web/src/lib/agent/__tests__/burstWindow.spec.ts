import { describe, it, expect, beforeEach } from "vitest";
import { reserveBurst, releaseBurst, burstUsage, burstConfigFrom } from "../burstWindow";

// ---------------------------------------------------------------------------
// The burst bound under concurrency.
//
// THE PROPERTY UNDER TEST: the cap cannot be exceeded, no matter how many
// authorizations arrive at once.
//
// The previous implementation could not offer this. It read the bucket, computed,
// and wrote it back, and agentPolicy's own comment conceded the result: "two
// simultaneous spends can both observe the same balance. The burst bound is
// therefore soft under concurrency." Measured, it was not merely soft — ten
// concurrent calls each read a FULL bucket and the bound contributed nothing.
//
// A test that reserved sequentially would have passed against that code. Every
// test below fires its reservations together.
// ---------------------------------------------------------------------------

beforeEach(() => {
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

/** $100 cap refilled over 24h, i.e. at most 10,000 minor units per 24h window. */
const config = burstConfigFrom({
  capMinor: 10_000,
  refillMinorPerPeriod: 10_000,
  refillPeriodSeconds: 86_400,
});

let ns = 0;
const namespace = () => `test:burst:${++ns}`;

async function fire(n: number, amountMinor: number, space: string) {
  return Promise.all(
    Array.from({ length: n }, () => reserveBurst({ namespace: space, config, amountMinor }))
  );
}

describe("the cap holds under concurrency", () => {
  for (const n of [10, 100, 500]) {
    it(`${n} concurrent reservations never exceed the cap`, async () => {
      const space = namespace();
      // Each is 1% of the cap, so at most 100 can fit however they interleave.
      const results = await fire(n, 100, space);
      const allowed = results.filter((r) => r.allowed).length;

      expect(allowed).toBeLessThanOrEqual(100);
      expect(allowed * 100).toBeLessThanOrEqual(config.capMinor);

      // And the recorded usage agrees with what was granted — a reservation that
      // was granted but not recorded would let the next batch overshoot.
      const usage = await burstUsage({ namespace: space, config });
      expect(usage.usedMinor).toBe(allowed * 100);
      expect(usage.usedMinor).toBeLessThanOrEqual(config.capMinor);
    });
  }

  it("500 concurrent reservations of a QUARTER of the cap admit at most four", async () => {
    const space = namespace();
    const results = await fire(500, config.capMinor / 4, space);
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(4);
    expect(results.filter((r) => !r.allowed)).toHaveLength(496);
  });

  it("concurrent reservations that exactly fill the cap all succeed", async () => {
    // The bound must not be over-eager: 100 x 1% is exactly the cap.
    const space = namespace();
    const results = await fire(100, 100, space);
    expect(results.filter((r) => r.allowed)).toHaveLength(100);
    expect((await burstUsage({ namespace: space, config })).usedMinor).toBe(config.capMinor);
  });

  it("the very next reservation after the cap is filled is refused", async () => {
    const space = namespace();
    await fire(100, 100, space);
    const overflow = await reserveBurst({ namespace: space, config, amountMinor: 1 });
    expect(overflow.allowed).toBe(false);
    if (!overflow.allowed) {
      expect(overflow.reason).toBe("burst_rate_exceeded");
      // A retry CAN eventually work, so the caller is told when.
      expect(overflow.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("namespaces are isolated, so one agent cannot exhaust another", async () => {
    const a = namespace();
    const b = namespace();
    await fire(100, 100, a);
    const other = await reserveBurst({ namespace: b, config, amountMinor: config.capMinor });
    expect(other.allowed).toBe(true);
  });
});

describe("refused reservations are returned, so denials cannot lock the window", () => {
  it("500 refused reservations leave the window at the cap, not above it", async () => {
    const space = namespace();
    // All 500 ask for a quarter of the cap; 4 fit, 496 are refused and must each
    // return what they reserved. Un-refunded, the window would read 125x the cap.
    await fire(500, config.capMinor / 4, space);
    const usage = await burstUsage({ namespace: space, config });
    expect(usage.usedMinor).toBe(config.capMinor);
  });

  it("an explicit release frees capacity for a later reservation", async () => {
    const space = namespace();
    const first = await reserveBurst({ namespace: space, config, amountMinor: config.capMinor });
    expect(first.allowed).toBe(true);

    const blocked = await reserveBurst({ namespace: space, config, amountMinor: 1 });
    expect(blocked.allowed).toBe(false);

    await releaseBurst({ namespace: space, config, amountMinor: config.capMinor });
    const afterRelease = await reserveBurst({ namespace: space, config, amountMinor: 1 });
    expect(afterRelease.allowed).toBe(true);
  });

  it("concurrent reserve and release paths do not drive usage negative", async () => {
    const space = namespace();
    await Promise.all([
      ...Array.from({ length: 50 }, () => reserveBurst({ namespace: space, config, amountMinor: 100 })),
      ...Array.from({ length: 50 }, () => releaseBurst({ namespace: space, config, amountMinor: 100 })),
    ]);
    const usage = await burstUsage({ namespace: space, config });
    expect(usage.usedMinor).toBeGreaterThanOrEqual(0);
    expect(usage.usedMinor).toBeLessThanOrEqual(config.capMinor);
  });
});

describe("a single amount larger than the cap is refused as impossible, not as rate-limited", () => {
  it("says retry will never help", async () => {
    const out = await reserveBurst({
      namespace: namespace(),
      config,
      amountMinor: config.capMinor + 1,
    });
    expect(out.allowed).toBe(false);
    if (!out.allowed) {
      expect(out.reason).toBe("burst_amount_exceeds_cap");
      // The distinction decayingAllowance drew and that must not be lost: a
      // caller told "rate exceeded" retries forever.
      expect(out.retryAfterSeconds).toBeNull();
    }
  });

  it("refuses a non-positive amount", async () => {
    for (const amountMinor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = await reserveBurst({ namespace: namespace(), config, amountMinor });
      expect(out.allowed).toBe(false);
    }
  });
});

describe("window derivation", () => {
  it("a cap equal to the refill rate is a full-period window", () => {
    const c = burstConfigFrom({ capMinor: 5000, refillMinorPerPeriod: 5000, refillPeriodSeconds: 86_400 });
    expect(c.capMinor).toBe(5000);
    expect(c.windowSeconds).toBe(86_400);
  });

  it("a cap of a quarter of the refill rate is a quarter-period window", () => {
    const c = burstConfigFrom({ capMinor: 1250, refillMinorPerPeriod: 5000, refillPeriodSeconds: 86_400 });
    expect(c.windowSeconds).toBe(21_600);
  });

  it("degenerate inputs still yield a usable config rather than throwing", () => {
    const c = burstConfigFrom({ capMinor: 0, refillMinorPerPeriod: 0, refillPeriodSeconds: 0 });
    expect(c.capMinor).toBeGreaterThan(0);
    expect(c.windowSeconds).toBeGreaterThan(0);
  });
});

describe("the window rolls", () => {
  it("usage from a previous window decays out rather than persisting", async () => {
    const space = namespace();
    const base = Date.now();
    // Fill the window at its very start.
    const startOfWindow = Math.floor(base / 1000 / config.windowSeconds) * config.windowSeconds * 1000;
    await reserveBurst({ namespace: space, config, amountMinor: config.capMinor, nowMs: startOfWindow });

    // Immediately after, nothing more fits.
    const blocked = await reserveBurst({ namespace: space, config, amountMinor: 100, nowMs: startOfWindow + 1000 });
    expect(blocked.allowed).toBe(false);

    // A full window later the earlier usage has aged out entirely.
    const nextWindow = startOfWindow + config.windowSeconds * 1000 + config.windowSeconds * 1000;
    const later = await reserveBurst({ namespace: space, config, amountMinor: config.capMinor, nowMs: nextWindow });
    expect(later.allowed).toBe(true);
  });
});
