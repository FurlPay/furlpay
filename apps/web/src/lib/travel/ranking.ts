// ---------------------------------------------------------------------------
// Stay ranking.
//
// THE BUG AT THE HEART OF MOST HOTEL RANKINGS is the raw average rating. A
// property with 5.0 from two reviews outranks one with 4.6 from three thousand,
// because an average carries no information about how much evidence is behind
// it. On a travel marketplace that is not a cosmetic flaw: a brand-new listing
// with two friendly reviews is exactly what a fraudulent one looks like, so the
// naive sort actively promotes the worst inventory.
//
// The fix is a Bayesian shrinkage — pull every rating toward the global mean in
// proportion to how little evidence supports it. A 5.0 from two reviews lands
// near the mean; a 4.6 from three thousand barely moves. This is the standard
// treatment for exactly this problem and it is the single biggest quality win
// available in hotel ranking.
//
// FOUR SIGNALS, COMBINED MULTIPLICATIVELY:
//
//   QUALITY   the shrunk rating, normalised
//   VALUE     effective price against the local median — after cashback,
//             because that is what the traveller actually pays
//   TRUST     the property-intelligence weight (see lib/property)
//   FIT       how well the property matches what was asked for
//
// Multiplicative, not additive: a zero in any one of them should sink the
// result. An untrustworthy property at a great price is not a great result, and
// an additive score lets a strong price buy its way past a trust problem.
//
// WHAT THIS DELIBERATELY DOES NOT DO: paid placement. There is no field here a
// supplier can pay to move, and adding one later would have to be visible in
// this file rather than hidden in a weight.
// ---------------------------------------------------------------------------

import type { Stay } from "./data";
import { CASHBACK_RATE } from "./data";

/**
 * Prior strength for the Bayesian shrinkage, in reviews.
 *
 * Read it as: a property is treated as though it began with 50 reviews at the
 * global mean. A property with 50 real reviews is therefore pulled halfway to
 * the mean; one with 500 is pulled about a tenth of the way. Chosen so that a
 * handful of reviews cannot manufacture a top ranking, while a few hundred —
 * which is genuine evidence — is largely trusted.
 */
export const REVIEW_PRIOR = 50;

/** Fallback global mean when a result set is too small to estimate one. */
export const DEFAULT_MEAN_RATING = 4.2;

/**
 * A rating adjusted for how much evidence supports it.
 *
 *     adjusted = (prior * mean + reviews * rating) / (prior + reviews)
 *
 * The whole point of the ranking. Without it, two reviews outrank three
 * thousand.
 */
export function bayesianRating(rating: number, reviews: number, globalMean: number): number {
  if (!Number.isFinite(rating) || rating <= 0) return globalMean;
  const n = Number.isFinite(reviews) && reviews > 0 ? reviews : 0;
  return (REVIEW_PRIOR * globalMean + n * rating) / (REVIEW_PRIOR + n);
}

/** The review-weighted mean of a result set — the prior the shrinkage pulls to. */
export function globalMeanRating(stays: Pick<Stay, "rating" | "reviews">[]): number {
  let weight = 0;
  let total = 0;
  for (const s of stays) {
    if (!Number.isFinite(s.rating) || s.rating <= 0) continue;
    const n = Math.max(1, s.reviews || 1);
    total += s.rating * n;
    weight += n;
  }
  return weight > 0 ? total / weight : DEFAULT_MEAN_RATING;
}

/**
 * What the traveller actually pays, per night, after cashback.
 *
 * Ranking on the list price ranks on a number nobody pays. Cashback is a real
 * reduction in cost and belongs in the value comparison — it is also the thing
 * that differentiates booking here, so hiding it from the ranking would be
 * ranking as though the product had no advantage.
 */
export function effectiveNightly(nightlyUsd: number): number {
  return nightlyUsd * (1 - CASHBACK_RATE);
}

/** Median of a numeric sample. Median, not mean — one absurd rate should not
 *  move the baseline the whole set is judged against. */
export function median(values: number[]): number {
  const sample = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sample.length) return 0;
  const mid = Math.floor(sample.length / 2);
  return sample.length % 2 === 0 ? (sample[mid - 1] + sample[mid]) / 2 : sample[mid];
}

export interface RankingPreferences {
  /** What the traveller said they wanted to spend per night. */
  maxNightlyUsd?: number;
  minStars?: number;
  /** Amenities they asked for; each match improves fit. */
  amenities?: string[];
  /** True when they said cancellation flexibility matters. */
  needsFreeCancellation?: boolean;
  /**
   * How much price should matter relative to quality, 0-1.
   *
   * 0.5 by default — neither a pure price sort nor a pure quality sort. A pure
   * price sort surfaces the cheapest, which is where fraudulent listings live;
   * a pure quality sort ignores what the traveller can afford.
   */
  priceWeight?: number;
}

export interface RankedStay {
  stay: Stay;
  score: number;
  components: {
    quality: number;
    value: number;
    trust: number;
    fit: number;
  };
  /** The rating after shrinkage — worth surfacing, since it differs from the
   *  number on the card and a reader may wonder why the order looks unusual. */
  adjustedRating: number;
  effectiveNightlyUsd: number;
}

/**
 * Rank a set of stays.
 *
 * `trustWeight` comes from lib/property/intelligence — passed in rather than
 * imported so this module stays pure and testable, and so ranking never
 * triggers a network call.
 */
export function rankStays(
  stays: Stay[],
  opts: {
    preferences?: RankingPreferences;
    trustWeight?: (stayId: string) => number;
  } = {}
): RankedStay[] {
  if (!stays.length) return [];

  const prefs = opts.preferences ?? {};
  const priceWeight = clamp(prefs.priceWeight ?? 0.5, 0, 1);
  const mean = globalMeanRating(stays);
  const medianNightly = median(stays.map((s) => effectiveNightly(s.nightlyUsd)));

  const ranked = stays.map((stay) => {
    const adjustedRating = bayesianRating(stay.rating, stay.reviews, mean);
    const effective = effectiveNightly(stay.nightlyUsd);

    // ---- Quality: the shrunk rating on 0-1 --------------------------------
    const quality = clamp(adjustedRating / 5, 0, 1);

    // ---- Value: price against the local median ---------------------------
    const value = valueScore(effective, medianNightly);

    // ---- Trust ------------------------------------------------------------
    // Normalised from the property-intelligence weight (0 to ~1.15) onto a
    // 0-1 multiplier where an unassessed property is neutral rather than
    // penalised — most of the world has no registry to check against.
    const rawTrust = opts.trustWeight?.(stay.id) ?? 1;
    const trust = clamp(rawTrust / 1.15, 0, 1);

    // ---- Fit --------------------------------------------------------------
    const fit = fitScore(stay, prefs);

    // Multiplicative: a zero anywhere sinks the result. An untrustworthy
    // property at a great price is not a great result.
    const score =
      Math.pow(quality, 1 - priceWeight) *
      Math.pow(value, priceWeight) *
      trust *
      fit;

    return {
      stay,
      score,
      components: { quality, value, trust, fit },
      adjustedRating,
      effectiveNightlyUsd: round2(effective),
    };
  });

  // Deterministic total order: score, then adjusted rating, then id. Without
  // the final tie-break two equal properties swap places between requests and
  // a reloaded page reshuffles for no reason.
  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.adjustedRating !== a.adjustedRating) return b.adjustedRating - a.adjustedRating;
    return a.stay.id.localeCompare(b.stay.id);
  });
}

/**
 * Where a price sits below which extra cheapness stops being a virtue.
 *
 * Matches the fraud threshold in lib/property/intelligence: a rate under 35%
 * of the local median is flagged as a possible fraudulent listing rather than
 * a bargain. The ranking must not reward what the trust layer is warning about.
 */
export const SUSPICIOUS_RATIO = 0.35;
/** Below this, the value score stops improving. */
export const VALUE_SATURATION_RATIO = 0.5;

/**
 * The value curve.
 *
 * A first attempt used `1 / (1 + price/median)`, which keeps rewarding
 * cheapness without limit — a $12 listing against a $150 median scored 0.93
 * and won the ranking outright, which is precisely the behaviour that makes a
 * cheapest-first sort promote fraudulent inventory. Caught by a test.
 *
 * The curve now has three regions:
 *
 *   ABOVE MEDIAN      diminishing score as price rises. Ordinary.
 *   MODERATE DISCOUNT rewarded up to the saturation point, which is where a
 *                     genuine deal lives.
 *   IMPLAUSIBLE       score DECLINES. Below 35% of the local median the trust
 *                     layer treats a rate as a fraud signal, and a ranking
 *                     that kept promoting it would be fighting its own
 *                     fraud detection.
 */
export function valueScore(effectivePrice: number, medianPrice: number): number {
  if (!(medianPrice > 0) || !(effectivePrice > 0)) return 0.5;
  const ratio = effectivePrice / medianPrice;

  if (ratio >= VALUE_SATURATION_RATIO) {
    // 1.0 at half the median, 0.5 at the median, tailing off above it.
    return clamp(1 / (0.5 + ratio), 0, 1);
  }

  // Below saturation the score falls away, reaching the same value an
  // at-median price would get by the time the rate is implausible.
  const belowSaturation = (VALUE_SATURATION_RATIO - ratio) / VALUE_SATURATION_RATIO;
  const peak = 1 / (0.5 + VALUE_SATURATION_RATIO);
  return clamp(peak * (1 - belowSaturation * 0.75), 0, 1);
}

/**
 * How well a property matches what was asked for.
 *
 * A soft penalty rather than a filter. Someone who says "$150 max" and is shown
 * nothing at $155 has been failed by the interface, not served by it — but the
 * $155 property should still rank below the $140 one.
 */
function fitScore(stay: Stay, prefs: RankingPreferences): number {
  let fit = 1;

  if (prefs.maxNightlyUsd && stay.nightlyUsd > prefs.maxNightlyUsd) {
    const over = stay.nightlyUsd / prefs.maxNightlyUsd;
    // 20% over budget keeps most of its score; double budget loses most of it.
    fit *= clamp(1 / over ** 2, 0.05, 1);
  }

  if (prefs.minStars && stay.stars < prefs.minStars) {
    fit *= clamp(1 - (prefs.minStars - stay.stars) * 0.25, 0.1, 1);
  }

  if (prefs.needsFreeCancellation && !stay.freeCancellation) {
    // A hard requirement in practice — someone who needs flexibility cannot
    // use a non-refundable rate — but not a filter, so it stays visible.
    fit *= 0.4;
  }

  if (prefs.amenities?.length) {
    const have = new Set(stay.amenities.map((a) => a.toLowerCase()));
    const matched = prefs.amenities.filter((a) => have.has(a.toLowerCase())).length;
    fit *= 0.6 + 0.4 * (matched / prefs.amenities.length);
  }

  return clamp(fit, 0, 1);
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Why this property ranked where it did.
 *
 * Exported so the UI can explain an order that will sometimes look wrong to a
 * reader — a 4.4 above a 4.9 is correct when the 4.9 has eleven reviews, and
 * saying so is what makes the ranking trustworthy rather than arbitrary.
 */
export function explainRanking(ranked: RankedStay): string[] {
  const reasons: string[] = [];
  const { components: c, stay, adjustedRating } = ranked;

  if (stay.reviews < REVIEW_PRIOR && stay.rating > adjustedRating + 0.15) {
    reasons.push(
      `Rated ${stay.rating.toFixed(1)} from only ${stay.reviews} reviews — scored as ` +
        `${adjustedRating.toFixed(1)} until more guests have stayed.`
    );
  }
  if (c.value > 0.55) reasons.push("Priced below comparable stays here.");
  if (c.trust >= 1) reasons.push("Property registration verified.");
  else if (c.trust < 0.6) reasons.push("Limited verification available for this property.");
  if (c.fit < 0.8) reasons.push("Does not match every filter you set.");

  return reasons;
}
