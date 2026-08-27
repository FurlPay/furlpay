import { describe, it, expect } from "vitest";
import {
  buildBrief,
  CRYPTO_SYMBOLS,
  DEFAULT_WATCHLIST,
  INDEX_SYMBOLS,
  MAX_WATCHLIST,
  parseWatchlist,
  sessionDateOf,
} from "../brief";
import type { ScreenId, ScreenResult, ScreenerQuote } from "../screener";
import type { YahooQuote } from "../../providers/yahoo";

// ---------------------------------------------------------------------------
// Assembly.
//
// This layer exists to make one guarantee: a broken upstream costs its own
// section and nothing else. The tests below break each one in turn, because
// the alternative — finding out at 21:30 UTC in a public channel — is the whole
// thing we are avoiding.
//
// The fetchers are injected. Nothing here touches the network: a spec that
// depends on Yahoo being up is a spec that fails for reasons unrelated to the
// code it claims to test.
// ---------------------------------------------------------------------------

function sq(over: Partial<ScreenerQuote> = {}): ScreenerQuote {
  return {
    symbol: "TEST",
    shortName: "Test Corp",
    marketState: "CLOSED",
    regularMarketPrice: 100,
    regularMarketChangePercent: 5,
    regularMarketVolume: 2_000_000,
    averageDailyVolume3Month: 1_000_000,
    fiftyDayAverage: 90,
    twoHundredDayAverage: 80,
    fiftyTwoWeekHighChangePercent: -2,
    marketCap: 10_000_000_000,
    ...over,
  };
}

function screen(id: ScreenId, quotes: ScreenerQuote[], total = quotes.length): ScreenResult {
  return { id, label: id, definition: `definition of ${id}`, quotes, total, fetchedAt: 0 };
}

function yq(price: number, changePct: number | null): YahooQuote {
  return {
    symbol: "X",
    name: null,
    currency: "USD",
    exchange: null,
    instrumentType: null,
    price,
    previousClose: null,
    change: changePct === null ? null : (price * changePct) / 100,
    changePct,
    dayHigh: null,
    dayLow: null,
    high52w: null,
    low52w: null,
    volume: null,
    marketTime: 1787861212,
  };
}

/** All upstreams healthy. Tests break one at a time from here. */
function healthy() {
  return {
    screen: async (id: ScreenId) =>
      screen(
        id,
        [
          sq({ symbol: "AAA", regularMarketChangePercent: 9 }),
          sq({ symbol: "BBB", regularMarketChangePercent: 4 }),
        ],
        id === "day_gainers" ? 195 : id === "day_losers" ? 135 : 271
      ),
    quote: async () => yq(7730.99, 0.72),
  };
}

describe("buildBrief — sections degrade independently", () => {
  it("assembles every section when every upstream answers", async () => {
    const b = await buildBrief({ fetchers: healthy(), boardSize: 5 });
    expect(b.postable).toBe(true);
    expect(b.indices).toHaveLength(INDEX_SYMBOLS.length);
    expect(b.crypto).toHaveLength(CRYPTO_SYMBOLS.length);
    expect(b.gainers.length).toBeGreaterThan(0);
    expect(b.losers.length).toBeGreaterThan(0);
    expect(b.bullish.length).toBeGreaterThan(0);
    expect(b.degraded).toEqual([]);
  });

  it("keeps the screener sections when every quote fails", async () => {
    const b = await buildBrief({
      fetchers: { ...healthy(), quote: async () => null },
    });
    expect(b.indices).toEqual([]);
    expect(b.crypto).toEqual([]);
    expect(b.gainers.length).toBeGreaterThan(0);
    expect(b.postable).toBe(true);
    // Named, not silent.
    expect(b.degraded.join(" ")).toContain("^GSPC");
    expect(b.degraded.join(" ")).toContain("BTC-USD");
  });

  it("keeps the index section when the screener fails", async () => {
    const b = await buildBrief({
      fetchers: { ...healthy(), screen: async () => null },
    });
    expect(b.indices).toHaveLength(INDEX_SYMBOLS.length);
    expect(b.gainers).toEqual([]);
    expect(b.bullish).toEqual([]);
    expect(b.postable).toBe(true);
    expect(b.degraded).toContain("day_gainers screen unavailable");
    expect(b.degraded).toContain("day_losers screen unavailable");
    expect(b.degraded).toContain("most_actives screen unavailable");
  });

  it("loses only the losers board when only that screen fails", async () => {
    const h = healthy();
    const b = await buildBrief({
      fetchers: {
        ...h,
        screen: async (id: ScreenId) => (id === "day_losers" ? null : h.screen(id)),
      },
    });
    expect(b.losers).toEqual([]);
    expect(b.gainers.length).toBeGreaterThan(0);
    expect(b.breadth.decliners).toBeNull();
    expect(b.breadth.advancers).toBe(195);
    expect(b.degraded).toEqual(["day_losers screen unavailable"]);
  });

  it("is not postable when every upstream fails, so nothing empty is published", async () => {
    const b = await buildBrief({
      fetchers: { screen: async () => null, quote: async () => null },
    });
    expect(b.postable).toBe(false);
    expect(b.degraded.length).toBeGreaterThan(0);
  });

  it("does not let a throwing upstream take the whole brief with it", async () => {
    const b = await buildBrief({
      fetchers: {
        ...healthy(),
        screen: async () => {
          throw new Error("upstream exploded");
        },
      },
    });
    expect(b.indices).toHaveLength(INDEX_SYMBOLS.length);
    expect(b.postable).toBe(true);
  });

  it("survives a quote that throws as well as one that returns null", async () => {
    const b = await buildBrief({
      fetchers: {
        ...healthy(),
        quote: async () => {
          throw new Error("network");
        },
      },
    });
    expect(b.indices).toEqual([]);
    expect(b.gainers.length).toBeGreaterThan(0);
    expect(b.postable).toBe(true);
  });
});

describe("buildBrief — nothing is inferred across a gap", () => {
  it("drops an index priced at zero rather than printing it", async () => {
    const b = await buildBrief({ fetchers: { ...healthy(), quote: async () => yq(0, 1) } });
    expect(b.indices).toEqual([]);
    expect(b.degraded.length).toBeGreaterThan(0);
  });

  it("keeps a level whose percent change is unknown, with a null percent", async () => {
    const b = await buildBrief({ fetchers: { ...healthy(), quote: async () => yq(7730.99, null) } });
    expect(b.indices).toHaveLength(INDEX_SYMBOLS.length);
    expect(b.indices[0].changePercent).toBeNull();
    expect(b.indices[0].price).toBe(7730.99);
  });

  it("drops a screener row with no percent change rather than treating it as flat", async () => {
    const b = await buildBrief({
      fetchers: {
        ...healthy(),
        screen: async (id: ScreenId) =>
          screen(id, [sq({ symbol: "NOPCT", regularMarketChangePercent: undefined }), sq({ symbol: "OK" })]),
      },
    });
    expect(b.gainers.map((r) => r.symbol)).toEqual(["OK"]);
  });

  it("converts the exchange timestamp from seconds to milliseconds", async () => {
    const b = await buildBrief({ fetchers: healthy() });
    expect(b.indices[0].asOf).toBe(1787861212 * 1000);
  });
});

describe("buildBrief — breadth says what it counted", () => {
  it("carries both screens' criteria into the definition", async () => {
    const b = await buildBrief({ fetchers: healthy() });
    expect(b.breadth.advancers).toBe(195);
    expect(b.breadth.decliners).toBe(135);
    // The number is meaningless without this, and it must travel with it.
    expect(b.breadth.definition).toContain("price");
    expect(b.breadth.definition.length).toBeGreaterThan(20);
  });
});

describe("buildBrief — market state and session date", () => {
  it("reads the market state from the data rather than from the clock", async () => {
    const b = await buildBrief({
      fetchers: {
        ...healthy(),
        screen: async (id: ScreenId) => screen(id, [sq({ marketState: "REGULAR" })]),
      },
    });
    expect(b.marketState).toBe("REGULAR");
  });

  it("reports no market state rather than guessing one", async () => {
    const b = await buildBrief({
      fetchers: {
        ...healthy(),
        screen: async (id: ScreenId) => screen(id, [sq({ marketState: undefined })]),
      },
    });
    expect(b.marketState).toBeNull();
  });

  it("dates the session in US Eastern, not in the server's timezone", () => {
    // 01:30 UTC on the 29th is still the evening of the 28th in New York, which
    // is the trading day the brief is about.
    expect(sessionDateOf(new Date("2026-08-29T01:30:00.000Z"))).toBe("2026-08-28");
    expect(sessionDateOf(new Date("2026-08-28T21:30:00.000Z"))).toBe("2026-08-28");
  });
});

describe("buildBrief — the bullish board draws on both screens", () => {
  it("considers most_actives as well as day_gainers", async () => {
    const b = await buildBrief({
      fetchers: {
        ...healthy(),
        screen: async (id: ScreenId) => {
          if (id === "day_gainers") return screen(id, [sq({ symbol: "GAIN" })]);
          if (id === "most_actives") return screen(id, [sq({ symbol: "ACTIVE" })]);
          return screen(id, []);
        },
      },
    });
    expect(b.bullish.map((r) => r.symbol).sort()).toEqual(["ACTIVE", "GAIN"]);
  });

  it("reports why candidates did not rank", async () => {
    const b = await buildBrief({
      fetchers: {
        ...healthy(),
        screen: async (id: ScreenId) =>
          screen(id, [sq({ symbol: "PENNY", regularMarketPrice: 0.4, marketCap: 1e6 })]),
      },
    });
    expect(b.bullish).toEqual([]);
    expect(b.ranking.considered).toBeGreaterThan(0);
    expect(Object.keys(b.ranking.rejected).length).toBeGreaterThan(0);
  });
});

describe("parseWatchlist — an operator-supplied env var is validated, not trusted", () => {
  it("falls back to the default when unset or empty", () => {
    expect(parseWatchlist(undefined)).toEqual(DEFAULT_WATCHLIST);
    expect(parseWatchlist("")).toEqual(DEFAULT_WATCHLIST);
    expect(parseWatchlist("   ")).toEqual(DEFAULT_WATCHLIST);
  });

  it("uppercases, trims and de-duplicates", () => {
    expect(parseWatchlist(" nvda , aapl ,NVDA")).toEqual(["NVDA", "AAPL"]);
  });

  it("drops anything that is not a plausible ticker", () => {
    // The value is interpolated into a URL. A path traversal or a query
    // injection must not survive, however it got into the environment.
    expect(parseWatchlist("NVDA,../../etc/passwd,AAPL")).toEqual(["NVDA", "AAPL"]);
    expect(parseWatchlist("NVDA,A B C,AAPL")).toEqual(["NVDA", "AAPL"]);
    expect(parseWatchlist("NVDA,?range=1d&x=1,AAPL")).toEqual(["NVDA", "AAPL"]);
    expect(parseWatchlist("NVDA,<script>,AAPL")).toEqual(["NVDA", "AAPL"]);
  });

  it("keeps the symbol shapes real tickers actually use", () => {
    expect(parseWatchlist("^VIX,BRK-B,DX-Y.NYB,CL=F")).toEqual(["^VIX", "BRK-B", "DX-Y.NYB", "CL=F"]);
  });

  it("caps the list, because every symbol is a request on a shared budget", () => {
    const many = Array.from({ length: 40 }, (_, i) => `T${i}`).join(",");
    expect(parseWatchlist(many)).toHaveLength(MAX_WATCHLIST);
  });

  it("falls back rather than returning empty when every entry is rejected", () => {
    expect(parseWatchlist("!!!,@@@,###")).toEqual(DEFAULT_WATCHLIST);
  });
});

describe("buildBrief — watchlist, macro and narrative", () => {
  it("resolves the watchlist and reports rows that answered", async () => {
    const b = await buildBrief({ fetchers: healthy(), watchlist: ["NVDA", "AAPL"] });
    expect(b.watchlist.map((r) => r.symbol)).toEqual(["NVDA", "AAPL"]);
  });

  it("keeps the rest of the brief when the whole watchlist fails", async () => {
    const h = healthy();
    const b = await buildBrief({
      watchlist: ["NVDA"],
      fetchers: {
        ...h,
        quote: async (s: string) => (s === "NVDA" ? null : h.quote()),
      },
    });
    expect(b.watchlist).toEqual([]);
    expect(b.indices.length).toBeGreaterThan(0);
    expect(b.degraded).toContain("watchlist quotes unavailable");
  });

  it("produces a narrative built only from signals that carry evidence", async () => {
    const b = await buildBrief({ fetchers: healthy() });
    expect(b.narrative.length).toBeGreaterThan(0);
    for (const s of b.signals) expect(s.evidence.length).toBeGreaterThan(0);
    // Every sentence in the narrative is a signal's own text, verbatim.
    for (const s of b.signals.slice(0, 5)) expect(b.narrative).toContain(s.text);
  });

  it("emits no narrative at all when there is nothing measured to say", async () => {
    const b = await buildBrief({
      fetchers: { screen: async () => null, quote: async () => null, bars: async () => null },
    });
    expect(b.narrative).toBe("");
    expect(b.signals).toEqual([]);
  });

  it("costs the sparkline, not the row, when the bars call fails", async () => {
    const b = await buildBrief({
      fetchers: { ...healthy(), bars: async () => null },
    });
    expect(b.indices.length).toBeGreaterThan(0);
    expect(b.indices[0].series).toEqual([]);
  });

  it("carries intraday closes into the row for a sparkline", async () => {
    const b = await buildBrief({
      fetchers: {
        ...healthy(),
        bars: async () => [
          { t: 1, o: 1, h: 1, l: 1, c: 10, v: 1 },
          { t: 2, o: 1, h: 1, l: 1, c: 11, v: 1 },
        ],
      },
    });
    expect(b.indices[0].series).toEqual([10, 11]);
  });
});
