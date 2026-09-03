import { describe, it, expect, afterEach, vi } from "vitest";
import { PERPS, PERP_SYMBOLS, contractAgeDays, perpBySymbol } from "../registry";

vi.mock("@/lib/markets/providers/cache", () => ({
  // Straight through: these tests are about the parsing and the guards, not
  // about the cache, and a real cache would make them order-dependent.
  cachedJson: async <T>(_k: string, _t: number, f: () => Promise<T | null>) => f(),
  BROWSER_UA: {},
}));

import { getPerpQuotes } from "../binance";

// ---------------------------------------------------------------------------
// The registry's dates are the part most likely to rot, and the part most
// likely to be "corrected" from a bad secondary source: the note this list came
// with had nine of twelve wrong. These tests pin the shape and the guards; the
// dates themselves were read from Binance's exchangeInfo.
// ---------------------------------------------------------------------------

describe("registry", () => {
  it("tracks twelve unique contracts", () => {
    expect(PERPS).toHaveLength(12);
    expect(new Set(PERP_SYMBOLS).size).toBe(12);
  });

  it("names every symbol as a USDT-margined pair", () => {
    for (const p of PERPS) {
      expect(p.symbol.endsWith("USDT"), `${p.symbol} should end in USDT`).toBe(true);
      expect(p.symbol).toBe(`${p.base}USDT`);
    }
  });

  it("carries a parseable listing date for every contract", () => {
    for (const p of PERPS) {
      expect(Number.isFinite(Date.parse(p.listedAt)), `${p.symbol} listedAt`).toBe(true);
      // Binance USDT-M futures did not exist before 2019.
      expect(Date.parse(p.listedAt)).toBeGreaterThan(Date.parse("2019-01-01"));
    }
  });

  it("marks BZ as a commodity, not a token", () => {
    // The underlying is Brent crude. It has no CoinGecko id and is not
    // something you can hold a fraction of, which is why perps are modelled
    // separately from the spot catalog.
    const bz = perpBySymbol("BZUSDT");
    expect(bz?.underlying).toBe("commodity");
    expect(PERPS.filter((p) => p.underlying === "crypto")).toHaveLength(11);
  });

  it("resolves symbols case-insensitively and rejects unknown ones", () => {
    expect(perpBySymbol("btcusdt")?.base).toBe("BTC");
    expect(perpBySymbol("  ETHUSDT ")?.base).toBe("ETH");
    expect(perpBySymbol("NOPEUSDT")).toBeNull();
  });

  it("computes contract age from the listing date", () => {
    const now = new Date("2026-09-03T00:00:00Z");
    const btc = perpBySymbol("BTCUSDT")!;
    const age = contractAgeDays(btc, now);
    expect(age).not.toBeNull();
    // Listed 2019-09-08; comfortably over six years.
    expect(age!).toBeGreaterThan(2000);
  });

  it("returns null for an unparseable date rather than zero", () => {
    // A silent 0 makes an old contract look brand new — the direction that
    // would mislead an age-sensitive model.
    expect(contractAgeDays({ ...PERPS[0]!, listedAt: "nonsense" })).toBeNull();
  });
});

describe("quote guards", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(tickers: unknown[], premiums: unknown[] = []) {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = url.includes("premiumIndex") ? premiums : tickers;
      return new Response(JSON.stringify(body), { status: 200 });
    });
  }

  const good = {
    symbol: "BTCUSDT",
    lastPrice: "80948.40",
    priceChangePercent: "4.764",
    highPrice: "81500.0",
    lowPrice: "77000.0",
    volume: "188000",
    quoteVolume: "15221091788",
  };

  it("parses a healthy ticker", async () => {
    stub([good], [
      { symbol: "BTCUSDT", markPrice: "80950.1", indexPrice: "80949.0", lastFundingRate: "-0.0001046", nextFundingTime: 1 },
    ]);
    const [q] = await getPerpQuotes(["BTCUSDT"]);
    expect(q!.price).toBeCloseTo(80948.4);
    expect(q!.changePct).toBeCloseTo(4.764);
    expect(q!.markPrice).toBeCloseTo(80950.1);
    expect(q!.fundingRate).toBeCloseTo(-0.0001046);
    expect(q!.live).toBe(true);
  });

  it("omits a contract priced at zero rather than rendering $0.00", async () => {
    // "$0.00" on a market screen is a claim that something is worthless — a
    // much stronger statement than "we could not price this".
    stub([{ ...good, lastPrice: "0" }]);
    expect(await getPerpQuotes(["BTCUSDT"])).toHaveLength(0);
  });

  it("omits negative, NaN and absurd prices", async () => {
    for (const bad of ["-5", "NaN", "abc", "1e30", ""]) {
      stub([{ ...good, lastPrice: bad }]);
      expect(await getPerpQuotes(["BTCUSDT"]), `lastPrice=${bad}`).toHaveLength(0);
    }
  });

  it("keeps a negative CHANGE, which is a direction not a price", async () => {
    stub([{ ...good, symbol: "MAGMAUSDT", lastPrice: "0.376", priceChangePercent: "-28.811" }]);
    const [q] = await getPerpQuotes(["MAGMAUSDT"]);
    expect(q!.changePct).toBeCloseTo(-28.811);
    expect(q!.price).toBeCloseTo(0.376);
  });

  it("prices sub-cent contracts without clamping them away", async () => {
    // These alts span eight orders of magnitude; a tight bound would reject
    // real data.
    stub([{ ...good, symbol: "TUSDT", lastPrice: "0.0045030" }]);
    const [q] = await getPerpQuotes(["TUSDT"]);
    expect(q!.price).toBeCloseTo(0.004503);
  });

  it("still returns a quote when funding data is missing", async () => {
    stub([good], []);
    const [q] = await getPerpQuotes(["BTCUSDT"]);
    expect(q!.price).toBeGreaterThan(0);
    expect(q!.markPrice).toBeNull();
    expect(q!.fundingRate).toBeNull();
  });

  it("ignores symbols outside the registry", async () => {
    stub([{ ...good, symbol: "SCAMUSDT" }]);
    expect(await getPerpQuotes(["SCAMUSDT"])).toHaveLength(0);
  });

  it("survives a provider outage without throwing", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));
    await expect(getPerpQuotes(["BTCUSDT"])).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Route integration. /markets/[symbol] resolves through `resolveInstrument`,
// so a perp missing from INSTRUMENTS is a 404 page no matter how good the
// provider is — which is exactly the bug this fixes.
// ---------------------------------------------------------------------------
describe("instrument registry integration", () => {
  it("resolves every tracked perp, so /markets/<symbol> is not a 404", async () => {
    const { resolveInstrument } = await import("@/lib/markets/instruments");
    for (const p of PERPS) {
      const inst = resolveInstrument(p.symbol);
      expect(inst, `${p.symbol} must resolve`).not.toBeNull();
      expect(inst!.quoteSource).toBe("binance-perp");
      expect(inst!.currency).toBe("USDT");
      expect(inst!.exchange).toBe("Binance Futures");
    }
  });

  it("never reports a market cap for a derivative", async () => {
    const { resolveInstrument } = await import("@/lib/markets/instruments");
    for (const p of PERPS) {
      expect(resolveInstrument(p.symbol)!.marketCapSupported).toBe(false);
    }
  });

  it("does not steal aliases from instruments that already own them", async () => {
    const { resolveInstrumentOrAlias } = await import("@/lib/markets/instruments");
    // "brent" is the ICE front-month future and must stay that way; BZUSDT is
    // a different contract on the same underlying.
    expect(resolveInstrumentOrAlias("brent")!.symbol).toBe("BRENTUSD");
    expect(resolveInstrumentOrAlias("brent perp")!.symbol).toBe("BZUSDT");
    expect(resolveInstrumentOrAlias("gold")!.symbol).toBe("XAUUSD");
  });

  it("tells the reader a perp is a derivative", async () => {
    const { resolveInstrument } = await import("@/lib/markets/instruments");
    for (const p of PERPS) {
      expect(resolveInstrument(p.symbol)!.providerNote ?? "").toMatch(/perpetual futures contract/i);
    }
    // BZ carries the extra note that its underlying is also listed separately.
    expect(resolveInstrument("BZUSDT")!.providerNote).toMatch(/BRENTUSD/);
  });

  it("keeps every perp symbol unique across the whole instrument list", async () => {
    const { INSTRUMENTS } = await import("@/lib/markets/instruments");
    const syms = INSTRUMENTS.map((i) => i.symbol);
    expect(new Set(syms).size).toBe(syms.length);
  });
});
