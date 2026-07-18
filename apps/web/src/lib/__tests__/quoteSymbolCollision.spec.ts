import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/markets/catalog";
import { AMBIGUOUS_SYMBOLS, resolveQuote, quoteKey, type Quote } from "@/lib/markets/quotes";

// ---------------------------------------------------------------------------
// Regression: /api/markets/STX returned name "Stacks" (crypto) with price
// 786.60 — Seagate Technology's stock price. The quote cache was keyed by
// ticker alone, and the equities overlay ran after the crypto overlay, so the
// stock clobbered the coin. The bars endpoint disagreed (~$0.16), which is how
// the bug surfaced: a $786.60 headline above a $0.16 chart.
//
// Two colliding tickers exist in a 391-asset catalog: STX and DASH.
// ---------------------------------------------------------------------------

const q = (price: number): Quote => ({ price, changePct: 0, live: true });

describe("catalog ticker collisions", () => {
  it("detects exactly the known ambiguous tickers", () => {
    expect([...AMBIGUOUS_SYMBOLS].sort()).toEqual(["DASH", "STX"]);
  });

  it("each ambiguous ticker really is two different assets", () => {
    for (const sym of AMBIGUOUS_SYMBOLS) {
      const entries = CATALOG.filter((a) => a.symbol === sym);
      expect(entries.length).toBeGreaterThan(1);
      // Distinct asset classes is what makes the bare ticker meaningless.
      expect(new Set(entries.map((a) => a.kind)).size).toBeGreaterThan(1);
    }
  });
});

describe("quote lookup", () => {
  const seagate = CATALOG.find((a) => a.symbol === "STX" && a.kind === "stock")!;
  const stacks = CATALOG.find((a) => a.symbol === "STX" && a.kind === "crypto")!;

  it("keys the two STX assets separately", () => {
    expect(quoteKey(seagate)).toBe("stock:STX");
    expect(quoteKey(stacks)).toBe("crypto:STX");
    expect(quoteKey(seagate)).not.toBe(quoteKey(stacks));
  });

  it("returns each asset its OWN price — the actual bug", () => {
    const quotes = new Map<string, Quote>([
      [quoteKey(seagate), q(786.6)],
      [quoteKey(stacks), q(0.16433)],
    ]);
    expect(resolveQuote(quotes, seagate)?.price).toBe(786.6);
    // Previously this returned 786.6. Stacks is a ~$0.16 token.
    expect(resolveQuote(quotes, stacks)?.price).toBe(0.16433);
  });

  it("a later equities write cannot clobber the crypto entry", () => {
    const quotes = new Map<string, Quote>();
    quotes.set(quoteKey(stacks), q(0.16433));
    quotes.set(quoteKey(seagate), q(786.6)); // overlay order that caused the bug
    expect(resolveQuote(quotes, stacks)?.price).toBe(0.16433);
  });

  it("yields undefined (renders '—') rather than a wrong price for a bare ambiguous ticker", () => {
    // A bare "STX" alias must never exist; an unmigrated caller must fail
    // visibly instead of confidently showing the other asset's price.
    const quotes = new Map<string, Quote>([[quoteKey(seagate), q(786.6)]]);
    expect(quotes.get("STX")).toBeUndefined();
    expect(resolveQuote(quotes, stacks)).toBeUndefined();
  });

  it("still resolves unambiguous tickers through the bare alias", () => {
    const apple = CATALOG.find((a) => a.symbol === "AAPL")!;
    expect(AMBIGUOUS_SYMBOLS.has("AAPL")).toBe(false);
    // Legacy callers that pass only a symbol keep working for the other 389.
    const quotes = new Map<string, Quote>([["AAPL", q(333.75)]]);
    expect(resolveQuote(quotes, apple)?.price).toBe(333.75);
  });

  it("prefers the canonical key when both key forms are present", () => {
    const apple = CATALOG.find((a) => a.symbol === "AAPL")!;
    const quotes = new Map<string, Quote>([
      ["AAPL", q(1)],
      [quoteKey(apple), q(333.75)],
    ]);
    expect(resolveQuote(quotes, apple)?.price).toBe(333.75);
  });
});
