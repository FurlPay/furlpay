import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// The row maths, with the network replaced.
//
// The bug this guards is the one already documented on instrumentQuote's RANGE
// constant and hit a second time in the Discord price cards: reading a
// "previous close" that belongs to the start of the requested window turns a
// monthly return into a daily one. Gold posted "+9.62% (24h)" that way. Here
// the prior close is the second-to-last observation of the series, so the
// window cannot corrupt it — and this test is what keeps it that way.
// ---------------------------------------------------------------------------

const canned = new Map<string, unknown>();
vi.mock("../providers/cache", () => ({
  TTL: { quote: 60 },
  BROWSER_UA: {},
  cachedJson: async (key: string) => canned.get(key) ?? null,
}));

const { instrumentRows, TABLE_INSTRUMENTS, instrumentCategory } = await import("../instrumentRows");
const { INSTRUMENTS } = await import("../instruments");

const put = (providerSymbol: string, closes: number[], price: number | null, volume: number | null) =>
  canned.set(`instrow:v1:${providerSymbol}`, { closes, price, volume });

const rowFor = async (symbol: string) => (await instrumentRows(0)).find((r) => r.symbol === symbol)!;

describe("which instruments become rows", () => {
  it("takes commodities and FX, and leaves the indices out", () => {
    // The indices already run across the top of /markets in MarketOverview.
    // Listing the S&P 500 beneath Apple invites comparing a level to a price.
    const symbols = TABLE_INSTRUMENTS.map((i) => i.symbol);
    expect(symbols).toContain("XAUUSD");
    expect(symbols).toContain("EURUSD");
    expect(symbols).not.toContain("SPX");
    expect(symbols).not.toContain("US10Y");
  });

  it("covers every commodity and FX pair that exists", () => {
    const expected = INSTRUMENTS.filter((i) => i.assetClass === "commodity" || i.assetClass === "fx");
    expect(TABLE_INSTRUMENTS).toHaveLength(expected.length);
  });
});

describe("deriving the change columns", () => {
  it("computes the daily change from the previous close, not the window's first", () => {
    canned.clear();
    // Twenty-two sessions climbing from 100 to 121. A window-based previous
    // close would report +21%; the real day move is +1 from 120.
    const closes = Array.from({ length: 22 }, (_, i) => 100 + i);
    put("GC=F", closes, 121, 1000);
    return rowFor("XAUUSD").then((row) => {
      expect(row.changePct).toBeCloseTo((1 / 120) * 100, 9);
      expect(row.changePct).toBeLessThan(2);
    });
  });

  it("measures seven days as five trading sessions back", () => {
    canned.clear();
    const closes = [10, 20, 30, 40, 50, 60, 70];
    put("GC=F", closes, 70, 1);
    return rowFor("XAUUSD").then((row) => {
      // Five sessions back from the last observation is 20, not 10.
      expect(row.changePct7d).toBeCloseTo(((70 - 20) / 20) * 100, 9);
    });
  });

  it("leaves the seven-day column null when the series is too short to answer", () => {
    canned.clear();
    put("GC=F", [100, 101], 101, 1);
    return rowFor("XAUUSD").then((row) => {
      expect(row.changePct7d).toBeNull();
      expect(row.changePct).toBeCloseTo((1 / 100) * 100, 9);
    });
  });

  it("never divides by a zero prior close", () => {
    canned.clear();
    put("GC=F", [0, 50], 50, 1);
    return rowFor("XAUUSD").then((row) => {
      expect(row.changePct).toBeNull();
    });
  });
});

describe("columns that do not apply", () => {
  it("reports no volume for an FX pair, as null and not zero", () => {
    canned.clear();
    // The provider does return a 0 here. A 0 in a volume column reads as
    // "nothing traded today", which of the euro is a remarkable claim.
    put("EURUSD=X", [1.1, 1.2], 1.2, 0);
    return rowFor("EURUSD").then((row) => {
      expect(row.volume24h).toBeNull();
    });
  });

  it("keeps volume for a commodity, which does have one", () => {
    canned.clear();
    put("GC=F", [100, 101], 101, 4321);
    return rowFor("XAUUSD").then((row) => {
      expect(row.volume24h).toBe(4321);
    });
  });

  it("gives nothing a market cap", () => {
    canned.clear();
    put("GC=F", [100, 101], 101, 1);
    return instrumentRows(0).then((rows) => {
      for (const r of rows) expect(r.marketCap).toBeNull();
    });
  });
});

describe("when the provider does not answer", () => {
  it("still emits the row, with every number absent", () => {
    canned.clear(); // nothing cached: every fetch returns null
    return rowFor("XAUUSD").then((row) => {
      expect(row.symbol).toBe("XAUUSD");
      expect(row.price).toBeNull();
      expect(row.changePct).toBeNull();
      expect(row.spark).toBeNull();
      expect(row.live).toBe(false);
    });
  });

  it("does not let one dead symbol remove the others", () => {
    canned.clear();
    put("GC=F", [100, 101], 101, 1);
    return instrumentRows(0).then((rows) => {
      expect(rows).toHaveLength(TABLE_INSTRUMENTS.length);
      expect(rows.find((r) => r.symbol === "XAUUSD")!.price).toBe(101);
    });
  });
});

describe("categorising", () => {
  it("names each class rather than reusing the equity sector column", () => {
    const of = (s: string) => instrumentCategory(INSTRUMENTS.find((i) => i.symbol === s)!);
    expect(of("XAUUSD")).toBe("Precious metal");
    expect(of("XAGUSD")).toBe("Precious metal");
    expect(of("COPPERUSD")).toBe("Industrial metal");
    expect(of("WTIUSD")).toBe("Energy");
    expect(of("NATGASUSD")).toBe("Energy");
    expect(of("EURUSD")).toBe("Currency pair");
  });

  it("marks every row as an instrument, so the table can tab them apart", () => {
    canned.clear();
    return instrumentRows(0).then((rows) => {
      for (const r of rows) expect(r.kind).toBe("instrument");
    });
  });

  it("ranks them after the catalog it is given the length of", () => {
    canned.clear();
    return instrumentRows(500).then((rows) => {
      expect(Math.min(...rows.map((r) => r.rank))).toBe(500);
      expect(new Set(rows.map((r) => r.rank)).size).toBe(rows.length);
    });
  });
});
