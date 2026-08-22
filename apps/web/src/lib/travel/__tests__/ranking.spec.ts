import { describe, it, expect } from "vitest";
import {
  bayesianRating,
  effectiveNightly,
  explainRanking,
  globalMeanRating,
  median,
  rankStays,
  REVIEW_PRIOR,
} from "../ranking";
import type { Stay } from "../data";

describe("value curve", () => {
  it("peaks at a genuine discount and DECLINES below the fraud threshold", async () => {
    const { valueScore, VALUE_SATURATION_RATIO } = await import("../ranking");
    const median = 150;
    const atMedian = valueScore(median, median);
    const goodDeal = valueScore(median * VALUE_SATURATION_RATIO, median);
    const implausible = valueScore(median * 0.1, median);

    expect(goodDeal).toBeGreaterThan(atMedian);
    // The fix: extra cheapness past the saturation point stops helping and
    // starts hurting, so the ranking does not fight its own fraud detection.
    expect(implausible).toBeLessThan(goodDeal);
  });

  it("scores an expensive property below an at-median one", async () => {
    const { valueScore } = await import("../ranking");
    expect(valueScore(400, 150)).toBeLessThan(valueScore(150, 150));
  });
});

// ---------------------------------------------------------------------------
// Stay ranking.
//
// The headline test is the first one: a 5.0 from two reviews must not outrank a
// 4.6 from three thousand. That single behaviour is what separates a ranking
// that promotes fraudulent new listings from one that does not.
// ---------------------------------------------------------------------------

function stay(over: Partial<Stay> & { id: string }): Stay {
  return {
    name: `Hotel ${over.id}`,
    brand: "Independent",
    city: "Tokyo",
    country: "Japan",
    type: "Hotel",
    stars: 4,
    rating: 4.2,
    reviews: 200,
    nightlyUsd: 150,
    image: "grad-1",
    amenities: ["WiFi", "Pool"],
    roomsLeft: 5,
    freeCancellation: true,
    eco: false,
    ...over,
  };
}

describe("bayesian rating", () => {
  it("pulls a rating with little evidence toward the mean", () => {
    // The core of the whole file. 5.0 from 2 reviews is not evidence of a
    // 5.0 property.
    const thin = bayesianRating(5.0, 2, 4.2);
    expect(thin).toBeLessThan(4.35);
    expect(thin).toBeGreaterThan(4.2);
  });

  it("barely moves a rating with a lot of evidence", () => {
    const thick = bayesianRating(4.6, 3000, 4.2);
    expect(thick).toBeGreaterThan(4.58);
  });

  it("pulls a low rating UP as well as a high one down", () => {
    // Symmetric by construction. One angry review is not evidence either.
    expect(bayesianRating(1.0, 2, 4.2)).toBeGreaterThan(3.9);
  });

  it("moves a rating halfway at exactly the prior's worth of reviews", () => {
    const r = bayesianRating(5.0, REVIEW_PRIOR, 4.0);
    expect(r).toBeCloseTo(4.5, 5);
  });

  it("returns the mean for a property with no rating at all", () => {
    expect(bayesianRating(0, 0, 4.2)).toBe(4.2);
    expect(bayesianRating(NaN, 100, 4.2)).toBe(4.2);
  });
});

describe("the headline case", () => {
  it("does NOT let 5.0-from-2-reviews outrank 4.6-from-3000", () => {
    // A brand-new listing with two friendly reviews is exactly what a
    // fraudulent one looks like. A raw-average sort promotes it.
    const shiny = stay({ id: "shiny", rating: 5.0, reviews: 2, nightlyUsd: 150 });
    const proven = stay({ id: "proven", rating: 4.6, reviews: 3000, nightlyUsd: 150 });
    const filler = Array.from({ length: 8 }, (_, i) =>
      stay({ id: `f${i}`, rating: 4.2, reviews: 300, nightlyUsd: 150 })
    );

    const ranked = rankStays([shiny, proven, ...filler]);
    const order = ranked.map((r) => r.stay.id);
    expect(order.indexOf("proven")).toBeLessThan(order.indexOf("shiny"));
  });

  it("still ranks a genuinely excellent, well-reviewed property first", () => {
    const great = stay({ id: "great", rating: 4.9, reviews: 5000 });
    const ok = stay({ id: "ok", rating: 4.0, reviews: 5000 });
    const ranked = rankStays([ok, great]);
    expect(ranked[0].stay.id).toBe("great");
  });
});

describe("value", () => {
  it("ranks on the price after cashback, not the list price", () => {
    // Ranking on a number nobody pays is ranking on the wrong number.
    expect(effectiveNightly(100)).toBeCloseTo(98);
  });

  it("prefers a cheaper property when quality is equal", () => {
    const cheap = stay({ id: "cheap", nightlyUsd: 100 });
    const dear = stay({ id: "dear", nightlyUsd: 300 });
    const ranked = rankStays([dear, cheap]);
    expect(ranked[0].stay.id).toBe("cheap");
  });

  it("does not let cheapness alone dominate", () => {
    // The behaviour that makes a cheapest-first sort promote scams: the value
    // curve flattens, so a very low price cannot run away with the ranking.
    const suspicious = stay({ id: "cheap", nightlyUsd: 12, rating: 5.0, reviews: 3 });
    const solid = stay({ id: "solid", nightlyUsd: 160, rating: 4.7, reviews: 2000 });
    const filler = Array.from({ length: 8 }, (_, i) =>
      stay({ id: `f${i}`, nightlyUsd: 150, rating: 4.3, reviews: 400 })
    );
    const ranked = rankStays([suspicious, solid, ...filler]);
    const order = ranked.map((r) => r.stay.id);
    expect(order.indexOf("solid")).toBeLessThan(order.indexOf("cheap"));
  });

  it("respects an explicit price preference", () => {
    const cheap = stay({ id: "cheap", nightlyUsd: 90, rating: 4.0, reviews: 500 });
    const nice = stay({ id: "nice", nightlyUsd: 250, rating: 4.8, reviews: 500 });

    const priceFirst = rankStays([cheap, nice], { preferences: { priceWeight: 0.95 } });
    expect(priceFirst[0].stay.id).toBe("cheap");

    const qualityFirst = rankStays([cheap, nice], { preferences: { priceWeight: 0.05 } });
    expect(qualityFirst[0].stay.id).toBe("nice");
  });
});

describe("trust", () => {
  it("sinks a property the trust layer distrusts", () => {
    const suspect = stay({ id: "suspect", rating: 4.9, reviews: 2000, nightlyUsd: 100 });
    const plain = stay({ id: "plain", rating: 4.3, reviews: 2000, nightlyUsd: 150 });
    const ranked = rankStays([suspect, plain], {
      trustWeight: (id) => (id === "suspect" ? 0.5 : 1),
    });
    expect(ranked[0].stay.id).toBe("plain");
  });

  it("removes a suppressed property from contention entirely", () => {
    // Multiplicative scoring: a zero anywhere sinks the result.
    const banned = stay({ id: "banned", rating: 5, reviews: 9999, nightlyUsd: 1 });
    const normal = stay({ id: "normal" });
    const ranked = rankStays([banned, normal], {
      trustWeight: (id) => (id === "banned" ? 0 : 1),
    });
    expect(ranked[ranked.length - 1].stay.id).toBe("banned");
    expect(ranked.find((r) => r.stay.id === "banned")?.score).toBe(0);
  });

  it("does not penalise an unassessed property", () => {
    // Most of the world has no registry. Treating "unknown" as "bad" would
    // demote everything outside a few jurisdictions.
    const a = stay({ id: "a" });
    const b = stay({ id: "b" });
    const withWeights = rankStays([a, b], { trustWeight: () => 1 });
    const without = rankStays([a, b]);
    expect(withWeights[0].score).toBeCloseTo(without[0].score, 6);
  });
});

describe("fit", () => {
  it("softly penalises over-budget rather than hiding it", () => {
    // Someone told "$150 max" and shown nothing at $155 has been failed by the
    // interface.
    const ranked = rankStays(
      [stay({ id: "over", nightlyUsd: 155 }), stay({ id: "under", nightlyUsd: 140 })],
      { preferences: { maxNightlyUsd: 150 } }
    );
    expect(ranked.map((r) => r.stay.id)).toEqual(["under", "over"]);
    // Still present, not filtered away.
    expect(ranked).toHaveLength(2);
  });

  it("penalises a non-refundable rate when flexibility was required", () => {
    const rigid = stay({ id: "rigid", freeCancellation: false, rating: 4.8, reviews: 1000 });
    const flex = stay({ id: "flex", freeCancellation: true, rating: 4.3, reviews: 1000 });
    const ranked = rankStays([rigid, flex], { preferences: { needsFreeCancellation: true } });
    expect(ranked[0].stay.id).toBe("flex");
  });

  it("rewards matching the requested amenities", () => {
    const has = stay({ id: "has", amenities: ["WiFi", "Gym", "Pool"] });
    const lacks = stay({ id: "lacks", amenities: ["WiFi"] });
    const ranked = rankStays([lacks, has], { preferences: { amenities: ["Gym", "Pool"] } });
    expect(ranked[0].stay.id).toBe("has");
  });
});

describe("determinism", () => {
  it("produces the same order every time", () => {
    const set = Array.from({ length: 20 }, (_, i) =>
      stay({ id: `s${i}`, rating: 4 + (i % 5) * 0.2, reviews: 100 * (i % 7), nightlyUsd: 100 + i * 10 })
    );
    const a = rankStays(set).map((r) => r.stay.id);
    const b = rankStays([...set].reverse()).map((r) => r.stay.id);
    expect(a).toEqual(b);
  });

  it("breaks an exact tie on id so a reload does not reshuffle", () => {
    const a = stay({ id: "aaa" });
    const b = stay({ id: "bbb" });
    expect(rankStays([b, a]).map((r) => r.stay.id)).toEqual(["aaa", "bbb"]);
  });

  it("handles an empty set", () => {
    expect(rankStays([])).toEqual([]);
  });
});

describe("helpers", () => {
  it("computes a review-weighted global mean", () => {
    const mean = globalMeanRating([
      { rating: 5.0, reviews: 1 },
      { rating: 4.0, reviews: 999 },
    ]);
    // Dominated by the well-reviewed property, as it should be.
    expect(mean).toBeLessThan(4.01);
  });

  it("uses the median, so one absurd rate cannot move the baseline", () => {
    expect(median([100, 110, 120, 130, 99999])).toBe(120);
    expect(median([])).toBe(0);
  });
});

describe("explanations", () => {
  it("explains why a high raw rating ranked low", () => {
    // The order will sometimes look wrong to a reader. Saying why is what
    // makes it trustworthy rather than arbitrary.
    //
    // Needs a real peer set: with ONE stay the global mean IS that stay, so
    // the shrinkage has nothing to pull toward and correctly does nothing.
    const peers = Array.from({ length: 10 }, (_, i) =>
      stay({ id: `p${i}`, rating: 4.2, reviews: 800 })
    );
    const ranked = rankStays([stay({ id: "thin", rating: 5.0, reviews: 3 }), ...peers]);
    const thin = ranked.find((r) => r.stay.id === "thin")!;
    expect(thin.adjustedRating).toBeLessThan(4.5);
    expect(explainRanking(thin).some((r) => /only 3 reviews/.test(r))).toBe(true);
  });

  it("says nothing misleading about a well-reviewed property", () => {
    const peers = Array.from({ length: 10 }, (_, i) =>
      stay({ id: `p${i}`, rating: 4.2, reviews: 800 })
    );
    const ranked = rankStays([stay({ id: "solid", rating: 4.5, reviews: 5000 }), ...peers]);
    const solid = ranked.find((r) => r.stay.id === "solid")!;
    expect(explainRanking(solid).some((r) => /reviews/.test(r))).toBe(false);
  });
});
