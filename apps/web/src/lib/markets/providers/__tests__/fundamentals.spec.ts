import { describe, expect, it } from "vitest";
import { __test as sec, type CompanyFacts, type XbrlFact } from "../sec";
import { __test as agg } from "../index";

const {
  mergeConcept,
  trailingTwelveMonths,
  latestInstant,
  isRecent,
  preferFact,
  reconcileEps,
} = sec;

/** A fixed clock, so these tests assert on the staleness rule rather than on
 * how long ago the file was written. Every fixture date below is relative to
 * this instant. */
const NOW = Date.parse("2026-08-21T00:00:00Z");
const { combine, ratio, pct, marginPct } = agg;

/** Minimal CompanyFacts fixture.
 *
 * Built against the real `CompanyFacts`/`XbrlFact` types rather than cast
 * through `any`. The cast was load-bearing only because the fixture rows were
 * typed `Record<string, unknown>`, which no amount of asserting makes into an
 * XbrlFact — so a fixture missing `end` or `filed` type-checked fine and only
 * failed inside the function under test. */
function factsOf(
  concepts: Record<string, XbrlFact[]>,
  unit = "USD"
): CompanyFacts {
  const bucket: CompanyFacts["facts"][string] = {};
  for (const [name, rows] of Object.entries(concepts)) bucket[name] = { units: { [unit]: rows } };
  return { entityName: "Test Co", facts: { "us-gaap": bucket } };
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

// ---------------------------------------------------------------------------
// Staleness. Both bugs pinned here shipped, rendered without complaint, and
// were only visible by comparing the page against the filing itself.
// ---------------------------------------------------------------------------

describe("staleness", () => {
  it("refuses to build a TTM out of quarters that stopped years ago", () => {
    // The JPMorgan case. Quarterly `Revenues` tagging stopped in 2015, so the
    // last four quarters available are calendar 2014 — contiguous, spanning a
    // clean 365 days, and passing every structural check. The page reported
    // $95B of revenue for a bank then earning $182B, dated to the present.
    const rows = [
      q("2014-01-01", "2014-03-31", 24, "2014-04-30"),
      q("2014-04-01", "2014-06-30", 24, "2014-07-30"),
      q("2014-07-01", "2014-09-30", 23, "2014-10-30"),
      q("2014-10-01", "2014-12-31", 24, "2015-02-24"),
      q("2025-01-01", "2025-12-31", 182, "2026-02-13"),
    ];
    const r = trailingTwelveMonths(rows, NOW)!;
    expect(r.basis).toBe("annual");
    expect(r.value).toBe(182);
    expect(r.asOf).toBe("2025-12-31");
  });

  it("still derives a current TTM from quarters older than the horizon", () => {
    // The counterpart, and the reason recency is checked on the assembled
    // window rather than on its inputs. A trailing year that ends today
    // necessarily reaches back twelve months, and Apple's fourth quarter is
    // reconstructed from quarters up to twenty months old. Filtering the
    // inputs dropped Apple from a $467B TTM to a $416B fiscal year.
    const rows = [
      q("2024-09-29", "2024-12-28", 124, "2025-01-30"), // ~600 days before NOW
      q("2024-12-29", "2025-03-29", 95, "2025-05-01"),
      q("2025-03-30", "2025-06-28", 94, "2025-07-31"),
      q("2024-09-29", "2025-09-27", 416, "2025-10-30"), // FY total
      q("2025-09-28", "2025-12-27", 140, "2026-01-29"),
      q("2025-12-28", "2026-03-28", 110, "2026-05-01"),
      q("2026-03-29", "2026-06-27", 113, "2026-07-31"),
    ];
    const r = trailingTwelveMonths(rows, NOW)!;
    expect(r.basis).toBe("ttm");
    expect(r.asOf).toBe("2026-06-27");
    // Derived Q4 FY25 = 416 - (124 + 95 + 94) = 103, plus the three newer ones.
    expect(r.value).toBe(103 + 140 + 110 + 113);
  });

  it("has no annual fallback once the last fiscal year is itself stale", () => {
    expect(trailingTwelveMonths([q("2019-01-01", "2019-12-31", 500)], NOW)).toBeNull();
  });

  it("drops a point-in-time fact the registrant stopped restating", () => {
    // The Berkshire case. `EntityCommonStockSharesOutstanding` was last tagged
    // undimensioned in 2011, at 941,481 Class A shares. Priced against Class B
    // that is a $470M market cap for a company worth about a trillion.
    const stale = { end: "2011-04-29", val: 941_481, filed: "2011-05-06" };
    expect(latestInstant([stale], NOW)).toBeNull();
    // A fresh count of the same concept is still used.
    const fresh = { end: "2026-06-30", val: 2_658_186_195, filed: "2026-08-06" };
    expect(latestInstant([stale, fresh], NOW)!.val).toBe(2_658_186_195);
  });

  it("treats an unparseable period end as stale rather than current", () => {
    expect(isRecent("not-a-date", NOW)).toBe(false);
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

// ---------------------------------------------------------------------------
// Which of two facts covering the same period wins. Each case below is a real
// filer whose numbers this got wrong.
// ---------------------------------------------------------------------------

describe("preferFact", () => {
  const stmt = (val: number, filed: string, form = "10-K") => ({
    start: "2025-06-01",
    end: "2026-05-31",
    val,
    filed,
    form,
  });

  it("keeps the statement figure over a proxy that rescales it", () => {
    // FedEx tags fiscal 2026 net income as 4,433,000,000 in the 10-K and as
    // 4,433 in the pay-versus-performance table of the proxy — same concept,
    // same period, same USD unit, presented in millions. The proxy is filed
    // later, so "newest filing wins" reported FedEx as earning $4,433.
    const tenK = stmt(4_433_000_000, "2026-07-20", "10-K");
    const proxy = stmt(4_433, "2026-08-17", "DEF 14A");
    expect(preferFact(tenK, proxy, "restated").val).toBe(4_433_000_000);
    // Order of arrival must not change the answer.
    expect(preferFact(proxy, tenK, "restated").val).toBe(4_433_000_000);
  });

  it("still takes the later filing when both are statements", () => {
    const original = stmt(100, "2026-07-20", "10-Q");
    const restated = stmt(115, "2026-11-01", "10-Q");
    expect(preferFact(original, restated, "restated").val).toBe(115);
  });

  it("takes the broader revenue tag rather than the newer one", () => {
    // American Tower tags $0.94B of revenue from contracts with customers and
    // $10.64B of total revenues for 2025. Dividing company-wide operating
    // income by the first gave a 522% operating margin.
    const narrow = stmt(940_000_000, "2026-02-25");
    const broad = stmt(10_640_000_000, "2026-02-20");
    expect(preferFact(narrow, broad, "broadest").val).toBe(10_640_000_000);
    expect(preferFact(broad, narrow, "broadest").val).toBe(10_640_000_000);
  });

  it("does not let the broadest rule reach outside the statements", () => {
    // A rescaled proxy figure can be numerically larger. Form precedence is
    // checked first, so it still loses.
    const tenK = stmt(4_433_000_000, "2026-07-20", "10-K");
    const inflatedProxy = stmt(4_433_000_000_000, "2026-08-17", "DEF 14A");
    expect(preferFact(tenK, inflatedProxy, "broadest").val).toBe(4_433_000_000);
  });
});

describe("marginPct", () => {
  it("refuses a margin that exceeds the revenue it divides", () => {
    expect(marginPct(4_850_000_000, 940_000_000)).toBeNull();
  });

  it("keeps an ordinary margin", () => {
    expect(marginPct(50, 100)).toBe(50);
  });

  it("keeps a large loss, which is a real fact about a company", () => {
    expect(marginPct(-500, 100)).toBe(-500);
  });
});

// ---------------------------------------------------------------------------
// EPS reconciliation. Every case is a real filer whose P/E this got wrong.
// ---------------------------------------------------------------------------

describe("reconcileEps", () => {
  const period = (value: number, basis: "ttm" | "annual" = "ttm") => ({
    value,
    basis,
    asOf: "2026-06-30",
  });

  it("drops EPS summed across a stock split", () => {
    // Booking split during fiscal 2026. Its fiscal 2025 diluted EPS is $165.57
    // and its June 2026 quarter $2.53; summed, $167.96 against $5.404B of net
    // income on 751M shares — an implied $7.19. The P/E that survived was 1.25.
    expect(reconcileEps(period(167.96), period(5_404_000_000, "annual"), { value: 751_380_500 })).toBeNull();
  });

  it("drops a per-class EPS measured against an all-class share count", () => {
    // Carvana: $8.45 per Class A share, $1.407B of income, 740M diluted shares
    // across every class — an implied $1.90.
    expect(reconcileEps(period(8.45, "annual"), period(1_407_000_000), { value: 739_960_000 })).toBeNull();
  });

  it("keeps an EPS that agrees with income and shares", () => {
    // Apple: $8.71 against $128.93B on 14.594B shares, an implied $8.83.
    const eps = period(8.71);
    expect(reconcileEps(eps, period(128_930_000_000), { value: 14_594_180_000 })).toBe(eps);
  });

  it("tolerates an ordinary annual-against-TTM gap", () => {
    // A fiscal year of income against a trailing-twelve-month EPS is expected
    // to disagree. A 20% gap is not a defect and must survive.
    const eps = period(10, "ttm");
    expect(reconcileEps(eps, period(1_200_000_000, "annual"), { value: 100_000_000 })).toBe(eps);
  });

  it("catches a loss-making company on the wrong share basis", () => {
    // Signs must not let a mismatch through: the comparison is on magnitude.
    expect(reconcileEps(period(-13.64), period(-3_855_643_000), { value: 3_940_701_760 })).toBeNull();
  });

  it("passes EPS through when there is nothing to check it against", () => {
    const eps = period(5);
    expect(reconcileEps(eps, null, { value: 1000 })).toBe(eps);
    expect(reconcileEps(eps, period(5000), null)).toBe(eps);
    expect(reconcileEps(null, period(5000), { value: 1000 })).toBeNull();
  });

  it("does not divide by a zero share count", () => {
    const eps = period(5);
    expect(reconcileEps(eps, period(5000), { value: 0 })).toBe(eps);
  });
});

describe("equity concept migration", () => {
  // Qualcomm last tagged StockholdersEquity in 2019 and has reported the
  // NCI-inclusive concept every quarter since. Reading one concept returned
  // nothing inside the staleness window, so price/book, ROE and debt/equity all
  // rendered as em-dashes for a company that publishes equity four times a year.
  const instant = (end: string, val: number, filed: string) => ({ end, val, filed });

  const migrated = factsOf({
    StockholdersEquity: [instant("2019-09-29", 4_909_000_000, "2019-11-06")],
    StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: [
      instant("2026-06-28", 27_658_000_000, "2026-07-29"),
    ],
  });

  it("rejects the abandoned concept rather than reporting a seven-year-old equity", () => {
    const stale = latestInstant(mergeConcept(migrated, ["StockholdersEquity"], "USD"), NOW);

    expect(stale).toBeNull();
  });

  it("finds current equity under the concept the filer actually uses", () => {
    const current = latestInstant(
      mergeConcept(
        migrated,
        ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
        "USD"
      ),
      NOW
    );

    expect(current?.val).toBe(27_658_000_000);
  });

  it("prefers parent-only equity when the filer still tags it", () => {
    // Both current: the source order has to decide, not whichever was filed
    // later. Net income is attributable to the parent, so ROE needs the parent
    // denominator to match it.
    const both = factsOf({
      StockholdersEquity: [instant("2026-06-28", 20_000_000_000, "2026-07-29")],
      StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: [
        instant("2026-06-28", 27_658_000_000, "2026-07-30"),
      ],
    });

    const preferred = latestInstant(mergeConcept(both, ["StockholdersEquity"], "USD"), NOW);
    expect(preferred?.val).toBe(20_000_000_000);
  });
});

describe("gross profit derived from cost of revenue", () => {
  // GrossProfit is optional in US-GAAP and Qualcomm never tags it, while
  // CostOfRevenue sits directly under revenue on the income statement.
  const revenueRows = [
    // Q4 of the prior fiscal year: no 10-Q carries it, so it comes off the 10-K.
    q("2025-06-30", "2025-09-28", 11_271_000_000, "2025-11-05"),
    q("2025-09-29", "2025-12-28", 12_252_000_000, "2026-02-04"),
    q("2025-12-29", "2026-03-29", 10_599_000_000, "2026-04-29"),
    q("2026-03-30", "2026-06-28", 9_947_000_000, "2026-07-29"),
  ];
  const costRows = [
    q("2025-06-30", "2025-09-28", 5_002_000_000, "2025-11-05"),
    q("2025-09-29", "2025-12-28", 5_568_000_000, "2026-02-04"),
    q("2025-12-29", "2026-03-29", 4_900_000_000, "2026-04-29"),
    q("2026-03-30", "2026-06-28", 4_670_000_000, "2026-07-29"),
  ];

  it("lines both trailing windows up on the same period end", () => {
    const rev = trailingTwelveMonths(mergeConcept(factsOf({ Revenues: revenueRows }), ["Revenues"], "USD"), NOW);
    const cost = trailingTwelveMonths(
      mergeConcept(factsOf({ CostOfRevenue: costRows }), ["CostOfRevenue"], "USD"),
      NOW
    );

    // The subtraction is only valid when both describe the same span; the
    // provider refuses to derive a margin when they do not.
    expect(rev?.asOf).toBe(cost?.asOf);
    expect(rev?.basis).toBe(cost?.basis);
  });

  it("produces a margin in the range the filing states", () => {
    const rev = trailingTwelveMonths(mergeConcept(factsOf({ Revenues: revenueRows }), ["Revenues"], "USD"), NOW);
    const cost = trailingTwelveMonths(
      mergeConcept(factsOf({ CostOfRevenue: costRows }), ["CostOfRevenue"], "USD"),
      NOW
    );
    const margin = marginPct(rev!.value - cost!.value, rev!.value);

    expect(margin).toBeGreaterThan(50);
    expect(margin).toBeLessThan(60);
  });
});
