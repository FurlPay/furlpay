import { describe, expect, it } from "vitest";
import { summarizeActivity, summarizeChains, type DailyRow } from "../stablecoinActivity";

// Shape and magnitudes from the user's Allium run of the saved query
// LQ50l60RW267fBrQ8DoJ (stablecoins.metrics.volume_daily, 2026-10-07):
// latest COMPLETE day was Oct 5; Oct 6 not yet aggregated (absent/zero).
const B = 1e9, M = 1e6;
const day = (d: string, tx: number, transfers: number, vol: number, s: number, r: number): DailyRow => ({
  day: d, tx_count: tx * M, transfer_count: transfers * M, volume_usd: vol * B, sender_count: s * M, recipient_count: r * M,
});
const week: DailyRow[] = [
  day("2026-09-29", 35.2, 81.3, 219.7, 5.54, 8.99),
  day("2026-09-30", 35.2, 82.4, 287.5, 5.65, 9.27),
  day("2026-10-01", 33.4, 78.2, 235.4, 5.46, 9.04),
  day("2026-10-02", 35.7, 83.6, 246.1, 5.42, 9.11),
  day("2026-10-03", 26.6, 65.9, 180.9, 4.67, 8.18),
  day("2026-10-04", 26.7, 66.6, 196.4, 4.48, 8.09),
  day("2026-10-05", 30.8, 73.0, 226.9, 5.28, 8.99),
];

describe("summarizeActivity", () => {
  it("takes the latest day WITH transactions; an unaggregated day (zeros) is not 'no activity'", () => {
    const a = summarizeActivity([...week, day("2026-10-06", 0, 0, 0, 0, 0)], "2026-10-07T02:12:13Z");
    expect(a.latest?.day).toBe("2026-10-05");
    expect(a.days).toHaveLength(7);
  });

  it("flags the latest day provisional only when the run came < 24h after it ended", () => {
    expect(summarizeActivity(week, "2026-10-07T02:12:13Z").latestProvisional).toBe(false); // Oct 5 ended 26h before
    expect(summarizeActivity(week, "2026-10-06T08:00:00Z").latestProvisional).toBe(true); // 8h after Oct 5 ended
    expect(summarizeActivity(week, null).latestProvisional).toBe(false);
  });

  it("compares the latest day with the average of the prior days (up to 7), not just the previous day", () => {
    const a = summarizeActivity(week, "2026-10-07T02:12:13Z");
    const priorVol = (219.7 + 287.5 + 235.4 + 246.1 + 180.9 + 196.4) / 6;
    expect(a.prior7dAvg?.days).toBe(6);
    expect(a.prior7dAvg!.volumeUsd / B).toBeCloseTo(priorVol, 6);
    expect(a.change.volumeUsd!).toBeCloseTo(226.9 / priorVol - 1, 9);
    expect(a.windowTotals.days).toBe(7);
    expect(a.windowTotals.volumeUsd / B).toBeCloseTo(1592.9, 6); // the run's "$1.59T over 7 days"
  });

  it("derives average transfer size from volume / transfers", () => {
    const a = summarizeActivity(week, null);
    expect(a.latest!.avgTransferUsd!).toBeCloseTo((226.9 * B) / (73.0 * M), 6);
  });

  it("sums per-chain rows into one day (the contract holds for per-day or per-chain output)", () => {
    const a = summarizeActivity([day("2026-10-05", 10, 20, 100, 1, 2), day("2026-10-05", 5, 6, 50, 1, 1)], null);
    expect(a.latest).toMatchObject({ txCount: 15 * M, volumeUsd: 150 * B });
  });

  it("reports no change without a prior day, and nothing at all for an empty result", () => {
    expect(summarizeActivity([week[6]], null).change).toEqual({ volumeUsd: null, txCount: null, avgTransferUsd: null });
    const empty = summarizeActivity([], null);
    expect(empty.latest).toBeNull();
    expect(empty.prior7dAvg).toBeNull();
  });
});

describe("summarizeChains", () => {
  // The run's Oct 5 by-chain figures.
  const rows = [
    { chain: "base", volume_usd_latest_day: 70.2 * B, volume_usd_prior_7d_avg: 82.6 * B, tx_count_latest_day: 2.6 * M },
    { chain: "ethereum", volume_usd_latest_day: 55.6 * B, volume_usd_prior_7d_avg: 45.95 * B },
    { chain: "gnosis", volume_usd_latest_day: 14.0 * B, volume_usd_prior_7d_avg: 19.7 * B, tx_count_latest_day: null },
    { chain: "dead", volume_usd_latest_day: 0, volume_usd_prior_7d_avg: 0 },
  ];
  it("ranks by latest-day volume with change vs the 7-day average and share of the day", () => {
    const c = summarizeChains(rows);
    expect(c.map((x) => x.chain)).toEqual(["base", "ethereum", "gnosis"]);
    expect(c[0].change!).toBeCloseTo(70.2 / 82.6 - 1, 9); // about -15%, as the run reported
    expect(c[1].change!).toBeCloseTo(0.21, 2);
    expect(c[2].change!).toBeCloseTo(-0.29, 2);
    expect(c[0].txCount).toBe(2.6 * M);
    expect(c[1].txCount).toBeNull();
    expect(c.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 9);
  });
});
