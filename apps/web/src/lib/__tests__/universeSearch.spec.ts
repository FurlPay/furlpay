import { describe, expect, it } from "vitest";
import { UNIVERSE, isTradable, searchUniverse, universeStats } from "@/lib/markets/universe";
import { bySymbol } from "@/lib/markets/catalog";

// ---------------------------------------------------------------------------
// The tradable universe was a hand-written 391-symbol list, so any asset nobody
// had typed into catalog.ts did not exist — simultaneously in the web app, the
// extension, the Android app and the watch, because all four read one catalog.
// universe.json now carries ~13k broker-synced listings; catalog.ts remains the
// curated enrichment layer (sector, industry, logo, CoinGecko id).
// ---------------------------------------------------------------------------

describe("universe", () => {
  it("is dramatically larger than the curated catalog", () => {
    const s = universeStats();
    expect(s.tradable).toBeGreaterThan(5_000);
    expect(s.tradable).toBeGreaterThan(s.curated * 10);
    expect(s.fractionable).toBeGreaterThan(1_000);
  });

  it("excludes OTC shells and untradable listings", () => {
    // Only listed exchanges are synced; OTC is the bulk of the raw feed and is
    // mostly shells, expired warrants and delisted husks.
    const exchanges = new Set(UNIVERSE.map((a) => a.exchange));
    expect(exchanges.has("OTC")).toBe(false);
    expect([...exchanges].every((e) => ["NASDAQ", "NYSE", "ARCA", "AMEX", "BATS", "NYSEARCA"].includes(e))).toBe(true);
  });

  it("knows what is tradable", () => {
    expect(isTradable("AAPL")).toBe(true);
    expect(isTradable("aapl")).toBe(true); // case-insensitive
    expect(isTradable("NOT_A_REAL_TICKER")).toBe(false);
  });
});

describe("search ranking", () => {
  it("puts an exact symbol match first", () => {
    const r = searchUniverse("AA");
    expect(r[0].symbol).toBe("AA"); // Alcoa, not the many AA* CLO ETFs
  });

  it("ranks a curated symbol-prefix hit above an uncurated one", () => {
    // Deliberately NOT "all curated before all uncurated": a symbol prefix is a
    // stronger signal than a name substring, so an uncurated ticker starting
    // with the query outranks a curated asset that merely mentions it. What
    // must hold is that within symbol-prefix matches, curated wins.
    const r = searchUniverse("AAP");
    // "AAP" is itself a real ticker (Advance Auto Parts) and an exact match
    // outranks everything — correctly. Compare only the non-exact prefix hits.
    expect(r[0].symbol).toBe("AAP");
    const prefixHits = r.filter((a) => a.symbol.startsWith("AAP") && a.symbol !== "AAP");
    const firstUncuratedPrefix = prefixHits.findIndex((a) => !a.curated);
    const lastCuratedPrefix = prefixHits.map((a) => a.curated).lastIndexOf(true);
    if (firstUncuratedPrefix >= 0 && lastCuratedPrefix >= 0) {
      expect(lastCuratedPrefix).toBeLessThan(firstUncuratedPrefix);
    }
    expect(prefixHits.length).toBeGreaterThan(0);
  });

  it("finds assets absent from the curated catalog — the original bug", () => {
    // Anything the universe lists is now findable, curated or not.
    const uncurated = UNIVERSE.find((a) => !bySymbol.has(a.symbol));
    expect(uncurated).toBeDefined();
    const hits = searchUniverse(uncurated!.symbol);
    expect(hits.some((h) => h.symbol === uncurated!.symbol)).toBe(true);
  });

  it("matches on company name, not just ticker", () => {
    const r = searchUniverse("palantir");
    expect(r.some((a) => a.symbol === "PLTR")).toBe(true);
  });

  it("honours the kind filter", () => {
    expect(searchUniverse("bitcoin", { kind: "crypto" }).every((a) => a.kind === "crypto")).toBe(true);
    expect(searchUniverse("A", { kind: "stock", limit: 20 }).every((a) => a.kind === "stock")).toBe(true);
  });

  it("can restrict to fractionable assets for $1 investing", () => {
    expect(searchUniverse("A", { fractionableOnly: true, limit: 30 }).every((a) => a.fractionable)).toBe(true);
  });

  it("respects the limit and never returns the whole universe", () => {
    expect(searchUniverse("A", { limit: 10 })).toHaveLength(10);
    expect(searchUniverse("").length).toBeLessThanOrEqual(50);
  });

  it("tags every asset USD so a non-USD listing cannot slip in unpriced", () => {
    // A KRW price rendered as USD is a ~1,375x error. Adding a non-US listing
    // must be a deliberate decision, not a silent side effect of a sync.
    expect(searchUniverse("A", { limit: 25 }).every((a) => a.currency === "USD")).toBe(true);
  });
});
