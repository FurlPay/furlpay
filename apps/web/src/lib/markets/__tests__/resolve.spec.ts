import { describe, expect, it } from "vitest";
import { isPlausibleTicker, isLocallyKnown } from "../resolve";

// ---------------------------------------------------------------------------
// The guard between a URL path segment and an outbound request.
//
// `/markets/[symbol]` takes whatever is in the URL and, when no local tier
// knows it, puts it in a request to a third party. That makes this regex a
// security boundary rather than a formatting nicety, so it is an allowlist of
// what a ticker can contain rather than a filter for what it cannot.
//
// It also caps how far a crawler can push: anything rejected here never becomes
// an upstream call, and anything accepted has its answer — including "no such
// symbol" — cached.
// ---------------------------------------------------------------------------

describe("isPlausibleTicker", () => {
  it("accepts the shapes real tickers take", () => {
    for (const t of ["A", "AA", "AAPL", "GOOGL", "BRK.B", "ALL.PRB", "AMPX.WS", "BTC-USD", "ALUB.U"]) {
      expect(isPlausibleTicker(t), t).toBe(true);
    }
  });

  it("rejects anything that could steer a request", () => {
    for (const t of [
      "../../etc/passwd",
      "AAPL/../MSFT",
      "AAPL?x=1",
      "AAPL&b=2",
      "AAPL#frag",
      "AAPL%2F",
      "http://evil.test",
      "//evil.test",
      "AAPL ",
      "AA PL",
      "",
    ]) {
      expect(isPlausibleTicker(t), t).toBe(false);
    }
  });

  it("rejects an index, which this app cannot price or trade", () => {
    expect(isPlausibleTicker("^GSPC")).toBe(false);
    expect(isPlausibleTicker("^VIX")).toBe(false);
  });

  it("bounds the length in both directions", () => {
    expect(isPlausibleTicker("TOOLONGSYMBOLNAME")).toBe(false);
    expect(isPlausibleTicker("ABCDEFGHI")).toBe(false); // 9 chars, over the cap
    expect(isPlausibleTicker("ABCDEFGH")).toBe(true); // 8 is the cap
  });

  it("allows only one suffix group", () => {
    expect(isPlausibleTicker("BRK.B.C")).toBe(false);
    expect(isPlausibleTicker("A-B-C")).toBe(false);
  });

  it("is case-insensitive, since URLs are typed by hand", () => {
    expect(isPlausibleTicker("aapl")).toBe(true);
    expect(isPlausibleTicker("brk.b")).toBe(true);
  });
});

describe("isLocallyKnown", () => {
  it("is true for curated and for merely-tradable symbols", () => {
    expect(isLocallyKnown("AAPL")).toBe(true); // curated
    expect(isLocallyKnown("AA")).toBe(true); // universe only
    expect(isLocallyKnown("BTC")).toBe(true); // catalog-only crypto
  });

  it("is false for a symbol no local tier carries", () => {
    // The online tier is what serves these, and it costs a network call — so
    // callers that must stay synchronous need to be able to ask first.
    expect(isLocallyKnown("NOTATICKER")).toBe(false);
  });
});
