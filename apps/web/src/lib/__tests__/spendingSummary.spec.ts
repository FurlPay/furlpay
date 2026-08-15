// Spending summary windowing + rollup. The server-side twin of Guardian's
// ComputeSpendingSummaryUseCase — these tests pin the two properties that make
// the two agree: the window is computed in the CALLER's zone, and it survives
// DST transitions.

import { describe, it, expect } from "vitest";
import {
  computeSpendingSummary,
  isValidTimeZone,
  windowStart,
} from "@/lib/spendingSummary";
import type { Transaction, TxCategory } from "@/lib/types";

function tx(over: Partial<Transaction> & { timestamp: string }): Transaction {
  return {
    id: `tx_${Math.random().toString(16).slice(2)}`,
    category: "shopping" as TxCategory,
    direction: "out",
    title: "Test",
    subtitle: "",
    amountUsd: 10,
    status: "settled",
    ...over,
  } as Transaction;
}

describe("windowStart — timezone correctness", () => {
  it("computes 'today' in the CALLER's zone, not UTC", () => {
    // February — unambiguously PST (UTC-8), well clear of any DST transition.
    // 2026-02-10T02:00:00Z is still Feb 9 in Los Angeles.
    const now = Date.parse("2026-02-10T02:00:00Z");
    expect(new Date(windowStart("today", now, "UTC")).toISOString()).toBe("2026-02-10T00:00:00.000Z");
    // LA local midnight of Feb 9 == 08:00Z on Feb 9.
    expect(new Date(windowStart("today", now, "America/Los_Angeles")).toISOString()).toBe(
      "2026-02-09T08:00:00.000Z"
    );
  });

  it("handles a zone ahead of UTC (day already rolled over)", () => {
    // 2026-03-09T20:00:00Z is already Mar 10 in Tokyo (UTC+9).
    const now = Date.parse("2026-03-09T20:00:00Z");
    expect(new Date(windowStart("today", now, "Asia/Tokyo")).toISOString()).toBe(
      "2026-03-09T15:00:00.000Z" // Tokyo midnight Mar 10
    );
  });

  it("lands on local midnight across a spring-forward DST boundary", () => {
    // US DST began 2026-03-08. A day AFTER the transition: LA is UTC-7, so
    // local midnight is 07:00Z, not the 08:00Z that a pre-transition offset
    // would have produced. This is what the second correction pass buys.
    const now = Date.parse("2026-03-09T18:00:00Z");
    expect(new Date(windowStart("today", now, "America/Los_Angeles")).toISOString()).toBe(
      "2026-03-09T07:00:00.000Z"
    );
  });

  it("starts the week on Monday (ISO), crossing a month boundary", () => {
    // Wed 2026-04-01 UTC → the ISO week began Mon 2026-03-30.
    const now = Date.parse("2026-04-01T12:00:00Z");
    expect(new Date(windowStart("this_week", now, "UTC")).toISOString()).toBe("2026-03-30T00:00:00.000Z");
  });

  it("treats Sunday as the END of the ISO week, not the start", () => {
    // Sun 2026-04-05 → week still began Mon 2026-03-30.
    const now = Date.parse("2026-04-05T12:00:00Z");
    expect(new Date(windowStart("this_week", now, "UTC")).toISOString()).toBe("2026-03-30T00:00:00.000Z");
  });

  it("starts the month on the 1st", () => {
    const now = Date.parse("2026-04-17T12:00:00Z");
    expect(new Date(windowStart("this_month", now, "UTC")).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones and rejects junk", () => {
    expect(isValidTimeZone("Europe/Amsterdam")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("'; DROP TABLE--")).toBe(false);
  });
});

describe("computeSpendingSummary", () => {
  const now = Date.parse("2026-04-17T12:00:00Z");

  it("counts only OUTGOING, non-declined transactions", () => {
    const summary = computeSpendingSummary(
      [
        tx({ timestamp: "2026-04-17T09:00:00Z", amountUsd: 20 }),
        tx({ timestamp: "2026-04-17T10:00:00Z", amountUsd: 5, direction: "in" }),
        tx({ timestamp: "2026-04-17T11:00:00Z", amountUsd: 99, status: "declined" }),
      ],
      "today",
      now,
      "UTC"
    );
    expect(summary.totalUsd).toBe(20);
    expect(summary.transactionCount).toBe(1);
  });

  it("excludes transactions before the window and in the future", () => {
    const summary = computeSpendingSummary(
      [
        tx({ timestamp: "2026-04-16T23:59:00Z", amountUsd: 50 }), // yesterday
        tx({ timestamp: "2026-04-17T00:00:00Z", amountUsd: 7 }), // window edge, inclusive
        tx({ timestamp: "2026-04-17T18:00:00Z", amountUsd: 60 }), // after `now`
      ],
      "today",
      now,
      "UTC"
    );
    expect(summary.totalUsd).toBe(7);
  });

  it("picks the category with the largest total", () => {
    const summary = computeSpendingSummary(
      [
        tx({ timestamp: "2026-04-17T01:00:00Z", amountUsd: 10, category: "shopping" as TxCategory }),
        tx({ timestamp: "2026-04-17T02:00:00Z", amountUsd: 30, category: "travel" as TxCategory }),
        tx({ timestamp: "2026-04-17T03:00:00Z", amountUsd: 15, category: "shopping" as TxCategory }),
      ],
      "today",
      now,
      "UTC"
    );
    // shopping totals 25 across two transactions; travel is 30 in one.
    expect(summary.topCategory).toBe("travel");
    expect(summary.byCategory).toEqual({ shopping: 25, travel: 30 });
  });

  it("ignores a malformed timestamp instead of counting it at epoch 0", () => {
    const summary = computeSpendingSummary(
      [tx({ timestamp: "not-a-date", amountUsd: 500 })],
      "this_month",
      now,
      "UTC"
    );
    expect(summary.transactionCount).toBe(0);
  });

  it("returns a zeroed summary with no budget when there is nothing to report", () => {
    const summary = computeSpendingSummary([], "today", now, "UTC");
    expect(summary.totalUsd).toBe(0);
    expect(summary.transactionCount).toBe(0);
    expect(summary.topCategory).toBeNull();
    expect(summary.budgetUsd).toBeNull();
  });
});
