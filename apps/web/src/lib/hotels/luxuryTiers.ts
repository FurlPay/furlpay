// ---------------------------------------------------------------------------
// Luxury classification and the FurlPay L-Score.
//
// TWO KINDS OF INPUT, AND THE DIFFERENCE MATTERS.
//
//   1. EDITORIAL. The brand lists below are a curated taxonomy - a judgement
//      that Aman is positioned above Hampton Inn. That is an opinion FurlPay
//      owns and can defend, not a measurement, and it is labelled as such.
//
//   2. OBSERVED. Everything else is read off an OpenStreetMap tag that a mapper
//      actually recorded: stars, elevation, historic, spa, helipad. A property
//      earns those badges from data, never from a guess.
//
// The rule that keeps the two apart: when a tag is missing, the property simply
// does not get the badge. It is never inferred from the name, the price, or the
// neighbourhood. A "Michelin Dining" pin has to come from a michelin_stars tag,
// otherwise the badge would be decoration rather than information.
// ---------------------------------------------------------------------------

export type LuxuryCategoryId =
  | "ultra_luxury"
  | "boutique"
  | "overwater_villas"
  | "alpine_chalets"
  | "heritage_castles"
  | "vineyard_wellness"
  | "executive_suites"
  | "crypto_escrow"
  | "michelin_dining"
  | "helipad_transit";

export interface LuxuryCategory {
  id: LuxuryCategoryId;
  label: string;
  /**
   * Brand colour for this category. The ARTWORK is not here: an emoji is a font
   * glyph, so it renders as three different illustration styles across macOS,
   * Windows and Android and cannot take `currentColor`. The taxonomy stays
   * data; the icons live in components/travel/map/icons.tsx.
   */
  color: string;
  /** How membership is decided. Surfaced in the UI so a badge is never mistaken
   *  for a measurement it isn't. */
  basis: "observed" | "editorial" | "furlpay";
}

/** Filter pills, in the order they render. */
export const LUXURY_MAP_CATEGORIES: readonly LuxuryCategory[] = [
  { id: "ultra_luxury",      label: "5-star Ultra Luxury", color: "#B8860B", basis: "editorial" },
  { id: "boutique",          label: "Boutique Design", color: "#8B5CF6", basis: "editorial" },
  { id: "overwater_villas",  label: "Island & Overwater",  color: "#0E7490", basis: "editorial" },
  { id: "alpine_chalets",    label: "Alpine Chalets",  color: "#2563EB", basis: "observed" },
  { id: "heritage_castles",  label: "Castles & Palaces", color: "#9A3412", basis: "observed" },
  { id: "vineyard_wellness", label: "Wine & Wellness", color: "#1B7A4E", basis: "observed" },
  { id: "executive_suites",  label: "Business Executive", color: "#334155", basis: "editorial" },
  { id: "michelin_dining",   label: "Michelin Dining", color: "#C2410C", basis: "observed" },
  { id: "helipad_transit",   label: "Helipad & Transit", color: "#64748B", basis: "observed" },
  { id: "crypto_escrow",     label: "Pay with USDC",  color: "#0F766E", basis: "furlpay" },
] as const;

// --- Editorial brand taxonomy ------------------------------------------------
// Matched against the OSM `brand` / `operator` tag first, then the name. Entries
// are lowercase and diacritic-free to match normalizeName() output.

/** Prestige index feeding the L-Score, 0-100. Editorial by construction. */
export const BRAND_TIERS: Record<string, { tier: LuxuryCategoryId; prestige: number }> = {};

function register(tier: LuxuryCategoryId, prestige: number, brands: string[]) {
  for (const b of brands) BRAND_TIERS[b] = { tier, prestige };
}

register("ultra_luxury", 100, [
  "aman", "four seasons", "ritz-carlton", "ritz carlton", "st. regis", "st regis",
  "rosewood", "mandarin oriental", "belmond", "cheval blanc", "bulgari",
  "peninsula", "raffles", "oberoi", "taj", "dorchester", "waldorf astoria",
  "park hyatt", "burj al arab", "jumeirah", "shangri-la", "shangri la",
]);

register("boutique", 85, [
  "1 hotels", "1 hotel", "soho house", "edition", "ace hotel", "w hotels",
  "the standard", "standard hotels", "nobu", "andaz", "thompson", "kimpton",
  "sls", "mondrian", "hoxton", "citizenm", "25hours",
]);

register("overwater_villas", 90, [
  "soneva", "six senses", "banyan tree", "anantara", "conrad maldives",
  "velaa", "cheval blanc randheli", "kudadoo", "gili lankanfushi", "niyama",
]);

register("executive_suites", 70, [
  "marriott", "jw marriott", "grand hyatt", "hyatt regency", "hilton",
  "intercontinental", "westin", "sheraton", "conrad", "sofitel", "pullman",
  "radisson blu", "fairmont", "swissotel", "le meridien", "renaissance",
]);

// --- Observed classification from OSM tags -----------------------------------

/** Raw OSM tags for one property. */
export type OsmTags = Record<string, string | undefined>;

/** Elevation at which a hotel is genuinely an mountain property. 1000m is the
 *  conventional lower bound of the montane belt and sits below every major
 *  alpine resort (Zermatt 1608m, Courchevel 1850m, Aspen 2438m). */
const ALPINE_MIN_ELEVATION_M = 1000;

function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function truthy(raw: string | undefined): boolean {
  return raw === "yes" || raw === "true" || raw === "1";
}

/** OSM `stars` is free text: "5", "5S", "4.5". Unparseable becomes undefined
 *  rather than a guess. */
export function parseStars(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = String(raw).match(/^(\d(?:\.\d)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 5 ? n : undefined;
}

/** True when OSM recorded a "superior" rating (5S), the tier above plain 5. */
export function isSuperior(raw: string | undefined): boolean {
  return /^\s*5\s*S/i.test(raw ?? "");
}

/**
 * Match a property to an editorial brand. Checks the `brand` and `operator`
 * tags before the name, because a mapper who filled in `brand` was being
 * explicit, whereas a name match is inference.
 */
export function matchBrand(
  tags: OsmTags,
  name: string
): { brand: string; tier: LuxuryCategoryId; prestige: number } | null {
  const fold = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  for (const field of [tags.brand, tags.operator]) {
    if (!field) continue;
    const f = fold(field);
    const hit = BRAND_TIERS[f];
    if (hit) return { brand: f, ...hit };
  }

  const n = fold(name);
  // Longest brand first, so "conrad maldives" wins over "conrad".
  const keys = Object.keys(BRAND_TIERS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (n.includes(k)) return { brand: k, ...BRAND_TIERS[k] };
  }
  return null;
}

/**
 * Categories a property qualifies for, each from a tag that exists.
 *
 * `crypto_escrow` is deliberately never returned here: it means FurlPay has
 * actually onboarded the property for USDC settlement, which is a fact about
 * our own systems and cannot be read out of OpenStreetMap.
 */
export function deriveCategories(tags: OsmTags, name: string): LuxuryCategoryId[] {
  const out = new Set<LuxuryCategoryId>();
  const stars = parseStars(tags.stars);
  const brand = matchBrand(tags, name);

  // Editorial: brand membership.
  if (brand) out.add(brand.tier);

  // Observed: a 5-star rating recorded by a mapper stands on its own.
  if (stars === 5) out.add("ultra_luxury");
  if (stars === 4 && !brand) out.add("executive_suites");

  // Observed: elevation. OSM `ele` is metres above sea level.
  const ele = num(tags.ele);
  if (ele !== undefined && ele >= ALPINE_MIN_ELEVATION_M) out.add("alpine_chalets");

  // Observed: the building is itself historic.
  if (
    tags.historic ||
    tags.heritage ||
    /^(castle|palace|manor|chateau)$/i.test(tags.building ?? "") ||
    tags["building:architecture"]
  ) {
    out.add("heritage_castles");
  }

  // Observed: on-site spa or winery.
  if (
    truthy(tags.spa) ||
    tags.amenity === "spa" ||
    tags.leisure === "spa" ||
    tags.craft === "winery" ||
    tags.landuse === "vineyard" ||
    truthy(tags.sauna)
  ) {
    out.add("vineyard_wellness");
  }

  // Observed: Michelin. Only the explicit tag counts - "fine dining" in a name
  // is marketing, and a star is a fact.
  if (tags.michelin_stars || tags["michelin:stars"]) out.add("michelin_dining");

  // Observed: aviation access on the property.
  if (tags.aeroway === "helipad" || truthy(tags.helipad)) out.add("helipad_transit");

  return [...out];
}

/**
 * Amenity factor, 0-100, from tags a mapper recorded.
 *
 * Absence of a tag is not absence of the amenity - OSM is incomplete - so this
 * is a floor on how well-appointed a property is, not a verdict. It is weighted
 * lowest in the L-Score for exactly that reason.
 */
export function amenityFactor(tags: OsmTags): number {
  const signals: Array<[boolean, number]> = [
    [truthy(tags.spa) || tags.leisure === "spa", 15],
    [truthy(tags.swimming_pool) || tags.leisure === "swimming_pool", 12],
    [truthy(tags.restaurant) || tags.amenity === "restaurant", 10],
    [Boolean(tags.michelin_stars), 20],
    [truthy(tags.bar) || truthy(tags.rooftop), 8],
    [truthy(tags.internet_access) || tags.internet_access === "wlan", 5],
    [truthy(tags.air_conditioning), 5],
    [truthy(tags.wheelchair) || tags.wheelchair === "yes", 5],
    [Boolean(tags["parking"]) || truthy(tags.parking), 5],
    [truthy(tags.fitness_centre) || tags.leisure === "fitness_centre", 8],
    [tags.aeroway === "helipad", 7],
  ];
  const total = signals.reduce((sum, [ok, w]) => sum + (ok ? w : 0), 0);
  return Math.min(100, total);
}

export interface LScore {
  /** 0-100. */
  score: number;
  /** False when no live rating was folded in, so the score rests on stars,
   *  brand and amenities alone. The UI must not present the two as equivalent. */
  ratingIncluded: boolean;
  parts: { rating?: number; stars?: number; brand: number; amenity: number };
}

/**
 * The FurlPay L-Score.
 *
 *   L = 0.35*(rating*20) + 0.25*(stars*20) + 0.20*(brand) + 0.20*(amenity)
 *
 * WHY THE WEIGHTS RENORMALIZE. Google's rating cannot be stored (Places ToS
 * permits caching the place ID and nothing else), so the crawled dataset has no
 * rating and the 0.35 term is absent. Rather than score those properties as if
 * they had rated zero - which would rank every unenriched hotel last - the
 * remaining weights are rescaled to sum to 1 and `ratingIncluded` records that
 * it happened. Passing a live rating at view time restores the full formula.
 */
export function lScore(input: {
  rating?: number;
  stars?: number;
  brandPrestige?: number;
  amenity?: number;
}): LScore {
  const W = { rating: 0.35, stars: 0.25, brand: 0.2, amenity: 0.2 };

  const brand = input.brandPrestige ?? 0;
  const amenity = input.amenity ?? 0;
  const hasRating = typeof input.rating === "number" && input.rating > 0;
  const hasStars = typeof input.stars === "number" && input.stars > 0;

  let weight = W.brand + W.amenity;
  let sum = W.brand * brand + W.amenity * amenity;

  if (hasStars) {
    weight += W.stars;
    sum += W.stars * Math.min(100, input.stars! * 20);
  }
  if (hasRating) {
    weight += W.rating;
    sum += W.rating * Math.min(100, input.rating! * 20);
  }

  return {
    score: weight > 0 ? Math.round((sum / weight) * 10) / 10 : 0,
    ratingIncluded: hasRating,
    parts: {
      rating: hasRating ? input.rating : undefined,
      stars: hasStars ? input.stars : undefined,
      brand,
      amenity,
    },
  };
}

/** Headline tier from an L-Score, using the thresholds in the FurlPay spec. */
export function tierFromScore(score: number): "ultra" | "luxury" | "premium" | "standard" {
  if (score >= 90) return "ultra";
  if (score >= 80) return "luxury";
  if (score >= 75) return "premium";
  return "standard";
}
