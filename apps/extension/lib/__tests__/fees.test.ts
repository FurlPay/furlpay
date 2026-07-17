import { describe, expect, it } from "vitest";
import { CHECKOUT_HINTS, compareFees, extractAmounts, pickTotal } from "../fees";

describe("compareFees — the money math on the pill", () => {
  it("computes card vs FurlPay fees for a $100 order", () => {
    const f = compareFees(100);
    expect(f.cardFee).toBeCloseTo(3.2); // 2.9% + $0.30
    expect(f.furlFee).toBeCloseTo(0.5); // 0.5%
    expect(f.saving).toBeCloseTo(2.7);
  });

  it("saving stays positive even for tiny totals (fixed fee dominates)", () => {
    expect(compareFees(1).saving).toBeGreaterThan(0);
  });
});

describe("extractAmounts", () => {
  it("parses $ and USD amounts with thousands separators", () => {
    const found = extractAmounts("Total: $1,234.56 or USD 99", "order total");
    expect(found.map((c) => c.value)).toEqual([1234.56, 99]);
    expect(found.every((c) => c.weighted)).toBe(true);
  });

  it("bounds-checks: rejects zero and >$100k", () => {
    expect(extractAmounts("$0.00 and $250,000.00", "total")).toEqual([]);
  });

  it("weighting comes from the surrounding context, not the node text", () => {
    const [c] = extractAmounts("$50.00", "Shipping fee");
    expect(c.weighted).toBe(false);
    const [t] = extractAmounts("$50.00", "Amount due today");
    expect(t.weighted).toBe(true);
  });
});

describe("pickTotal — selection heuristic", () => {
  it("prefers the largest 'total'-context amount over larger unlabelled ones", () => {
    expect(
      pickTotal([
        { value: 999, weighted: false }, // a random big number on the page
        { value: 120, weighted: true }, // the actual total
        { value: 80, weighted: true },
      ]),
    ).toBe(120);
  });

  it("falls back to the page maximum when nothing is labelled", () => {
    expect(
      pickTotal([
        { value: 12, weighted: false },
        { value: 60, weighted: false },
      ]),
    ).toBe(60);
  });

  it("returns null for an empty page", () => {
    expect(pickTotal([])).toBeNull();
  });
});

describe("CHECKOUT_HINTS gate", () => {
  it("matches checkout-looking URLs/titles and not ordinary pages", () => {
    for (const hit of ["https://shop.com/checkout", "Cart — Acme", "Complete your booking", "billing"]) {
      expect(CHECKOUT_HINTS.test(hit)).toBe(true);
    }
    for (const miss of ["https://news.site/article", "Weather today", "About us"]) {
      expect(CHECKOUT_HINTS.test(miss)).toBe(false);
    }
  });
});
