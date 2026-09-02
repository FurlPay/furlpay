import { describe, it, expect } from "vitest";
import { CATALOG, bySymbol, byKindSymbol, AMBIGUOUS_TICKERS } from "../catalog";
import universe from "../universe.json";

// ---------------------------------------------------------------------------
// Coverage for the institutionally-held names, and the traps that come with
// them.
//
// These symbols were added after checking JPMorgan's actual Q2 2026 13F-HR
// (CIK 0000019617, accession 0000019617-26-000325, period 2026-06-30) rather
// than a summary of it. The filing is the reason the list looks the way it
// does; it is not itself reproduced here, because a 13F is a quarterly
// snapshot and baking its dollar values into source would be stale within
// weeks and unverifiable forever.
//
// What IS pinned here is the part that must not drift: that each symbol exists,
// is tradable, is the right kind, and -- for the two coin/ETF collisions --
// that a bare ticker still means what a person ordering it means.
// ---------------------------------------------------------------------------

const TRADABLE = new Set(
  (universe as { assets: { symbol: string }[] }).assets.map((a) => a.symbol)
);

/** Symbol -> expected kind. */
const ADDED = {
  GOOG: "stock",
  MSTR: "stock",
  IREN: "stock",
  RIOT: "stock",
  CIFR: "stock",
  MARA: "stock",
  CLSK: "stock",
  GBTC: "etf",
  BSOL: "etf",
  JEPI: "etf",
  JEPQ: "etf",
} as const;

describe("institutional coverage", () => {
  for (const [symbol, kind] of Object.entries(ADDED)) {
    it(`${symbol} is catalogued as a ${kind} and is tradable`, () => {
      const a = bySymbol.get(symbol);
      expect(a, `${symbol} missing from catalog`).toBeDefined();
      expect(a!.kind).toBe(kind);
      // A catalogued symbol the broker cannot fill renders a Trade button that
      // dead-ends, which reads as a broken app rather than a data gap.
      expect(TRADABLE.has(symbol), `${symbol} not in tradable universe`).toBe(true);
    });
  }

  it("adds no new bare-ticker collisions", () => {
    // STX (Seagate/Stacks) and DASH (DoorDash/Dash) are the known pair. A new
    // name landing here means two assets now answer to one ticker, and the
    // loser becomes unreachable by symbol.
    expect([...AMBIGUOUS_TICKERS].sort()).toEqual(["DASH", "STX"]);
  });
});

describe("coin tickers that are also ETF tickers", () => {
  // The Grayscale Bitcoin Mini Trust lists as BTC and the Bitwise XRP ETF as
  // XRP. Both are real, tradable, and deliberately absent from the catalog.
  //
  // bySymbol resolves a bare ticker towards the security, and it is what
  // /api/investing/order books against. Adding either ETF would silently turn
  // "buy BTC" into a Grayscale share purchase. This test is the tripwire: it
  // fails the moment someone adds the row, which is the point at which that
  // tradeoff needs a human decision rather than a merge.
  for (const t of ["BTC", "XRP"] as const) {
    it(`${t} still resolves to the coin, not an ETF`, () => {
      expect(bySymbol.get(t)?.kind).toBe("crypto");
      expect(byKindSymbol.has(`etf:${t}`)).toBe(false);
    });
  }

  it("the ETFs are genuinely tradable, so this is a real choice and not an oversight", () => {
    expect(TRADABLE.has("BTC")).toBe(true);
    expect(TRADABLE.has("XRP")).toBe(true);
  });
});

describe("cap tiers reflect measured size", () => {
  // Tiers drive heatmap block size and the market-cap screen, so an inflated
  // one produces a wrong screen. These were computed from live price times
  // shares outstanding in each issuer's own SEC filing; the assertions below
  // are the coarse buckets those numbers fell into, not opinions about the
  // companies.
  const EXPECTED: Record<string, string> = {
    GOOG: "mega",   // ~$4.1T
    MSTR: "large",  // ~$42.9B
    IREN: "large",  // ~$13.2B
    RIOT: "mid",    // ~$6.7B
    CIFR: "mid",    // ~$6.1B
    MARA: "mid",    // ~$4.0B
    CLSK: "mid",    // ~$2.8B
  };
  for (const [symbol, cap] of Object.entries(EXPECTED)) {
    it(`${symbol} is ${cap}`, () => {
      expect(CATALOG.find((a) => a.symbol === symbol && a.kind === "stock")?.cap).toBe(cap);
    });
  }
});
