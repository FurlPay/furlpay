import { describe, it, expect, beforeEach } from "vitest";
import { Money, requireAsset } from "@/lib/money/money";
import {
  bpsOf,
  feeFromBps,
  idempotencyKey,
  SOURCE_ENGINE,
  type RevenueEvent,
} from "../types";
import { buildRevenueEvent, recordRevenue, minor, usdFromFloat } from "../record";
import { __resetRevenueMemory, appendRevenueEvent, listRevenueEvents } from "../store";
import {
  arpuMinor,
  byEngine,
  bySource,
  growthPct,
  netRealized,
  takeRateBps,
  totals,
} from "../aggregate";

// ---------------------------------------------------------------------------
// The revenue metering layer.
//
// The invariants under test, in order of how much damage getting them wrong
// would do:
//
//   1. VOLUME IS NOT REVENUE. $10,000 moving with a $25 fee must report $25.
//      Every aggregation is checked against this directly, because the failure
//      mode is a number that looks plausible and is wrong by 400x.
//   2. SIMULATED IS NOT REVENUE, and no env var reclassifies it.
//   3. IDEMPOTENCY. The same business event recorded twice produces one row.
//   4. EXACT MONEY. No float ever reaches a stored amount.
//   5. REVERSALS reduce revenue rather than vanishing.
// ---------------------------------------------------------------------------

const USD = requireAsset("USD");
const usd = (dollars: string) => Money.parse(dollars, USD);

beforeEach(() => {
  __resetRevenueMemory();
});

function event(over: Partial<RevenueEvent> = {}): RevenueEvent {
  return {
    id: over.id ?? `t:${Math.random()}`,
    createdAt: over.createdAt ?? Date.UTC(2026, 8, 15),
    userId: over.userId ?? "u1",
    organizationId: null,
    source: over.source ?? "subscription_charge",
    engine: over.engine ?? "subscription",
    status: over.status ?? "realized",
    asset: over.asset ?? "USD",
    chain: over.chain ?? null,
    feeMinor: over.feeMinor ?? "1000",
    volumeMinor: over.volumeMinor ?? null,
    feeBps: over.feeBps ?? null,
    externalRef: over.externalRef ?? "ref",
    metadata: over.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------

describe("volume is never revenue", () => {
  it("reports the fee, not the amount that moved", () => {
    // The headline case: $10,000 across a rail, $25 kept.
    const e = event({
      source: "swap_integrator_fee",
      engine: "transaction",
      feeMinor: "2500", // $25.00
      volumeMinor: "1000000", // $10,000.00
    });
    const t = totals([e]);
    expect(t.realized.USD).toBe("2500");
    expect(t.volume.USD).toBe("1000000");
    // The two must never be conflated.
    expect(t.realized.USD).not.toBe(t.volume.USD);
  });

  it("has no field that merges fee and volume", () => {
    const e = event({ feeMinor: "2500", volumeMinor: "1000000" });
    expect(Object.keys(e)).not.toContain("amount");
  });

  it("computes take rate from the fee over the volume", () => {
    // $25 on $10,000 = 25 bps.
    const e = event({ feeMinor: "2500", volumeMinor: "1000000" });
    expect(takeRateBps([e]).USD).toBe(25);
  });
});

describe("take-rate denominator", () => {
  it("excludes events that carry no volume", () => {
    // A flat subscription has no underlying flow. If it were counted in the
    // numerator but not the denominator the rate would be nonsense.
    const swap = event({
      source: "swap_integrator_fee",
      engine: "transaction",
      feeMinor: "2500",
      volumeMinor: "1000000",
    });
    const sub = event({ id: "sub1", feeMinor: "999900", volumeMinor: null });
    // The large subscription must not move the take rate at all.
    expect(takeRateBps([swap, sub]).USD).toBe(25);
  });

  it("excludes simulated volume from the applicable denominator", () => {
    const real = event({ feeMinor: "2500", volumeMinor: "1000000", source: "swap_integrator_fee", engine: "transaction" });
    const sim = event({ id: "s2", status: "simulated", feeMinor: "50000", volumeMinor: "20000000" });
    const t = totals([real, sim]);
    expect(t.volume.USD).toBe("21000000"); // both, for flow visibility
    expect(t.applicableVolume.USD).toBe("1000000"); // only the real one
    expect(takeRateBps([real, sim]).USD).toBe(25);
  });

  it("returns null rather than zero when there is no applicable volume", () => {
    // "no rate" and "a rate of zero" are different claims.
    const sub = event({ volumeMinor: null });
    expect(takeRateBps([sub]).USD).toBeUndefined();
  });
});

describe("simulated revenue is not revenue", () => {
  it("is bucketed separately and excluded from realized", () => {
    const sim = event({ status: "simulated", feeMinor: "500000" });
    const t = totals([sim]);
    expect(t.simulated.USD).toBe("500000");
    expect(t.realized.USD).toBeUndefined();
    expect(netRealized(t).USD).toBeUndefined();
  });

  it("is not reclassified by INTEGRATION_MODE", () => {
    // Status comes from the code path that had the evidence, never from env.
    process.env.INTEGRATION_MODE = "live";
    try {
      const t = totals([event({ status: "simulated", feeMinor: "500000" })]);
      expect(t.realized.USD).toBeUndefined();
      expect(t.simulated.USD).toBe("500000");
    } finally {
      delete process.env.INTEGRATION_MODE;
    }
  });

  it("keeps simulated users out of the paying-user count", () => {
    const t = totals([event({ status: "simulated", userId: "u9" })]);
    expect(t.payingUsers).toBe(0);
  });
});

describe("idempotency", () => {
  it("derives the same id for the same business event", () => {
    expect(idempotencyKey("subscription_charge", "cs_ABC")).toBe(
      idempotencyKey("subscription_charge", "cs_abc"),
    );
  });

  it("refuses an empty external reference", () => {
    expect(() => idempotencyKey("x402_payment", "   ")).toThrow(/idempotency/i);
  });

  it("writes once for a redelivered webhook", async () => {
    const input = {
      source: "subscription_charge" as const,
      status: "realized" as const,
      externalRef: "cs_test_1",
      fee: usd("29.00"),
      userId: "u1",
    };
    const first = await recordRevenue(input);
    const second = await recordRevenue(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false); // already recorded
    expect(second.recorded).toBe(true); // and that is success, not failure
    expect(await listRevenueEvents()).toHaveLength(1);
  });

  it("does not double-count when the amount is recomputed on retry", async () => {
    // A redelivery that recalculates a slightly different amount must still
    // collapse onto the same row — the id is the business event, not the money.
    await recordRevenue({
      source: "subscription_charge",
      status: "realized",
      externalRef: "cs_same",
      fee: usd("29.00"),
    });
    await recordRevenue({
      source: "subscription_charge",
      status: "realized",
      externalRef: "cs_same",
      fee: usd("31.00"),
    });
    const all = await listRevenueEvents();
    expect(all).toHaveLength(1);
    expect(all[0].feeMinor).toBe("2900"); // first write wins
  });

  it("keeps a reversal as its own row", async () => {
    await recordRevenue({
      source: "subscription_charge",
      status: "realized",
      externalRef: "cs_ref",
      fee: usd("29.00"),
    });
    await recordRevenue({
      source: "subscription_charge",
      status: "reversed",
      externalRef: "cs_ref",
      fee: Money.ofMinor(-2900n, USD),
    });
    const all = await listRevenueEvents();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.status).sort()).toEqual(["realized", "reversed"]);
  });
});

describe("reversals", () => {
  it("reduce realized revenue rather than disappearing", () => {
    const charge = event({ id: "a", feeMinor: "2900" });
    const refund = event({ id: "b", status: "reversed", feeMinor: "-2900" });
    const t = totals([charge, refund]);
    expect(t.realized.USD).toBe("2900");
    expect(t.reversed.USD).toBe("-2900");
    expect(netRealized(t).USD).toBe("0");
  });

  it("must carry a negative fee", () => {
    expect(() =>
      buildRevenueEvent({
        source: "subscription_charge",
        status: "reversed",
        externalRef: "r1",
        fee: usd("29.00"),
      }),
    ).toThrow(/negates/i);
  });
});

describe("exact money", () => {
  it("stores minor units as integer strings", () => {
    const e = buildRevenueEvent({
      source: "subscription_charge",
      status: "realized",
      externalRef: "x",
      fee: usd("29.99"),
    });
    expect(e.feeMinor).toBe("2999");
    expect(e.feeMinor).toMatch(/^-?\d+$/);
  });

  it("computes bps with integer arithmetic, not floats", () => {
    // 0.1 + 0.2 territory: a float path gives 24.999999 and floors to 24.
    const fee = Money.ofMinor(30n, USD);
    const volume = Money.ofMinor(10_000n, USD);
    expect(bpsOf(fee, volume)).toBe(30);
  });

  it("takes bps of a volume, rounding toward the customer", () => {
    // 25 bps of $100.00 = $0.25 exactly.
    expect(feeFromBps(usd("100.00"), 25).minor).toBe(25n);
    // 25 bps of $0.03 = 0.0075 cents -> floors to 0, never rounds up to 1.
    expect(feeFromBps(usd("0.03"), 25).minor).toBe(0n);
  });

  it("rejects a fractional bps", () => {
    expect(() => feeFromBps(usd("100.00"), 2.5)).toThrow(/integer/i);
  });

  it("converts a legacy float dollar amount at the boundary only", () => {
    expect(usdFromFloat(29.99).minor).toBe(2999n);
    expect(usdFromFloat(0.1 + 0.2).minor).toBe(30n); // not 30.000000000000004
  });

  it("refuses a non-finite amount", () => {
    expect(() => usdFromFloat(Number.NaN)).toThrow(/non-finite/i);
  });
});

describe("validation", () => {
  it("rejects a fee and volume in different assets", () => {
    expect(() =>
      buildRevenueEvent({
        source: "swap_integrator_fee",
        status: "realized",
        externalRef: "x",
        fee: usd("1.00"),
        volume: minor(1_000_000n, "USDC.base"),
      }),
    ).toThrow(/does not match/i);
  });

  it("rejects a fee larger than its volume", () => {
    // The signature of a major/minor unit mix-up.
    expect(() =>
      buildRevenueEvent({
        source: "swap_integrator_fee",
        status: "realized",
        externalRef: "x",
        fee: usd("100.00"),
        volume: usd("10.00"),
      }),
    ).toThrow(/exceeds volume/i);
  });

  it("rejects a negative fee outside a reversal", () => {
    expect(() =>
      buildRevenueEvent({
        source: "subscription_charge",
        status: "realized",
        externalRef: "x",
        fee: Money.ofMinor(-100n, USD),
      }),
    ).toThrow(/reversal/i);
  });

  it("maps every source to an engine", () => {
    for (const [source, engine] of Object.entries(SOURCE_ENGINE)) {
      expect(engine, source).toBeTruthy();
    }
    expect(SOURCE_ENGINE.swap_integrator_fee).toBe("transaction");
    expect(SOURCE_ENGINE.subscription_charge).toBe("subscription");
    expect(SOURCE_ENGINE.x402_payment).toBe("api");
  });

  it("derives feeBps rather than accepting it", () => {
    const e = buildRevenueEvent({
      source: "swap_integrator_fee",
      status: "realized",
      externalRef: "x",
      fee: usd("25.00"),
      volume: usd("10000.00"),
    });
    expect(e.feeBps).toBe(25);
  });
});

describe("aggregation", () => {
  const set = [
    event({ id: "1", source: "swap_integrator_fee", engine: "transaction", feeMinor: "2500", volumeMinor: "1000000" }),
    event({ id: "2", source: "subscription_charge", engine: "subscription", feeMinor: "2900", userId: "u2" }),
    event({ id: "3", source: "x402_payment", engine: "api", feeMinor: "10", userId: null }),
    event({ id: "4", status: "simulated", source: "swap_integrator_fee", engine: "transaction", feeMinor: "9999" }),
  ];

  it("splits by engine", () => {
    const g = byEngine(set);
    expect(g.transaction.realized.USD).toBe("2500");
    expect(g.subscription.realized.USD).toBe("2900");
    expect(g.api.realized.USD).toBe("10");
    expect(g.transaction.simulated.USD).toBe("9999");
  });

  it("splits by source", () => {
    const g = bySource(set);
    expect(g.swap_integrator_fee.realized.USD).toBe("2500");
    expect(g.subscription_charge.realized.USD).toBe("2900");
  });

  it("counts distinct paying accounts only", () => {
    // u1 (event 1), u2 (event 2). Event 3 has no user; event 4 is simulated.
    expect(totals(set).payingUsers).toBe(2);
  });

  it("computes ARPU over paying accounts", () => {
    // realized = 2500 + 2900 + 10 = 5410 across 2 identified payers.
    expect(arpuMinor(set).USD).toBe("2705");
  });

  it("keeps assets separate", () => {
    const mixed = [
      event({ id: "a", asset: "USD", feeMinor: "100" }),
      event({ id: "b", asset: "USDC.base", feeMinor: "100" }),
    ];
    const t = totals(mixed);
    expect(t.realized.USD).toBe("100");
    expect(t.realized["USDC.base"]).toBe("100");
    // Never summed into one number: 100 cents != 100 micro-USDC.
    expect(Object.keys(t.realized)).toHaveLength(2);
  });

  it("computes growth and refuses to divide by zero", () => {
    expect(growthPct({ USD: "150" }, { USD: "100" }).USD).toBe(50);
    expect(growthPct({ USD: "50" }, { USD: "100" }).USD).toBe(-50);
    expect(growthPct({ USD: "100" }, { USD: "0" }).USD).toBeNull();
  });

  it("ignores voided events entirely", () => {
    const t = totals([event({ status: "voided", feeMinor: "5000" })]);
    expect(t.realized.USD).toBeUndefined();
    expect(t.simulated.USD).toBeUndefined();
    expect(t.eventCount).toBe(1);
  });
});

describe("store", () => {
  it("returns events newest first", async () => {
    await appendRevenueEvent(event({ id: "old", createdAt: 1000 }));
    await appendRevenueEvent(event({ id: "new", createdAt: 2000 }));
    const all = await listRevenueEvents();
    expect(all.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("filters by window", async () => {
    await appendRevenueEvent(event({ id: "in", createdAt: 1500 }));
    await appendRevenueEvent(event({ id: "out", createdAt: 500 }));
    const all = await listRevenueEvents({ from: 1000, to: 2000 });
    expect(all.map((e) => e.id)).toEqual(["in"]);
  });
});
