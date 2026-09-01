// ---------------------------------------------------------------------------
// Destination intelligence: what we actually know about a place.
//
// This is the data behind the map's destination card — the counts, the price
// band, the properties worth showing first. Every number here is COUNTED from
// the dataset at call time. None of it is stored, estimated, or rounded up for
// effect, because a destination panel is the easiest surface in the product to
// quietly inflate: "1,240+ Hotels" reads identically whether it was measured
// or invented, and only one of those survives a reader clicking through.
//
// ── THE PRICE FIELD IS DELIBERATELY NULLABLE ───────────────────────────────
// A design for this card asks for "From $45 Avg/Night". We cannot answer that
// today and must not appear to: Google's priceLevel is populated on 29 of
// 16,014 properties (0.2%), and live rates come from Duffel, which production
// currently holds a TEST token for — the pricing layer refuses to serve those
// as real, correctly. So `fromPrice` is null until a real rate exists, and the
// card is expected to omit the figure rather than print a plausible one.
//
// The shape is here so that the day a live token lands, the number appears
// without a redesign. Absent is a state, not a gap to fill with a guess.
// ---------------------------------------------------------------------------

import type { BBox } from "@/lib/travel/osmHotels";
import {
  googlePlacesInBBox,
  prominence,
  type GooglePlaceProperty,
} from "./googlePlacesLayer";

/** How many of each family a destination holds. */
export interface FamilyCounts {
  hotels: number;
  resorts: number;
  villas: number;
  other: number;
}

export interface DestinationSummary {
  /** Properties inside the area, after the accommodation and open filters. */
  total: number;
  counts: FamilyCounts;
  /** Mean of the ratings we HOLD, and how many that was over. A mean across
   *  12 rated properties out of 400 is not the destination's rating, and the
   *  denominator is returned so a caller can decline to show it. */
  rating: { mean: number; over: number } | null;
  /** Share of properties we can show a photograph for. Drives whether the card
   *  leads with imagery or with text. */
  photoCoverage: number;
  /**
   * Nightly price to lead with. NULL until a real rate exists — see the note
   * at the top. Never derive it from priceLevel, which is a 1-4 bucket on 0.2%
   * of the dataset and is not a currency amount.
   */
  fromPrice: { amount: number; currency: string } | null;
  /** Best properties to show first, already ordered. */
  top: GooglePlaceProperty[];
}

function familyOf(p: GooglePlaceProperty): keyof FamilyCounts {
  const t = (p.propertyType || "").toLowerCase();
  if (t === "resort") return "resorts";
  if (t === "villa" || t === "cottage") return "villas";
  if (t === "hotel" || t === "motel" || t === "hostel" || t === "guest_house") return "hotels";
  return "other";
}

/**
 * Rank for the "top properties" strip.
 *
 * Rating alone puts a 5.0 with three reviews above a 4.6 with nine thousand,
 * which is the wrong answer for a card meant to represent a destination. So
 * the rating is weighted by how much evidence sits behind it — log of the
 * review count, because the difference between 10 and 100 reviews matters far
 * more than between 9,000 and 9,090. `prominence` then breaks ties using the
 * same signal the map already ranks pins by, so the card and the map agree.
 */
function topScore(p: GooglePlaceProperty): number {
  if (p.rating === null || p.rating === undefined) return 0;
  const confidence = Math.log10(1 + (p.ratingCount ?? 0));
  return p.rating * confidence + prominence(p) / 1000;
}

/**
 * Summarise everything inside a viewport.
 *
 * Takes a bbox rather than a city name on purpose: the map already works in
 * viewports, city strings are inconsistent across 27 countries ("Roma" and
 * "Rome", "New Delhi" and "Delhi" are separate rows today), and a summary that
 * disagrees with the pins on screen is worse than no summary.
 */
export function summariseDestination(box: BBox, topN = 3): DestinationSummary {
  const all = googlePlacesInBBox(box);

  const counts: FamilyCounts = { hotels: 0, resorts: 0, villas: 0, other: 0 };
  let ratingSum = 0;
  let rated = 0;
  let withPhotos = 0;

  for (const p of all) {
    counts[familyOf(p)]++;
    if (typeof p.rating === "number") {
      ratingSum += p.rating;
      rated++;
    }
    if ((p.photoCount ?? 0) > 0) withPhotos++;
  }

  const top = [...all]
    .filter((p) => typeof p.rating === "number")
    .sort((a, b) => topScore(b) - topScore(a))
    .slice(0, topN);

  return {
    total: all.length,
    counts,
    rating: rated > 0 ? { mean: ratingSum / rated, over: rated } : null,
    photoCoverage: all.length ? withPhotos / all.length : 0,
    // Not "we haven't got round to it" — there is no honest value to put here
    // until a live rate provider is configured. See the header.
    fromPrice: null,
    top,
  };
}

/**
 * Format a count the way the card shows it.
 *
 * "1,240+" is only written when the number really is a floor — i.e. the
 * viewport was capped and there are genuinely more. An exact count prints
 * exactly, because a "+" on a complete number is a small lie that makes every
 * other number on the card less believable.
 */
export function formatCount(n: number, capped = false): string {
  return capped ? `${n.toLocaleString()}+` : n.toLocaleString();
}

/**
 * Box around a point, in degrees of latitude.
 *
 * 0.25 deg is roughly 28km north-south, which covers a metropolitan area
 * without swallowing the next city. Longitude is widened by latitude so the
 * box stays roughly square on the ground — at Reykjavik a degree of longitude
 * is half what it is at Singapore, and a fixed offset would make northern
 * cities look emptier than they are.
 */
export function boxAround(lat: number, lng: number, latSpanDeg = 0.25): BBox {
  const lngSpan = latSpanDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latSpanDeg,
    maxLat: lat + latSpanDeg,
    minLng: lng - lngSpan,
    maxLng: lng + lngSpan,
  };
}

/**
 * Summarise a named destination, or return null when we hold no coordinate
 * for it.
 *
 * Null rather than an empty summary on purpose: "we have no properties there"
 * and "we do not know where that is" are different statements, and a card
 * that renders zeroes for an unrecognised name claims to have looked.
 */
export function summariseNamedDestination(
  coords: { lat: number; lng: number } | undefined,
  topN = 3
): DestinationSummary | null {
  if (!coords) return null;
  return summariseDestination(boxAround(coords.lat, coords.lng), topN);
}
