import { describe, expect, it } from "vitest";
import { __test as sec } from "../sec";
import { __test as agg } from "../index";

const { mergeConcept, trailingTwelveMonths } = sec;
const { combine, ratio, pct } = agg;

/** Minimal CompanyFacts shape. */
function factsOf(
  concepts: Record<string, Array<Record<string, unknown>>>,
  unit = "USD"
) {
  const bucket: Record<string, { units: Record<string, unknown[]> }> = {};
  for (const [name, rows] of Object.entries(concepts)) bucket[name] = { units: { [unit]: rows } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { entityName: "Test Co", facts: { "us-gaap": bucket } } as any;
}

const q = (start: string, end: string, val: number, filed = "2026-01-01") => ({
  start,
  end,
  val,
  filed,
});

describe("mergeConcept", () => {
  it("merges synonyms instead of stopping at the first one that exists", () => {
    // The NVIDIA case: an older tag is still present but stops years ago, while
    // the current tag carries recent periods. First-match-wins returned the
    // stale one and reported 2020 revenue as current.
    const facts = factsOf({
      Revenues: [q("2019-01-01", "2019-03-31", 10)],
      RevenueFromContractWithCustomerExcludingAssessedTax: [q("2026-01-01", "2026-03-31", 900)],
    });
    const merged = mergeConcept(
      facts,
      ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"],
      "USD"
    );
    expect(merged).toHaveLength(2);
    expect(Math.max(...merged.map((f) => f.val))).toBe(900);
  });

  it("keeps the most recently filed value when a period is restated", () => {
    const facts = factsOf({
      Revenues: [
        q("2026-01-01", "2026-03-31", 100, "2026-04-30"),
        q("2026-01-01", "2026-03-31", 115, "2026-08-01"), // restatement
      ],
    });
    const merged = mergeConcept(facts, ["Revenues"], "USD");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.val).toBe(115);
  });
});

describe("trailingTwelveMonths", () => {
  it("sums four contiguous quarters", () => {
    const rows = [
      q("2025-07-01", "2025-09-30", 10),
      q("2025-10-01", "2025-12-31", 20),
      q("2026-01-01", "2026-03-31", 30),
      q("2026-04-01", "2026-06-30", 40),
    ];
    const r = trailingTwelveMonths(rows);
    expect(r).toEqual({ value: 100, basis: "ttm", asOf: "2026-06-30" });
  });

  it("ignores year-to-date and annual periods that overlap the quarters", () => {
    // A 10-Q carries the quarter AND the year-to-date. Summing both roughly
    // triples the result.
    const rows = [
      q("2025-07-01", "2025-09-30", 10),
      q("2025-10-01", "2025-12-31", 20),
      q("2026-01-01", "2026-03-31", 30),
      q("2026-04-01", "2026-06-30", 40),
      q("2025-07-01", "2026-03-31", 60), // YTD, overlaps three of the above
      q("2025-07-01", "2026-06-30", 100), // full year, overlaps all four
    ];
    expect(trailingTwelveMonths(rows)!.value).toBe(100);
  });

  it("derives the missing fourth quarter from the annual figure", () => {
    // Apple's shape: three 10-Qs and a 10-K, with no Q4 fact anywhere. Without
    // synthesis the fourth slot is filled by the same quarter a year earlier.
    const rows = [
      q("2025-09-29", "2025-12-27", 124),
      q("2025-12-28", "2026-03-28", 95),
      q("2026-03-29", "2026-06-27", 94),
      q("2025-09-29", "2026-09-26", 420), // FY total
    ];
    const r = trailingTwelveMonths(rows)!;
    expect(r.basis).toBe("ttm");
    expect(r.asOf).toBe("2026-09-26");
    // Derived Q4 = 420 - (124 + 95 + 94) = 107; TTM is the full year.
    expect(r.value).toBe(420);
  });

  it("falls back to annual, labelled, when the quarters do not span a year", () => {
    const rows = [
      q("2026-01-01", "2026-03-31", 30),
      q("2026-04-01", "2026-06-30", 40),
      q("2025-01-01", "2025-12-31", 200),
    ];
    const r = trailingTwelveMonths(rows)!;
    expect(r.basis).toBe("annual");
    expect(r.value).toBe(200);
  });

  it("refuses a non-contiguous window rather than calling it a TTM", () => {
    // Four quarters, but with a year-wide hole in the middle.
    const rows = [
      q("2024-01-01", "2024-03-31", 1),
      q("2024-04-01", "2024-06-30", 2),
      q("2026-01-01", "2026-03-31", 30),
      q("2026-04-01", "2026-06-30", 40),
      q("2025-01-01", "2025-12-31", 500),
    ];
    expect(trailingTwelveMonths(rows)!.basis).toBe("annual");
  });

  it("returns null when there is nothing to total", () => {
    expect(trailingTwelveMonths([])).toBeNull();
  });
});

describe("ratio guards", () => {
  it("has no P/E for a loss-making company", () => {
    // A negative denominator yields a negative "ratio" that renders and sorts
    // like a very cheap stock. Loss-makers have no P/E.
    expect(ratio(100, -5)).toBeNull();
  });

  it("has no ratio against zero", () => {
    expect(ratio(100, 0)).toBeNull();
  });

  it("propagates a missing input as missing, not as zero", () => {
    expect(ratio(null, 10)).toBeNull();
    expect(ratio(10, null)).toBeNull();
  });

  it("keeps a negative margin, which is a real fact", () => {
    expect(pct(-25, 100)).toBe(-25);
  });
});

describe("combine", () => {
  const quote = {
    symbol: "TEST",
    name: "Test Co",
    currency: "USD",
    exchange: "NasdaqGS",
    instrumentType: "EQUITY",
    price: 100,
    previousClose: 90,
    change: 10,
    changePct: 11.11,
    dayHigh: 101,
    dayLow: 89,
    high52w: 120,
    low52w: 60,
    volume: 1_000,
    marketTime: 1_787_256_001,
  };

  const fundamentals = {
    entityName: "Test Co",
    cik: "0000000001",
    epsTtm: 5,
    epsBasis: "ttm" as const,
    revenueTtm: 1_000,
    netIncomeTtm: 250,
    incomeBasis: "ttm" as const,
    grossProfitTtm: 600,
    operatingIncomeTtm: 300,
    operatingCashFlowTtm: 280,
    sharesOutstanding: 50,
    assets: 2_000,
    liabilities: 800,
    equity: 1_200,
    assetsCurrent: 500,
    liabilitiesCurrent: 250,
    cash: 300,
    dividendPerShareTtm: 2,
    asOf: "2026-06-30",
    balanceAsOf: "2026-06-30",
  };

  it("computes market cap from shares and price rather than a cap tier", () => {
    const s = combine(quote, fundamentals, 900);
    expect(s.marketCap).toBe(5_000); // 100 * 50
    expect(s.peRatio).toBe(20); // 100 / 5
    expect(s.profitMarginPct).toBe(25);
    expect(s.currentRatio).toBe(2);
    expect(s.dividendYieldPct).toBe(2);
    expect(s.payoutRatioPct).toBe(40);
    expect(s.enterpriseValue).toBe(5_500); // 5000 + 800 - 300
    expect(s.provenance).toMatchObject({ price: "yahoo", fundamentals: "sec-edgar" });
  });

  it("reports nulls, never zeros, when a provider gives nothing", () => {
    const s = combine(null, null, null);
    expect(s.price).toBeNull();
    expect(s.marketCap).toBeNull();
    expect(s.peRatio).toBeNull();
    expect(s.high52w).toBeNull();
    expect(s.provenance.price).toBeNull();
    expect(s.provenance.fundamentals).toBeNull();
  });

  it("still serves the price when only fundamentals are missing", () => {
    // ETFs and crypto have no EDGAR filings. The header must still render.
    const s = combine(quote, null, 900);
    expect(s.price).toBe(100);
    expect(s.high52w).toBe(120);
    expect(s.marketCap).toBeNull();
    expect(s.peRatio).toBeNull();
  });
});
