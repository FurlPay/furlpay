import { describe, it, expect } from "vitest";
import { summariseDestination, formatCount } from "../destinationSummary";

// A destination card is the easiest surface in the product to quietly inflate:
// "1,240+ Hotels" reads the same whether it was counted or invented, and only
// one of those survives a reader clicking through. These tests are mostly about
// what the summary REFUSES to state.

const DUBAI = { minLat: 24.9, maxLat: 25.4, minLng: 55.0, maxLng: 55.5 };
const LONDON = { minLat: 51.4, maxLat: 51.6, minLng: -0.25, maxLng: 0.05 };
/** Open ocean. There is nothing here and the summary must say so. */
const EMPTY = { minLat: -40, maxLat: -39, minLng: -130, maxLng: -129 };

describe("counts are counted, not estimated", () => {
  it("adds up to the total, with nothing double-counted", () => {
    const s = summariseDestination(DUBAI);
    const { hotels, resorts, villas, other } = s.counts;
    expect(hotels + resorts + villas + other).toBe(s.total);
    expect(s.total).toBeGreaterThan(0);
  });

  it("reports a real city as populated", () => {
    expect(summariseDestination(LONDON).total).toBeGreaterThan(100);
  });

  it("reports empty ocean as empty rather than inventing a floor", () => {
    const s = summariseDestination(EMPTY);
    expect(s.total).toBe(0);
    expect(s.rating).toBeNull();
    expect(s.top).toEqual([]);
    expect(s.photoCoverage).toBe(0);
  });
});

describe("the price is absent, and stays absent", () => {
  it("never invents a nightly price", () => {
    // priceLevel is populated on 29 of 16,014 properties and is a 1-4 bucket,
    // not a currency amount. Live rates need a provider production does not
    // currently have a real token for. So there is no honest value to print.
    for (const box of [DUBAI, LONDON, EMPTY]) {
      expect(summariseDestination(box).fromPrice).toBeNull();
    }
  });
});

describe("the rating carries its own denominator", () => {
  it("returns how many properties the mean was taken over", () => {
    // A 4.8 across 12 rated properties out of 400 is not the destination's
    // rating. The caller needs the denominator to decide whether to show it.
    const s = summariseDestination(DUBAI);
    expect(s.rating).not.toBeNull();
    expect(s.rating!.over).toBeGreaterThan(0);
    expect(s.rating!.over).toBeLessThanOrEqual(s.total);
    expect(s.rating!.mean).toBeGreaterThan(1);
    expect(s.rating!.mean).toBeLessThanOrEqual(5);
  });
});

describe("top properties are ranked by evidence, not just by score", () => {
  it("only offers properties that actually have a rating", () => {
    for (const p of summariseDestination(LONDON).top) {
      expect(typeof p.rating).toBe("number");
    }
  });

  it("does not let a 5.0 with a handful of reviews outrank a well-reviewed 4.6", () => {
    // The failure this prevents: a destination card fronted by an unknown
    // property with three reviews, because 5.0 sorts above 4.6.
    const top = summariseDestination(LONDON, 5).top;
    expect(top.length).toBeGreaterThan(1);
    const counts = top.map((p) => p.ratingCount ?? 0);
    // Every headline property should rest on more than a token number of
    // reviews once the log-weighting has done its job.
    expect(Math.min(...counts)).toBeGreaterThan(20);
  });

  it("returns at most the number asked for", () => {
    expect(summariseDestination(LONDON, 3).top.length).toBeLessThanOrEqual(3);
  });
});

describe("formatCount", () => {
  it('only writes "+" when the number really is a floor', () => {
    // A "+" on a complete count is a small lie that makes every other number
    // on the card less believable.
    expect(formatCount(1240, true)).toBe("1,240+");
    expect(formatCount(1240, false)).toBe("1,240");
    expect(formatCount(7)).toBe("7");
  });
});
