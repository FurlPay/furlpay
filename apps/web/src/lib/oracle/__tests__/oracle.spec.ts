import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_AGE_SECONDS,
  MAX_DEVIATION,
  circuitOpen,
  priceFor,
  recordOracleFailure,
  resolvePrice,
  __resetBreakers,
  type OracleCandidate,
} from "../index";

// ---------------------------------------------------------------------------
// The price oracle.
//
// Every test here is a way of asking the same question: can a bad price reach
// an execution? The oracle's whole value is that it REFUSES where the display
// pipeline degrades, so the tests are mostly about what it declines to answer.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-08-22T12:00:00.000Z");
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

beforeEach(() => __resetBreakers());

describe("freshness", () => {
  it("accepts a price inside the age bound", () => {
    const result = resolvePrice(
      "NVDA",
      [{ source: "brokerage", price: 214.72, observedAt: at(5) }],
      { use: "settlement", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.price.price).toBe(214.72);
      expect(result.price.ageSeconds).toBeCloseTo(5);
    }
  });

  it("refuses a price older than the bound for its use", () => {
    const stale: OracleCandidate[] = [{ source: "brokerage", price: 214.72, observedAt: at(120) }];
    const settlement = resolvePrice("NVDA", stale, { use: "settlement", assetClass: "equity", now: NOW });
    expect(settlement.ok).toBe(false);
    if (!settlement.ok) expect(settlement.refusal.reason).toBe("stale");

    // The same price is fine for a valuation, which is not an execution.
    const valuation = resolvePrice("NVDA", stale, { use: "valuation", assetClass: "equity", now: NOW });
    expect(valuation.ok).toBe(true);
  });

  it("holds settlement to a tighter bound than a quote", () => {
    expect(MAX_AGE_SECONDS.settlement).toBeLessThan(MAX_AGE_SECONDS.quote);
    expect(MAX_AGE_SECONDS.quote).toBeLessThan(MAX_AGE_SECONDS.valuation);
  });

  it("REFUSES a price with no timestamp rather than assuming it is current", () => {
    // The check people skip. A source that goes silent keeps serving its last
    // value; without a timestamp nothing catches it.
    const result = resolvePrice(
      "NVDA",
      [{ source: "brokerage", price: 214.72, observedAt: null }],
      { use: "settlement", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("no_timestamp");
  });

  it("refuses an unparseable timestamp", () => {
    const result = resolvePrice(
      "NVDA",
      [{ source: "brokerage", price: 214.72, observedAt: "not a date" }],
      { use: "quote", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("no_timestamp");
  });
});

describe("sanity bounds", () => {
  it("rejects a price outside the asset class range", () => {
    // A decimal-shifted feed: well-formed, plausible-looking, wrong by 10^6.
    const result = resolvePrice(
      "NVDA",
      [{ source: "brokerage", price: 214_720_000, observedAt: at(1) }],
      { use: "settlement", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("out_of_bounds");
  });

  it("holds a stablecoin to a tight band", () => {
    const depegged = resolvePrice(
      "USDC",
      [{ source: "coingecko", price: 0.3, observedAt: at(1) }],
      { use: "settlement", assetClass: "stablecoin", now: NOW }
    );
    expect(depegged.ok).toBe(false);

    const normal = resolvePrice(
      "USDC",
      [{ source: "coingecko", price: 0.999, observedAt: at(1) }],
      { use: "settlement", assetClass: "stablecoin", now: NOW }
    );
    expect(normal.ok).toBe(true);
  });

  it("allows a legitimate low-priced crypto asset", () => {
    // The bounds must not reject real assets. A sub-cent coin is ordinary.
    const result = resolvePrice(
      "BONK",
      [{ source: "coingecko", price: 0.0000042, observedAt: at(1) }],
      { use: "quote", assetClass: "crypto", now: NOW }
    );
    expect(result.ok).toBe(true);
  });

  it("rejects zero and negative prices before anything else looks at them", () => {
    for (const price of [0, -5]) {
      const result = resolvePrice(
        "NVDA",
        [{ source: "brokerage", price, observedAt: at(1) }],
        { use: "quote", assetClass: "equity", now: NOW }
      );
      expect(result.ok, String(price)).toBe(false);
    }
  });
});

describe("deviation", () => {
  it("accepts sources that agree", () => {
    const result = resolvePrice(
      "NVDA",
      [
        { source: "brokerage", price: 214.72, observedAt: at(2) },
        { source: "yahoo", price: 214.8, observedAt: at(5) },
      ],
      { use: "quote", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Freshest wins, and the other is recorded as corroboration.
      expect(result.price.source).toBe("brokerage");
      expect(result.price.corroboratedBy).toContain("yahoo");
    }
  });

  it("REFUSES rather than averaging when sources disagree", () => {
    // An average of a right price and a wrong one is a wrong price, and nothing
    // here can tell which is which.
    const result = resolvePrice(
      "NVDA",
      [
        { source: "brokerage", price: 214.72, observedAt: at(2) },
        { source: "yahoo", price: 260.0, observedAt: at(2) },
      ],
      { use: "settlement", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.reason).toBe("deviation");
      if (result.refusal.reason === "deviation") expect(result.refusal.prices).toHaveLength(2);
    }
  });

  it("does not demand corroboration when only one source exists", () => {
    // Requiring two would make the oracle unusable wherever only one exists.
    const result = resolvePrice(
      "NVDA",
      [{ source: "brokerage", price: 214.72, observedAt: at(2) }],
      { use: "settlement", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(true);
  });

  it("tolerates a spread below the threshold", () => {
    const withinTolerance = 214.72 * (1 + MAX_DEVIATION * 0.5);
    const result = resolvePrice(
      "NVDA",
      [
        { source: "brokerage", price: 214.72, observedAt: at(2) },
        { source: "yahoo", price: withinTolerance, observedAt: at(3) },
      ],
      { use: "quote", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(true);
  });

  it("ignores an unusable source instead of letting it trigger a false deviation", () => {
    // A stale second source must not make a good first source unusable.
    const result = resolvePrice(
      "NVDA",
      [
        { source: "brokerage", price: 214.72, observedAt: at(2) },
        { source: "yahoo", price: 260.0, observedAt: at(9999) },
      ],
      { use: "quote", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.price.source).toBe("brokerage");
  });
});

describe("no usable source", () => {
  it("refuses when every candidate is empty", () => {
    const result = resolvePrice("NVDA", [], { use: "quote", assetClass: "equity", now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("no_source");
  });

  it("reports the SPECIFIC reason rather than a generic one", () => {
    // "stale" and "out of bounds" call for very different responses.
    const result = resolvePrice(
      "NVDA",
      [{ source: "brokerage", price: 214.72, observedAt: at(9999) }],
      { use: "settlement", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("stale");
  });
});

describe("circuit breaker", () => {
  it("opens after repeated failures and stops asking", () => {
    for (let i = 0; i < 5; i++) recordOracleFailure("BADSYM", NOW);
    expect(circuitOpen("BADSYM", NOW)).toBe(true);

    const result = priceFor(
      "BADSYM",
      [{ source: "brokerage", price: 100, observedAt: at(1) }],
      { use: "quote", assetClass: "equity", now: NOW }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusal.reason).toBe("circuit_open");
  });

  it("half-opens after the cooldown so a recovered feed can return", () => {
    for (let i = 0; i < 5; i++) recordOracleFailure("BADSYM", NOW);
    expect(circuitOpen("BADSYM", NOW)).toBe(true);
    expect(circuitOpen("BADSYM", NOW + 61_000)).toBe(false);
  });

  it("resets on a success", () => {
    for (let i = 0; i < 4; i++) recordOracleFailure("NVDA", NOW);
    const good = priceFor(
      "NVDA",
      [{ source: "brokerage", price: 214.72, observedAt: at(1) }],
      { use: "quote", assetClass: "equity", now: NOW }
    );
    expect(good.ok).toBe(true);
    // A later burst starts from zero rather than tipping straight over.
    recordOracleFailure("NVDA", NOW);
    expect(circuitOpen("NVDA", NOW)).toBe(false);
  });

  it("is per symbol, not global", () => {
    for (let i = 0; i < 5; i++) recordOracleFailure("BADSYM", NOW);
    expect(circuitOpen("BADSYM", NOW)).toBe(true);
    expect(circuitOpen("NVDA", NOW)).toBe(false);
  });
});
