import { describe, it, expect } from "vitest";
import { periodBounds, summarizePeriod, summarizeTravel } from "@/lib/expenses/periods";
import type { Period, TripExpense } from "@/lib/expenses/periods";
import type { Transaction } from "@/lib/types";

// The dashboard shows these numbers next to live Alpaca prices, so they have to
// be right for the same reason the prices do. These tests pin the properties a
// user would notice being wrong: totals that drift, a period that files
// transactions into the wrong bucket, and declined payments counted as spend.

let n = 0;
function tx(over: Partial<Transaction> & { amountUsd: number; timestamp: string }): Transaction {
  return {
    id: `t${n++}`,
    category: "card",
    direction: "out",
    title: "Test",
    subtitle: "",
    status: "settled",
    ...over,
  } as Transaction;
}

const trip = (over: Partial<TripExpense> & { amountUsd: number; createdAt: string }): TripExpense => ({
  name: "Hotel",
  city: "Lisbon",
  cashbackUsd: 0,
  status: "confirmed",
  method: "USDC",
  ...over,
});

describe("period boundaries", () => {
  it("starts the week on Monday", () => {
    // Wednesday 2026-07-22 → week starts Monday 2026-07-20.
    const { start } = periodBounds("week", new Date(2026, 6, 22, 15, 0));
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(20);
  });

  it("puts Sunday in the week that already began, not tomorrow's", () => {
    // Sunday 2026-07-26 belongs to the week starting Monday 2026-07-20.
    const { start } = periodBounds("week", new Date(2026, 6, 26, 23, 30));
    expect(start.getDate()).toBe(20);
  });

  it("uses calendar months, not 30-day windows", () => {
    const { start, end } = periodBounds("month", new Date(2026, 1, 14)); // Feb
    expect(start.getMonth()).toBe(1);
    expect(end.getMonth()).toBe(2);
    expect(end.getDate()).toBe(1);
  });

  it("bounds are inclusive-exclusive so a boundary transaction lands in exactly one period", () => {
    const feb = periodBounds("month", new Date(2026, 1, 10));
    const mar = periodBounds("month", new Date(2026, 2, 10));
    expect(feb.end.getTime()).toBe(mar.start.getTime());
  });
});

describe("summarizePeriod totals", () => {
  const now = new Date(2026, 6, 22, 12, 0); // Wed 22 Jul 2026

  it("sums money without float drift", () => {
    // 0.1 + 0.2 in float is 0.30000000000000004. Ten of them must be 3, exactly.
    const txs = Array.from({ length: 10 }, () =>
      tx({ amountUsd: 0.1, timestamp: new Date(2026, 6, 21).toISOString() })
    ).concat(
      Array.from({ length: 10 }, () =>
        tx({ amountUsd: 0.2, timestamp: new Date(2026, 6, 21).toISOString() })
      )
    );
    expect(summarizePeriod(txs, "week", now).totalSpentUsd).toBe(3);
  });

  it("excludes declined transactions from spend", () => {
    const txs = [
      tx({ amountUsd: 100, timestamp: new Date(2026, 6, 21).toISOString() }),
      tx({ amountUsd: 500, timestamp: new Date(2026, 6, 21).toISOString(), status: "declined" }),
    ];
    const s = summarizePeriod(txs, "week", now);
    expect(s.totalSpentUsd).toBe(100);
    expect(s.transactionCount).toBe(1);
  });

  it("counts pending transactions — the money has committed", () => {
    const txs = [tx({ amountUsd: 40, timestamp: new Date(2026, 6, 21).toISOString(), status: "pending" })];
    expect(summarizePeriod(txs, "week", now).totalSpentUsd).toBe(40);
  });

  it("separates inflow from outflow and nets them", () => {
    const txs = [
      tx({ amountUsd: 100, timestamp: new Date(2026, 6, 21).toISOString() }),
      tx({ amountUsd: 250, timestamp: new Date(2026, 6, 21).toISOString(), direction: "in" }),
    ];
    const s = summarizePeriod(txs, "week", now);
    expect(s.totalSpentUsd).toBe(100);
    expect(s.totalReceivedUsd).toBe(250);
    expect(s.netUsd).toBe(150);
  });

  it("ignores transactions outside the period", () => {
    const txs = [
      tx({ amountUsd: 100, timestamp: new Date(2026, 6, 21).toISOString() }), // this week
      tx({ amountUsd: 900, timestamp: new Date(2026, 6, 10).toISOString() }), // earlier
    ];
    expect(summarizePeriod(txs, "week", now).totalSpentUsd).toBe(100);
  });
});

describe("buckets", () => {
  const now = new Date(2026, 6, 22, 12, 0);

  it("spans the whole period even where there was no activity", () => {
    const s = summarizePeriod([], "week", now);
    expect(s.buckets).toHaveLength(7);
    expect(s.buckets.every((b) => b.spentUsd === 0)).toBe(true);
  });

  it("gives a year twelve monthly buckets", () => {
    const s = summarizePeriod([], "year", now);
    expect(s.buckets).toHaveLength(12);
    expect(s.buckets[0].label).toBe("Jan");
    expect(s.buckets[11].label).toBe("Dec");
  });

  it("files a transaction into the correct day", () => {
    // Tuesday 21 Jul is index 1 of a Monday-start week.
    const s = summarizePeriod(
      [tx({ amountUsd: 75, timestamp: new Date(2026, 6, 21, 9).toISOString() })],
      "week",
      now
    );
    expect(s.buckets[1].spentUsd).toBe(75);
    expect(s.buckets[0].spentUsd).toBe(0);
  });

  it("bucket totals reconcile to the period total", () => {
    const txs = [
      tx({ amountUsd: 10.55, timestamp: new Date(2026, 6, 20).toISOString() }),
      tx({ amountUsd: 20.45, timestamp: new Date(2026, 6, 21).toISOString() }),
      tx({ amountUsd: 5.5, timestamp: new Date(2026, 6, 22).toISOString() }),
    ];
    const s = summarizePeriod(txs, "week", now);
    const summed = Math.round(s.buckets.reduce((a, b) => a + b.spentUsd, 0) * 100) / 100;
    expect(summed).toBe(s.totalSpentUsd);
  });
});

describe("categories and comparison", () => {
  const now = new Date(2026, 6, 22, 12, 0);

  it("percentages sum to ~100 and sort descending", () => {
    const txs = [
      tx({ amountUsd: 300, timestamp: new Date(2026, 6, 21).toISOString(), category: "card" }),
      tx({ amountUsd: 100, timestamp: new Date(2026, 6, 21).toISOString(), category: "bill" }),
    ];
    const s = summarizePeriod(txs, "week", now);
    expect(s.categories[0].category).toBe("card");
    expect(s.categories[0].percentage).toBe(75);
    expect(Math.round(s.categories.reduce((a, c) => a + c.percentage, 0))).toBe(100);
  });

  it("returns null change when the previous period had no spend", () => {
    const s = summarizePeriod(
      [tx({ amountUsd: 100, timestamp: new Date(2026, 6, 21).toISOString() })],
      "week",
      now
    );
    // A percentage increase from zero is not a meaningful number.
    expect(s.changePct).toBeNull();
  });

  it("computes change against the preceding period", () => {
    const txs = [
      tx({ amountUsd: 150, timestamp: new Date(2026, 6, 21).toISOString() }), // this week
      tx({ amountUsd: 100, timestamp: new Date(2026, 6, 14).toISOString() }), // last week
    ];
    expect(summarizePeriod(txs, "week", now).changePct).toBe(50);
  });

  it("averages over elapsed days, not period length", () => {
    // Wednesday = 3 elapsed days of a 7-day week. $300 → $100/day, not $42.86.
    const s = summarizePeriod(
      [tx({ amountUsd: 300, timestamp: new Date(2026, 6, 20).toISOString() })],
      "week",
      now
    );
    expect(s.dailyAverageUsd).toBe(100);
  });
});

describe("travel summary", () => {
  const now = new Date(2026, 6, 22, 12, 0);

  it("excludes cancelled trips from spend but keeps them in the count", () => {
    const trips = [
      trip({ amountUsd: 400, createdAt: new Date(2026, 6, 21).toISOString() }),
      trip({ amountUsd: 900, createdAt: new Date(2026, 6, 21).toISOString(), status: "cancelled" }),
    ];
    const s = summarizeTravel(trips, "week", now);
    expect(s.totalSpentUsd).toBe(400);
    expect(s.tripCount).toBe(2);
  });

  it("reports cashback separately and never nets it off spend", () => {
    const s = summarizeTravel(
      [trip({ amountUsd: 1000, cashbackUsd: 25, createdAt: new Date(2026, 6, 21).toISOString() })],
      "week",
      now
    );
    // An expense report that showed $975 would not reconcile against the card statement.
    expect(s.totalSpentUsd).toBe(1000);
    expect(s.cashbackUsd).toBe(25);
  });

  it("ranks cities by spend", () => {
    const s = summarizeTravel(
      [
        trip({ amountUsd: 200, city: "Lisbon", createdAt: new Date(2026, 6, 20).toISOString() }),
        trip({ amountUsd: 700, city: "Tokyo", createdAt: new Date(2026, 6, 21).toISOString() }),
        trip({ amountUsd: 100, city: "Lisbon", createdAt: new Date(2026, 6, 21).toISOString() }),
      ],
      "week",
      now
    );
    expect(s.topCities[0]).toEqual({ city: "Tokyo", amountUsd: 700, trips: 1 });
    expect(s.topCities[1]).toEqual({ city: "Lisbon", amountUsd: 300, trips: 2 });
  });

  it("groups by payment method, the axis finance reconciles along", () => {
    const s = summarizeTravel(
      [
        trip({ amountUsd: 300, method: "USDC", createdAt: new Date(2026, 6, 21).toISOString() }),
        trip({ amountUsd: 100, method: "Visa ..4242", createdAt: new Date(2026, 6, 21).toISOString() }),
      ],
      "week",
      now
    );
    expect(s.categories.map((c) => c.category)).toEqual(["USDC", "Visa ..4242"]);
  });

  it("handles an empty travel history without dividing by zero", () => {
    const s = summarizeTravel([], "year", now);
    expect(s.totalSpentUsd).toBe(0);
    expect(s.dailyAverageUsd).toBe(0);
    expect(s.changePct).toBeNull();
    expect(s.buckets).toHaveLength(12);
  });
});

describe("every period is representable", () => {
  it.each<Period>(["week", "month", "year"])("%s produces a coherent empty summary", (p) => {
    const s = summarizePeriod([], p, new Date(2026, 6, 22));
    expect(new Date(s.periodEnd).getTime()).toBeGreaterThan(new Date(s.periodStart).getTime());
    expect(s.buckets.length).toBeGreaterThan(0);
    expect(s.totalSpentUsd).toBe(0);
  });
});
