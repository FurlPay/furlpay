// Ordering for the hotel map's results list. Pure, so it is tested directly.
//
// The list and the map show the SAME points; sorting reorders the list only —
// markers stay where the hotels are. Sorting is local: it never refetches.
//
// MISSING IS NOT ZERO. A property with no Google rating, or no recorded star
// class, sorts after every property that has one rather than as "0 stars" —
// the data saying nothing is not the data saying "worst".

import type { MapPoint } from "@/app/api/travel/hotels/map/route";

export const RESULT_SORTS = [
  { id: "recommended", label: "Recommended" },
  { id: "rating", label: "Guest rating" },
  { id: "stars", label: "Star class" },
  { id: "distance", label: "Distance from map centre" },
  { id: "name", label: "Name (A–Z)" },
] as const;
export type ResultSort = (typeof RESULT_SORTS)[number]["id"];

export function isResultSort(v: unknown): v is ResultSort {
  return RESULT_SORTS.some((s) => s.id === v);
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Descending on a value that may be missing; missing sorts last. */
const desc = (a?: number, b?: number) => (a === undefined ? (b === undefined ? 0 : 1) : b === undefined ? -1 : b - a);

export function sortResults(points: readonly MapPoint[], sort: ResultSort, center?: { latitude: number; longitude: number }): MapPoint[] {
  const byName = (a: MapPoint, b: MapPoint) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const cmp: Record<ResultSort, (a: MapPoint, b: MapPoint) => number> = {
    // Curated first (they carry the FurlPay L-Score), then by that score, then
    // by what guests said, weighting a rating by how many people gave it.
    recommended: (a, b) =>
      Number(b.source === "curated") - Number(a.source === "curated") ||
      desc(a.lScore, b.lScore) ||
      desc(a.rating, b.rating) ||
      desc(a.ratingCount, b.ratingCount) ||
      byName(a, b),
    rating: (a, b) => desc(a.rating, b.rating) || desc(a.ratingCount, b.ratingCount) || byName(a, b),
    stars: (a, b) => desc(a.stars, b.stars) || desc(a.rating, b.rating) || byName(a, b),
    distance: (a, b) =>
      center ? distanceKm(center, a) - distanceKm(center, b) || byName(a, b) : byName(a, b),
    name: byName,
  };
  return [...points].sort(cmp[sort]);
}
