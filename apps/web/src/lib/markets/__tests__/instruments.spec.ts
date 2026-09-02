import { describe, it, expect } from "vitest";
import {
  INSTRUMENTS,
  resolveInstrument,
  searchInstruments,
  catalogInstrument,
  assetClassLabel,
  resolveInstrumentOrAlias,
} from "../instruments";

// ---------------------------------------------------------------------------
// The instrument layer exists so that gold, the euro and the S&P 500 can be
// priced without being forced through a securities model that has no place for
// them. These tests pin the symbol translation and the honesty of the
// supported-field flags.
// ---------------------------------------------------------------------------

describe("resolving an instrument", () => {
  it("resolves XAUUSD, which is the case this layer was built for", () => {
    const gold = resolveInstrument("XAUUSD");
    expect(gold).not.toBeNull();
    expect(gold!.assetClass).toBe("commodity");
    expect(gold!.displayName).toBe("Gold / US Dollar");
    // Gold is not an equity, not an issuer and has no CUSIP.
    expect(gold!.marketCapSupported).toBe(false);
  });

  it("maps gold to the futures contract the provider actually carries", () => {
    // XAUUSD=X returns 404 from the provider. GC=F is the front-month COMEX
    // future, which is not spot, and the instrument says so rather than
    // presenting a futures price as a spot price.
    const gold = resolveInstrument("XAUUSD")!;
    expect(gold.providerSymbol).toBe("GC=F");
    expect(gold.providerNote).toMatch(/futures/i);
    expect(gold.providerNote).toMatch(/differs from spot/i);
  });

  it("resolves by explicit alias and by display name, on the query surface", () => {
    // Written-down market conventions, not fuzzy matching. "Gold" means XAUUSD
    // because that is the convention, and the mapping is in the registry --
    // but only where a human typed a query, never for a route segment.
    expect(resolveInstrumentOrAlias("gold")?.symbol).toBe("XAUUSD");
    expect(resolveInstrumentOrAlias("Euro Dollar")?.symbol).toBe("EURUSD");
    expect(resolveInstrumentOrAlias("dow")?.symbol).toBe("DJI");
    expect(resolveInstrumentOrAlias("Gold / US Dollar")?.symbol).toBe("XAUUSD");
  });

  it("accepts the spellings a reader actually types", () => {
    for (const q of ["EURUSD", "eurusd", "EUR/USD", "eur usd", "EUR-USD"]) {
      expect(resolveInstrument(q)?.symbol, q).toBe("EURUSD");
    }
  });

  it("resolves the provider symbol too, without exposing it elsewhere", () => {
    expect(resolveInstrument("^GSPC")?.symbol).toBe("SPX");
    expect(resolveInstrument("GC=F")?.symbol).toBe("XAUUSD");
  });

  it("returns null for an unknown symbol rather than a near miss", () => {
    expect(resolveInstrument("NOTATHING")).toBeNull();
    expect(resolveInstrument("")).toBeNull();
    // An equity is NOT in this registry: it has a CUSIP and lives in the
    // securities catalog. Returning it here would blur the two models.
    expect(resolveInstrument("NVDA")).toBeNull();
  });
});

describe("what each class can actually answer", () => {
  it("gives FX a price and no volume", () => {
    // Measured against the provider: no FX pair returns a volume series.
    const eur = resolveInstrument("EURUSD")!;
    expect(eur.assetClass).toBe("fx");
    expect(eur.priceSupported).toBe(true);
    expect(eur.volumeSupported).toBe(false);
    expect(eur.marketCapSupported).toBe(false);
    expect(eur.baseAsset).toBe("EUR");
    expect(eur.quoteAsset).toBe("USD");
  });

  it("gives the VIX and the 10-year no volume either", () => {
    expect(resolveInstrument("VIX")!.volumeSupported).toBe(false);
    expect(resolveInstrument("US10Y")!.volumeSupported).toBe(false);
    // The ten-year is quoted as a yield, which is not a price of anything.
    expect(resolveInstrument("US10Y")!.providerNote).toMatch(/yield/i);
  });

  it("gives index and commodity futures volume but never a market cap", () => {
    expect(resolveInstrument("SPX")!.volumeSupported).toBe(true);
    expect(resolveInstrument("XAUUSD")!.volumeSupported).toBe(true);
    for (const i of INSTRUMENTS) {
      // Nothing in this registry is a security, so nothing has a market cap.
      expect(i.marketCapSupported, i.symbol).toBe(false);
    }
  });

  it("declares a currency for every instrument", () => {
    // USDJPY is quoted in yen, not dollars. A pair's quote currency is not
    // always USD and the UI must not assume it.
    expect(resolveInstrument("USDJPY")!.currency).toBe("JPY");
    expect(resolveInstrument("USDINR")!.currency).toBe("INR");
    for (const i of INSTRUMENTS) expect(i.currency.length, i.symbol).toBeGreaterThan(0);
  });
});

describe("searching", () => {
  it("finds by symbol prefix, name and alias", () => {
    expect(searchInstruments("XAU").map((i) => i.symbol)).toContain("XAUUSD");
    expect(searchInstruments("gold").map((i) => i.symbol)).toContain("XAUUSD");
    expect(searchInstruments("euro").map((i) => i.symbol)).toContain("EURUSD");
    expect(searchInstruments("crude").map((i) => i.symbol)).toEqual(
      expect.arrayContaining(["WTIUSD", "BRENTUSD"])
    );
  });

  it("puts an exact symbol match first", () => {
    expect(searchInstruments("SPX")[0]!.symbol).toBe("SPX");
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(searchInstruments("")).toEqual([]);
    expect(searchInstruments("zzzzz")).toEqual([]);
  });
});

describe("the bridge to the securities catalog", () => {
  it("expresses catalog assets in the same vocabulary without changing them", () => {
    // Equities, ETFs and coins keep their existing identity and order routing.
    // This only lets one search surface list a stock beside gold.
    expect(catalogInstrument("NVDA", "stock", "NVIDIA").assetClass).toBe("equity");
    expect(catalogInstrument("IBIT", "etf", "iShares Bitcoin Trust").assetClass).toBe("etf");
    expect(catalogInstrument("BTC", "crypto", "Bitcoin").assetClass).toBe("crypto");
  });

  it("quotes a coin as a pair and an equity as itself", () => {
    expect(catalogInstrument("BTC", "crypto", "Bitcoin").providerSymbol).toBe("BTC-USD");
    expect(catalogInstrument("NVDA", "stock", "NVIDIA").providerSymbol).toBe("NVDA");
  });

  it("labels every class for the badge", () => {
    expect(assetClassLabel("equity")).toBe("Equity");
    expect(assetClassLabel("fx")).toBe("FX");
    expect(assetClassLabel("commodity")).toBe("Commodity");
    expect(assetClassLabel("index")).toBe("Index");
    expect(assetClassLabel("rate")).toBe("Rate");
  });
});

describe("registry integrity", () => {
  it("has a unique canonical symbol per instrument", () => {
    const s = INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(s).size).toBe(s.length);
  });

  it("has a unique provider symbol per instrument", () => {
    // Two instruments sharing a provider symbol would be the same thing twice.
    const p = INSTRUMENTS.map((i) => i.providerSymbol);
    expect(new Set(p).size).toBe(p.length);
  });

  it("notes every case where our symbol is not what the provider serves", () => {
    // The metals and energy contracts are futures, and each says so. A reader
    // comparing our gold price to a spot quote elsewhere should learn why they
    // differ from us rather than conclude one is broken.
    for (const i of INSTRUMENTS.filter((x) => x.assetClass === "commodity")) {
      expect(i.providerNote, i.symbol).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// A daily change must be a daily change.
//
// `chartPreviousClose` is the close before the START of the requested window,
// not yesterday's close. Requesting a year and reading it produced NVIDIA at
// +24.84% and the S&P at +18.13% — annual returns rendered under a field named
// changePercent. Nothing about those numbers looks broken, which is why this is
// pinned rather than left to review.
// ---------------------------------------------------------------------------
describe("the quote window", () => {
  it("requests a short range, so the prior close is the prior session", async () => {
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: unknown) => {
      seen.push(String(u));
      return new Response(
        JSON.stringify({
          chart: { result: [{ meta: { regularMarketPrice: 217.44, chartPreviousClose: 213.05, currency: "USD" } }] },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    try {
      const { instrumentQuote } = await import("../instrumentQuote");
      const q = await instrumentQuote(catalogInstrument("NVDA", "stock", "NVIDIA"));
      expect(seen[0]).toContain("range=5d");
      expect(seen[0]).not.toContain("range=1y");
      // 217.44 from 213.05 is a bit over two percent, not twenty-four.
      expect(q!.changePercent!).toBeCloseTo(2.06, 1);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("reports null rather than zero for a field the instrument does not have", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          // The provider returns volume 0 for FX. Zero is a claim that nothing
          // traded; the truth is that the concept does not apply.
          chart: { result: [{ meta: { regularMarketPrice: 1.1583, chartPreviousClose: 1.1655, regularMarketVolume: 0, currency: "USD" } }] },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
    try {
      const { instrumentQuote } = await import("../instrumentQuote");
      const q = await instrumentQuote(resolveInstrument("EURUSD")!);
      expect(q!.volume).toBeNull();
      expect(q!.marketCap).toBeNull();
      expect(q!.price).toBe(1.1583);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("returns null instead of a zeroed quote when the provider fails", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    try {
      const { instrumentQuote } = await import("../instrumentQuote");
      expect(await instrumentQuote(resolveInstrument("XAUUSD")!)).toBeNull();
    } finally {
      globalThis.fetch = real;
    }
  });
});

// ---------------------------------------------------------------------------
// Route precedence: a real ticker must never be shadowed by an instrument.
//
// /markets/[symbol] tries the securities catalog first and the instrument
// registry only after it misses. That order matters: GOLD is a listed equity
// ticker, and resolving it to the metal would send someone looking at a company
// to a commodity page.
// ---------------------------------------------------------------------------
describe("symbol precedence", () => {
  it("does not claim tickers that belong to listed securities", () => {
    // Each of these is a real listed ticker. The instrument registry must not
    // answer for any of them, or the securities page loses to a commodity.
    for (const t of ["GOLD", "SPY", "NVDA", "IBIT", "GLD", "SLV", "UUP"]) {
      expect(resolveInstrument(t), t).toBeNull();
    }
  });

  it("claims the pair symbols that no equity uses", () => {
    for (const t of ["XAUUSD", "XAGUSD", "EURUSD", "USDJPY", "SPX", "US10Y"]) {
      expect(resolveInstrument(t), t).not.toBeNull();
    }
  });

  it("resolves the alias only through search, not as a bare ticker", () => {
    // "gold" as a query is fine; GOLD as a route segment is an equity.
    expect(resolveInstrumentOrAlias("gold")?.symbol).toBe("XAUUSD");
    expect(resolveInstrument("GOLD")).toBeNull();
  });
});
