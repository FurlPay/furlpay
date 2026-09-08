import { describe, it, expect } from "vitest";
import {
  applyFilters,
  defaultDirFor,
  isCapBand,
  isSortKey,
  paginate,
  sortRows,
  type TableRow,
} from "../table";
import { pageWindow } from "../pageWindow";

// ---------------------------------------------------------------------------
// The markets table's filtering, sorting and pagination.
//
// Every test here is about the SAME hazard from a different angle: a missing
// number is not a zero. `null >= 0` is true in JavaScript, `null` sorts as 0
// under a naive comparator, and both mistakes put a confident, wrong figure in
// front of someone sizing a position. The suite exists to make either one fail
// loudly.
// ---------------------------------------------------------------------------

function row(partial: Partial<TableRow> & { symbol: string }): TableRow {
  return {
    name: `${partial.symbol} Inc.`,
    kind: "stock",
    category: "Technology",
    logo: null,
    price: 100,
    changePct: 1,
    changePct7d: 2,
    marketCap: 50e9,
    volume24h: 1e6,
    spark: null,
    live: true,
    rank: 0,
    ...partial,
  };
}

describe("applyFilters", () => {
  const rows = [
    row({ symbol: "AAA", kind: "stock", price: 10, changePct: 5, marketCap: 50e9, volume24h: 5e6, rank: 0 }),
    row({ symbol: "BBB", kind: "crypto", price: 200, changePct: -3, marketCap: 5e9, volume24h: 1e6, rank: 1 }),
    row({ symbol: "CCC", kind: "etf", price: 50, changePct: 0.5, marketCap: null, volume24h: null, rank: 2 }),
  ];

  it("filters by asset kind", () => {
    expect(applyFilters(rows, { kinds: ["crypto"] }).map((r) => r.symbol)).toEqual(["BBB"]);
    expect(applyFilters(rows, { kinds: ["stock", "etf"] }).map((r) => r.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("splits gainers from losers strictly, never counting a flat or unknown row", () => {
    expect(applyFilters(rows, { performance: "gainers" }).map((r) => r.symbol)).toEqual(["AAA", "CCC"]);
    expect(applyFilters(rows, { performance: "losers" }).map((r) => r.symbol)).toEqual(["BBB"]);

    // The whole point: an unpriced row is not a gainer. `null >= 0` is true in
    // JS, so a naive check would render it green with a fabricated move.
    const unknown = [row({ symbol: "ZZZ", changePct: null })];
    expect(applyFilters(unknown, { performance: "gainers" })).toEqual([]);
    expect(applyFilters(unknown, { performance: "losers" })).toEqual([]);
  });

  it("EXCLUDES rows whose value is unknown rather than treating them as matches", () => {
    // CCC has no market cap. It cannot be said to be a small cap.
    expect(applyFilters(rows, { capBands: ["small"] }).map((r) => r.symbol)).toEqual([]);
    expect(applyFilters(rows, { capBands: ["mid"] }).map((r) => r.symbol)).toEqual(["BBB"]);
    expect(applyFilters(rows, { capBands: ["large"] }).map((r) => r.symbol)).toEqual(["AAA"]);

    // Same rule for a numeric bound: unknown volume does not satisfy "over 0".
    expect(applyFilters(rows, { volumeMin: 0 }).map((r) => r.symbol)).toEqual(["AAA", "BBB"]);
  });

  it("applies price and volume bounds inclusively", () => {
    expect(applyFilters(rows, { priceMin: 50 }).map((r) => r.symbol)).toEqual(["BBB", "CCC"]);
    expect(applyFilters(rows, { priceMax: 50 }).map((r) => r.symbol)).toEqual(["AAA", "CCC"]);
    expect(applyFilters(rows, { priceMin: 10, priceMax: 50 }).map((r) => r.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("searches symbol, name and category case-insensitively", () => {
    expect(applyFilters(rows, { query: "bbb" }).map((r) => r.symbol)).toEqual(["BBB"]);
    expect(applyFilters(rows, { query: "technology" })).toHaveLength(3);
    expect(applyFilters(rows, { query: "nothing here" })).toEqual([]);
  });

  it("restricts to an explicit symbol set, case-insensitively", () => {
    expect(applyFilters(rows, { symbols: ["aaa", "ccc"] }).map((r) => r.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("intersects every filter rather than unioning them", () => {
    const out = applyFilters(rows, { kinds: ["stock", "crypto"], performance: "gainers" });
    expect(out.map((r) => r.symbol)).toEqual(["AAA"]);
  });
});

describe("sortRows", () => {
  const rows = [
    row({ symbol: "LOW", marketCap: 1e9, changePct: -2, rank: 0 }),
    row({ symbol: "HIGH", marketCap: 900e9, changePct: 9, rank: 1 }),
    row({ symbol: "NONE", marketCap: null, changePct: null, rank: 2 }),
    row({ symbol: "MID", marketCap: 40e9, changePct: 3, rank: 3 }),
  ];

  it("sinks unknown values to the bottom in BOTH directions", () => {
    // Descending: obvious. Ascending is the one that matters — with `?? 0`,
    // NONE would open the list, presenting an unknown market cap as the
    // smallest company on the page.
    expect(sortRows(rows, "marketCap", "desc").map((r) => r.symbol)).toEqual(["HIGH", "MID", "LOW", "NONE"]);
    expect(sortRows(rows, "marketCap", "asc").map((r) => r.symbol)).toEqual(["LOW", "MID", "HIGH", "NONE"]);
  });

  it("breaks ties on curated rank, so the order is stable between renders", () => {
    const tied = [
      row({ symbol: "B", changePct: 5, rank: 5 }),
      row({ symbol: "A", changePct: 5, rank: 1 }),
    ];
    expect(sortRows(tied, "change", "desc").map((r) => r.symbol)).toEqual(["A", "B"]);
  });

  it("sorts by NAME for the name key, not by ticker", () => {
    // The distinction the old test could not make: its helper set
    // name = `${symbol} Inc.`, so name order and ticker order were identical
    // and sorting by either passed. Real names diverge from their tickers.
    const named = [
      row({ symbol: "AAPL", name: "Apple Inc." }),
      row({ symbol: "GOOGL", name: "Alphabet Inc." }),
      row({ symbol: "MSFT", name: "Microsoft Corp." }),
    ];
    expect(sortRows(named, "name", "asc").map((r) => r.symbol)).toEqual(["GOOGL", "AAPL", "MSFT"]);
    expect(sortRows(named, "name", "desc").map((r) => r.symbol)).toEqual(["MSFT", "AAPL", "GOOGL"]);
  });

  it("breaks a name tie on ticker, so the order is stable", () => {
    const tied = [
      row({ symbol: "ZZZ", name: "Same Name" }),
      row({ symbol: "AAA", name: "Same Name" }),
    ];
    expect(sortRows(tied, "name", "asc").map((r) => r.symbol)).toEqual(["AAA", "ZZZ"]);
  });

  it("does not mutate the input array", () => {
    const original = [...rows];
    sortRows(rows, "change", "desc");
    expect(rows).toEqual(original);
  });

  it("gives each sort key the direction a reader means by it", () => {
    expect(defaultDirFor("marketCap")).toBe("desc");
    expect(defaultDirFor("change")).toBe("desc");
    expect(defaultDirFor("name")).toBe("asc");
    expect(defaultDirFor("popularity")).toBe("asc");
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 47 }, (_, i) => i + 1);

  it("derives page count from the real total", () => {
    expect(paginate(items, 1, 25).pageCount).toBe(2);
    expect(paginate(items, 1, 10).pageCount).toBe(5);
    expect(paginate([], 1, 25).pageCount).toBe(1);
  });

  it("slices the requested page", () => {
    expect(paginate(items, 2, 25).items).toEqual(items.slice(25));
    expect(paginate(items, 1, 25).items).toHaveLength(25);
  });

  it("clamps an out-of-range page instead of rendering an empty table", () => {
    // An empty table after a filter change reads as a failed load, not as
    // "you are past the end".
    const p = paginate(items, 99, 25);
    expect(p.page).toBe(2);
    expect(p.items).toHaveLength(22);

    expect(paginate(items, 0, 25).page).toBe(1);
    expect(paginate(items, -5, 25).page).toBe(1);
  });
});

describe("windowed page numbers", () => {
  it("lists every page when they all fit", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("always keeps the first and last page reachable", () => {
    const out = pageWindow(50, 100);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(100);
    expect(out).toContain(50);
  });

  it("never uses an ellipsis to hide a single page", () => {
    // "1 … 3" is longer than "1 2 3" and conceals nothing.
    const out = pageWindow(3, 20);
    expect(out.slice(0, 4)).toEqual([1, 2, 3, 4]);
  });
});

describe("query-parameter guards", () => {
  it("accepts only known sort keys", () => {
    expect(isSortKey("marketCap")).toBe(true);
    expect(isSortKey("price")).toBe(true);
    expect(isSortKey("../etc/passwd")).toBe(false);
    expect(isSortKey(null)).toBe(false);
    expect(isSortKey("")).toBe(false);
  });

  it("accepts only known cap bands", () => {
    expect(isCapBand("large")).toBe(true);
    expect(isCapBand("huge")).toBe(false);
    expect(isCapBand(undefined)).toBe(false);
  });
});
