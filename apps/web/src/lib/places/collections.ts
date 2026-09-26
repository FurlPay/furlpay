import type { GooglePlace } from "@/lib/hotels/googlePlaces";
import { LUXURY_MAP_CATEGORIES, type LuxuryCategoryId } from "@/lib/hotels/luxuryTiers";

// ---------------------------------------------------------------------------
// Collection rules.
//
// THE HONESTY PROBLEM THIS SOLVES
// ===============================
// "5-star Ultra Luxury", "Michelin Dining" and "Pay with USDC" are not Google
// Place types. Google has no such concepts. Presenting them as though it does
// would be inventing an attribute and attaching a brand's authority to it.
//
// So every collection declares WHERE its answer comes from:
//
//   observed  — derived from fields Google actually returned
//   editorial — FurlPay's own classification, ours to defend
//   furlpay   — FurlPay's verified commercial data, not inferable from a map
//
// A collection whose basis cannot be satisfied does not silently return
// nothing: `evaluate` returns `unavailable`, and the UI disables the pill and
// says why. An empty result and an unanswerable question look identical in a
// list, and only one of them is the product working correctly.
//
// Rules receive the place plus whatever side-channel data the caller has
// resolved. They never receive hotel names baked into this file.
// ---------------------------------------------------------------------------

export type CollectionId = LuxuryCategoryId;

/** Side-channel facts a rule may consult, none of which come from Google. */
export interface CollectionContext {
  /** FurlPay's verified payment capability, keyed by place id. */
  acceptsUsdc?: boolean;
  /** True when a Michelin source has been consulted for this place. */
  michelinResolved?: boolean;
  michelinStarred?: boolean;
}

export type Verdict = "in" | "out" | "unavailable";

export interface CollectionRule {
  id: CollectionId;
  label: string;
  basis: "observed" | "editorial" | "furlpay";
  /** Google place types this collection can apply to at all. */
  appliesToTypes: readonly string[];
  /** Why it is unavailable, when it is. Shown in the UI verbatim. */
  unavailableReason?: string;
  evaluate(place: GooglePlace, ctx: CollectionContext): Verdict;
}

const LODGING = ["hotel", "resort_hotel", "extended_stay_hotel", "bed_and_breakfast", "guest_house", "motel"] as const;
const DINING = ["restaurant", "fine_dining_restaurant"] as const;

const has = (p: GooglePlace, ...t: string[]) => t.some((x) => p.types.includes(x) || p.primaryType === x);

/**
 * Name/summary signal.
 *
 * Deliberately narrow, and deliberately only ever used for `editorial`
 * collections. Matching words in a name is a heuristic about branding, not a
 * measurement of the property, and labelling it `observed` would overstate it.
 */
const mentions = (p: GooglePlace, words: readonly string[]) => {
  const hay = `${p.name} ${p.editorialSummary ?? ""}`.toLowerCase();
  return words.some((w) => hay.includes(w));
};

const label = (id: CollectionId) =>
  LUXURY_MAP_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const COLLECTION_RULES: readonly CollectionRule[] = [
  {
    id: "ultra_luxury",
    label: label("ultra_luxury"),
    basis: "editorial",
    appliesToTypes: LODGING,
    // Rating is a guest-satisfaction signal, NOT an official star rating. A
    // high score plus a substantial sample is evidence of a well-regarded
    // property; it is not a hotel classification body's verdict, and the UI
    // must not present it as one.
    evaluate: (p) =>
      has(p, ...LODGING) && (p.rating ?? 0) >= 4.6 && (p.userRatingCount ?? 0) >= 200 ? "in" : "out",
  },
  {
    id: "boutique",
    label: label("boutique"),
    basis: "editorial",
    appliesToTypes: LODGING,
    evaluate: (p) => {
      if (!has(p, ...LODGING)) return "out";
      const small = (p.userRatingCount ?? 0) > 0 && (p.userRatingCount ?? 0) < 600;
      return small && mentions(p, ["boutique", "design", "house", "residence", "atelier"]) ? "in" : "out";
    },
  },
  {
    id: "overwater_villas",
    label: label("overwater_villas"),
    basis: "editorial",
    appliesToTypes: LODGING,
    evaluate: (p) =>
      has(p, ...LODGING) && mentions(p, ["overwater", "island", "lagoon", "atoll", "beach resort", "villa"]) ? "in" : "out",
  },
  {
    id: "alpine_chalets",
    label: label("alpine_chalets"),
    basis: "editorial",
    appliesToTypes: LODGING,
    evaluate: (p) =>
      has(p, ...LODGING) && mentions(p, ["chalet", "alpine", "ski", "mountain lodge", "piste"]) ? "in" : "out",
  },
  {
    id: "heritage_castles",
    label: label("heritage_castles"),
    basis: "editorial",
    appliesToTypes: LODGING,
    evaluate: (p) =>
      has(p, ...LODGING) && mentions(p, ["castle", "palace", "chateau", "château", "manor", "schloss"]) ? "in" : "out",
  },
  {
    id: "vineyard_wellness",
    label: label("vineyard_wellness"),
    basis: "editorial",
    appliesToTypes: LODGING,
    evaluate: (p) =>
      has(p, ...LODGING) && mentions(p, ["spa", "wellness", "vineyard", "winery", "thermal", "onsen"]) ? "in" : "out",
  },
  {
    id: "executive_suites",
    label: label("executive_suites"),
    basis: "editorial",
    appliesToTypes: LODGING,
    evaluate: (p) => {
      if (!has(p, ...LODGING)) return "out";
      const busy = (p.userRatingCount ?? 0) >= 400;
      return busy && mentions(p, ["business", "executive", "conference", "airport", "centre", "center", "tower"]) ? "in" : "out";
    },
  },
  {
    id: "michelin_dining",
    label: label("michelin_dining"),
    basis: "observed",
    appliesToTypes: DINING,
    unavailableReason:
      "Michelin status needs a Michelin source. Google ratings are guest reviews and cannot stand in for one.",
    // THE ONE THAT MUST NOT BE FAKED. A 4.8 on Google says diners liked it; it
    // says nothing about a Michelin inspector. Until a real Michelin feed is
    // wired in, this collection reports that it cannot answer.
    evaluate: (_p, ctx) => {
      if (!ctx.michelinResolved) return "unavailable";
      return ctx.michelinStarred ? "in" : "out";
    },
  },
  {
    id: "helipad_transit",
    label: label("helipad_transit"),
    basis: "editorial",
    appliesToTypes: LODGING,
    evaluate: (p) =>
      has(p, ...LODGING) && mentions(p, ["helipad", "heliport", "airport", "transit", "terminal"]) ? "in" : "out",
  },
  {
    id: "crypto_escrow",
    label: label("crypto_escrow"),
    basis: "furlpay",
    appliesToTypes: [...LODGING, ...DINING],
    unavailableReason: "USDC acceptance comes from FurlPay's verified merchant data, not from Google Maps.",
    // Never inferred. If FurlPay has not resolved this place, the honest
    // answer is that we do not know — not "no", which reads as a fact.
    evaluate: (_p, ctx) => {
      if (ctx.acceptsUsdc === undefined) return "unavailable";
      return ctx.acceptsUsdc ? "in" : "out";
    },
  },
] as const;

export function ruleFor(id: CollectionId): CollectionRule | undefined {
  return COLLECTION_RULES.find((r) => r.id === id);
}

/**
 * Does a place satisfy every selected collection?
 *
 * `unavailable` excludes the place, because a filter the system cannot
 * evaluate must not quietly pass everything through — that would show the
 * user a "Michelin" list that is really an unfiltered list.
 */
export function matchesCollections(
  place: GooglePlace,
  selected: readonly CollectionId[],
  ctx: CollectionContext
): boolean {
  if (selected.length === 0) return true;
  return selected.every((id) => ruleFor(id)?.evaluate(place, ctx) === "in");
}
