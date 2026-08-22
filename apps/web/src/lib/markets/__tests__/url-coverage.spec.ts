import { describe, expect, it } from "vitest";
import { CATALOG, bySymbol } from "../catalog";
import { UNIVERSE, resolveMergedAsset } from "../universe";
import { yahooSymbolFor } from "../providers";

// ---------------------------------------------------------------------------
// Which symbols have a page at /markets/<symbol>.
//
// The detail route resolved through `bySymbol` — the 391 hand-curated entries
// — while search ranks over all 12,970 tradable symbols. Searching "Alcoa"
// returned AA and following it produced "Asset not found". 12,655 symbols were
// reachable, linkable and dead, including S&P 500 members.
//
// These tests pin the coverage rather than the count. A number would have to be
// edited every time the universe is re-synced, and editing it is exactly how a
// regression gets waved through.
// ---------------------------------------------------------------------------

describe("/markets/<symbol> coverage", () => {
  it("resolves every tradable symbol, curated or not", () => {
    const unresolved = UNIVERSE.filter((u) => !resolveMergedAsset(u.symbol));
    expect(unresolved.map((u) => u.symbol)).toEqual([]);
  });

  it("resolves every curated symbol, including those the broker does not list", () => {
    // 74 catalog entries are absent from Alpaca's equity universe — the crypto
    // set, plus a few renamed or delisted tickers. They still have pages.
    const unresolved = CATALOG.filter((a) => !resolveMergedAsset(a.symbol));
    expect(unresolved.map((a) => a.symbol)).toEqual([]);
  });

  it("serves the specific names that used to 404", () => {
    // Agilent, Alcoa and Albemarle: S&P 500 members, tradable, uncurated.
    for (const sym of ["A", "AA", "ALB"]) {
      const a = resolveMergedAsset(sym);
      expect(a, sym).toBeTruthy();
      expect(a!.curated).toBe(false);
      expect(a!.name.length).toBeGreaterThan(0);
    }
  });

  it("keeps curated metadata where it exists", () => {
    const aapl = resolveMergedAsset("AAPL")!;
    expect(aapl.curated).toBe(true);
    expect(aapl.sector).toBe("Technology");
    expect(aapl.logo).not.toBe("");
  });

  it("resolves a bare ambiguous ticker to the security, not the token", () => {
    // STX is both Seagate and Stacks; DASH is both DoorDash and Dash. A bare
    // ticker on a finance surface means the listed security — and this map also
    // backs the order path, where the collision priced an equity order as
    // crypto.
    expect(resolveMergedAsset("STX")!.kind).toBe("stock");
    expect(resolveMergedAsset("STX")!.name).toMatch(/Seagate/i);
    expect(resolveMergedAsset("DASH")!.kind).toBe("stock");
    expect(resolveMergedAsset("DASH")!.name).toMatch(/DoorDash/i);
  });

  it("resolves coins that do not collide with a ticker", () => {
    const btc = resolveMergedAsset("BTC")!;
    expect(btc.kind).toBe("crypto");
    expect(btc.curated).toBe(true);
  });

  it("still refuses a symbol that is in neither list", () => {
    expect(resolveMergedAsset("NOTATICKER")).toBeUndefined();
    expect(resolveMergedAsset("")).toBeUndefined();
  });

  it("is case-insensitive, since URLs are typed by hand", () => {
    expect(resolveMergedAsset("aapl")?.symbol).toBe("AAPL");
    expect(resolveMergedAsset("aA")?.symbol).toBe("AA");
  });

  it("covers strictly more than the curated catalog it replaced", () => {
    const curatedOnly = new Set(bySymbol.keys());
    const resolvable = new Set(
      [...new Set([...CATALOG.map((a) => a.symbol), ...UNIVERSE.map((u) => u.symbol)])].filter((s) =>
        resolveMergedAsset(s)
      )
    );
    for (const s of curatedOnly) expect(resolvable.has(s), s).toBe(true);
    expect(resolvable.size).toBeGreaterThan(curatedOnly.size * 30);
  });
});

// ---------------------------------------------------------------------------
// Symbol spelling. Alpaca and Yahoo punctuate differently, and every mismatch
// is a silent 404 that renders as an asset with no price rather than an error.
// ---------------------------------------------------------------------------

describe("yahooSymbolFor", () => {
  it("quotes crypto as a USD pair", () => {
    expect(yahooSymbolFor("BTC", "crypto")).toBe("BTC-USD");
  });

  it("dashes a share class", () => {
    expect(yahooSymbolFor("BRK.B", "stock")).toBe("BRK-B");
    expect(yahooSymbolFor("BF.A", "stock")).toBe("BF-A");
  });

  it("rewrites a preferred series, which the generic rule gets wrong", () => {
    // ALL-PRB does not exist; the security Yahoo quotes is ALL-PB.
    expect(yahooSymbolFor("ALL.PRB", "stock")).toBe("ALL-PB");
    expect(yahooSymbolFor("WFC.PRZ", "stock")).toBe("WFC-PZ");
    expect(yahooSymbolFor("IIPR.PRA", "stock")).toBe("IIPR-PA");
  });

  it("handles a single-series preferred with no letter", () => {
    expect(yahooSymbolFor("XYZ.PR", "stock")).toBe("XYZ-P");
  });

  it("rewrites warrants to -WT regardless of series", () => {
    expect(yahooSymbolFor("AMPX.WS", "stock")).toBe("AMPX-WT");
    expect(yahooSymbolFor("ACHR.WSA", "stock")).toBe("ACHR-WT");
  });

  it("rewrites SPAC units to -UN", () => {
    expect(yahooSymbolFor("ALUB.U", "stock")).toBe("ALUB-UN");
  });

  it("leaves an ordinary ticker alone", () => {
    expect(yahooSymbolFor("AAPL", "stock")).toBe("AAPL");
    expect(yahooSymbolFor("aapl", "stock")).toBe("AAPL");
  });

  it("does not mistake an ordinary ticker ending in U or WS for a unit", () => {
    // The rules anchor on the dot. `NU` and `WS` are whole tickers.
    expect(yahooSymbolFor("NU", "stock")).toBe("NU");
    expect(yahooSymbolFor("WS", "stock")).toBe("WS");
    expect(yahooSymbolFor("PRU", "stock")).toBe("PRU");
  });
});
