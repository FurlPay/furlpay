// ---------------------------------------------------------------------------
// Attribute provenance: where a property fact came from, and what that permits.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Google's own documentation says hotel class ratings come from "third-party
// partners, direct research, feedback from hoteliers, and machine learning
// inference that examines and evaluates hotel attributes, such as price,
// location, room size, and amenities" — and nothing in the product tells you
// which of those produced the badge you are looking at. A guessed five-star
// rating and a verified one render identically.
//
// That is the gap this file exists to not fall into. Every attribute carries
// its source, and the type system makes a value without a source unspeakable:
// `Attributed<T>` has no constructor that omits it. You cannot accidentally
// state a fact we merely guessed, because there is no way to express one.
//
// ── THE RULE THE MONEY DEPENDS ON ──────────────────────────────────────────
// "This property accepts USDC" must never be inferred. Not from the property
// being bookable, not from FurlPay having a card rail that would settle the
// booking, not from another property in the same chain accepting it. Only our
// own settlement layer answering yes counts. Everything else is a different
// claim, and `paymentCapability` keeps those claims apart by name.
// ---------------------------------------------------------------------------

/**
 * Where an attribute came from, ordered weakest to strongest.
 *
 * The order is load-bearing: `atLeast()` compares against it, so inserting a
 * new source in the wrong place silently changes what may be shown as fact.
 */
export const SOURCE_RANK = [
  "unknown",
  "inferred",
  "derived",
  "provider_reported",
  "furlpay_curated",
  "provider_authoritative",
  "furlpay_settlement",
] as const;

export type AttributeSource = (typeof SOURCE_RANK)[number];

export const SOURCE_MEANING: Record<AttributeSource, string> = {
  unknown: "No source. The attribute is absent, not false.",
  inferred: "A model or heuristic guessed it. Ranking only — never a stated fact.",
  derived: "Computed from other attributes. Only as trustworthy as its weakest input.",
  provider_reported: "A data provider passed it through without vouching for it.",
  furlpay_curated: "A person at FurlPay checked it against a primary source.",
  provider_authoritative: "The property or its provider stated it directly.",
  furlpay_settlement: "Our own settlement layer answered. The only source we control end to end.",
};

/** A value that cannot exist without saying where it came from. */
export interface Attributed<T> {
  readonly value: T;
  readonly source: AttributeSource;
  /**
   * 0-1. Meaningful only relative to other attributes from the SAME source —
   * it is not a probability and must not be compared across sources or
   * multiplied with an orientation or query confidence.
   */
  readonly confidence: number;
  /** When the claim was established. Freshness is part of provenance. */
  readonly observedAt: string;
}

export function attributed<T>(
  value: T,
  source: AttributeSource,
  confidence: number,
  observedAt: string | Date = new Date()
): Attributed<T> {
  return {
    value,
    source,
    confidence: Math.max(0, Math.min(1, confidence)),
    observedAt: observedAt instanceof Date ? observedAt.toISOString() : observedAt,
  };
}

/** An absent attribute. Distinct from false, and it must stay distinct. */
export function unknownAttribute<T>(observedAt: string | Date = new Date()): Attributed<T | null> {
  return attributed<T | null>(null, "unknown", 0, observedAt);
}

function rank(source: AttributeSource): number {
  return SOURCE_RANK.indexOf(source);
}

export function atLeast(a: Attributed<unknown>, floor: AttributeSource): boolean {
  return rank(a.source) >= rank(floor);
}

// --- what a source permits --------------------------------------------------

/**
 * May this be shown to a reader as a plain statement of fact?
 *
 * Inferred and derived attributes may not. They can still be shown, but only
 * hedged — see `hedge()`. The distinction is the whole point of the file.
 */
export function canStateAsFact(a: Attributed<unknown>): boolean {
  return atLeast(a, "provider_reported");
}

/**
 * May this remove results from a list?
 *
 * A hard filter is destructive: a property excluded by a guess is a property
 * the reader never learns exists, and they cannot correct what they cannot
 * see. So filtering requires a source that was actually checked. Ranking is
 * different — being sorted lower is recoverable, being deleted is not.
 */
export function canHardFilter(a: Attributed<unknown>): boolean {
  return atLeast(a, "furlpay_curated");
}

/** May this influence ordering? Anything but a total absence of evidence. */
export function canRank(a: Attributed<unknown>): boolean {
  return a.source !== "unknown";
}

/**
 * How to say it out loud.
 *
 * Returns null when there is nothing honest to say, so a caller that renders
 * every non-null string cannot leak an unknown as a claim.
 */
export function hedge(a: Attributed<unknown>, claim: string): string | null {
  switch (a.source) {
    case "unknown":
      return null;
    case "inferred":
      return `${claim} (not verified)`;
    case "derived":
      return `${claim} (calculated)`;
    case "provider_reported":
    case "provider_authoritative":
      return `${claim} (per the property)`;
    case "furlpay_curated":
    case "furlpay_settlement":
      return claim;
  }
}

/**
 * Combine attributes into a derived one.
 *
 * The result is never stronger than its weakest input — this is the rule that
 * stops a chain of derivations laundering a guess into a fact. Two inferred
 * inputs cannot produce something statable, however confident the arithmetic.
 */
export function derive<T>(
  value: T,
  inputs: readonly Attributed<unknown>[],
  confidence: number
): Attributed<T> {
  if (!inputs.length) return attributed(value, "unknown", 0);
  const weakest = inputs.reduce((w, i) => (rank(i.source) < rank(w.source) ? i : w));
  // "derived" is a ceiling, not a promotion: a derivation from settlement data
  // is still only derived, because the arithmetic is ours and could be wrong.
  const source: AttributeSource =
    rank(weakest.source) < rank("derived") ? weakest.source : "derived";
  const floor = Math.min(confidence, ...inputs.map((i) => i.confidence));
  return attributed(value, source, floor);
}

// --- payment capability -----------------------------------------------------

/**
 * What a reader can actually pay with, kept as named states rather than a
 * boolean.
 *
 * A boolean `acceptsUsdc` invites exactly the mistake this guards against:
 * somebody sets it true because the booking would go through, which is a
 * statement about FurlPay's rails and not about the property. These states
 * cannot be confused because they are not the same word.
 */
export type PaymentCapability =
  /** The property settles in USDC. Established by our settlement layer. */
  | "verified_usdc"
  /** FurlPay can complete the booking, by some rail. Says nothing about USDC. */
  | "furlpay_settlement_available"
  /** Bookable by card only. */
  | "card_settlement_available"
  /** Checked, and it cannot be booked through us. */
  | "not_supported"
  /** Never checked. Not the same as "not_supported". */
  | "unknown";

export const PAYMENT_LABEL: Record<PaymentCapability, string> = {
  verified_usdc: "Pay with USDC",
  furlpay_settlement_available: "Bookable with FurlPay",
  card_settlement_available: "Card payment",
  not_supported: "Not bookable here",
  unknown: "Payment options unconfirmed",
};

/**
 * The only function permitted to answer "does this accept USDC?".
 *
 * Exactly one state qualifies, and it is the one our settlement layer produces.
 * `furlpay_settlement_available` deliberately returns false: FurlPay being able
 * to pay for something is a fact about FurlPay.
 */
export function acceptsUsdc(a: Attributed<PaymentCapability>): boolean {
  return a.value === "verified_usdc" && a.source === "furlpay_settlement";
}

/**
 * May a "Pay with USDC" filter exclude this property?
 *
 * Only when we actually checked and the answer was no. An unverified property
 * is hidden behind a "we could not confirm" affordance instead of being
 * deleted, because "we did not check" is not evidence of absence.
 */
export function excludedByUsdcFilter(a: Attributed<PaymentCapability>): boolean {
  return a.source === "furlpay_settlement" && a.value !== "verified_usdc";
}

// --- star ratings -----------------------------------------------------------

/**
 * A star rating with its origin attached.
 *
 * Named for the failure it prevents: Google's class ratings mix partner data,
 * direct research, hotelier feedback and machine-learning inference, and render
 * all four identically. A reader cannot tell a counted rating from a guessed
 * one. Ours has to say.
 */
export interface StarRating {
  readonly stars: Attributed<number | null>;
}

/**
 * May this property carry a "5-star" badge?
 *
 * The badge is a factual claim about a classification a real body awards, so an
 * inferred rating cannot earn it however luxurious the photographs look. This
 * is the specific case the brief called out.
 */
export function qualifiesForFiveStarBadge(r: StarRating): boolean {
  return r.stars.value === 5 && canStateAsFact(r.stars);
}
