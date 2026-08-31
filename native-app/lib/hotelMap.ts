import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// The hotel map's data layer.
//
// SAME ENDPOINT AS THE WEB MAP, deliberately. /api/travel/hotels/map already
// does the clustering, the OSM merge, the dedupe and the honest counting; a
// second implementation here would be a second set of numbers to keep true.
// This file is a client, not a reimplementation.
//
// WHAT IS COPIED AND WHY. The band table and the category colours are
// duplicated from the web's map/layers.ts rather than imported — the two
// codebases do not share a package, and a colour that drifts is a marker whose
// size and hue disagree about how many properties it stands for. They are
// small, they are stable, and the test beside this file asserts they still
// match the web's values.
// ---------------------------------------------------------------------------

export interface MapBBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** One curated luxury property, or one OpenStreetMap hotel. */
export interface MapPoint {
  id: string;
  kind: "property";
  source: "curated" | "osm";
  latitude: number;
  longitude: number;
  name: string;
  city: string;
  country: string;
  stars?: number;
  brand?: string;
  website?: string;
  hotelType: string;
  categories?: string[];
  /** `exact` only when Google confirmed the building. Drawn differently. */
  precision?: "exact" | "approximate";
  placeId?: string;
  googleMapsUri?: string;
  lScore?: number;
  corroboratedByOsm?: boolean;
  imageLocalPath?: string;
  imageUrl?: string;
  imageThumbUrl?: string;
  imageCredit?: string;
}

export interface ClusterMember {
  id: string;
  name: string;
  city: string;
  country: string;
  propertyType: string;
  stars?: number;
  categories: string[];
  precision: "exact" | "approximate";
  placeId?: string;
  latitude: number;
  longitude: number;
  imageLocalPath?: string;
  imageUrl?: string;
  imageThumbUrl?: string;
  imageCredit?: string;
}

/** N properties drawn as one circle. The count is real, and tapping it zooms to
 *  exactly the properties it counted. */
export interface MapCluster {
  id: string;
  kind: "cluster";
  latitude: number;
  longitude: number;
  count: number;
  topName: string;
  label: string;
  sublabel: string;
  families: { hotels: number; resorts: number; villas: number };
  confirmed: number;
  top: ClusterMember[];
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
}

export interface MapResponse {
  points: MapPoint[];
  clusters: MapCluster[];
  counts: {
    curatedInView: number;
    curatedClustered: number;
    osmInView: number;
    curatedMatchingWorldwide: number;
  };
  truncated: number;
  osmZoomIn: boolean;
  osmUnavailable: boolean;
  osmFilteredOut: boolean;
  dataset: {
    total: number;
    exact: number;
    approximate: number;
    stale: number;
    generatedAt: string;
  };
  fetchedAt: string;
  attribution: string;
}

export type PropertyFamily = "hotels" | "resorts" | "villas";

export interface MapFilter {
  families?: PropertyFamily[];
  categories?: string[];
  minStars?: number;
  /** Narrows the properties. NOT the same thing as the search box, which only
   *  flies the camera — see the web map for why those were separated. */
  query?: string;
  exactOnly?: boolean;
}

/**
 * Points and clusters for a viewport.
 *
 * `anonymous` because the map is public and a signed-out user must still see
 * it; sending an Authorization header we do not have would just add a refresh
 * round trip before every pan.
 */
export async function fetchMapPoints(
  bbox: MapBBox,
  zoom: number,
  filter: MapFilter = {},
  signal?: AbortSignal
): Promise<MapResponse> {
  const params = new URLSearchParams({
    // The server wants minLng,minLat,maxLng,maxLat — longitude first. Getting
    // this backwards yields a valid-looking box on the wrong part of the earth.
    bbox: [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]
      .map((n) => n.toFixed(4))
      .join(","),
    z: zoom.toFixed(2),
  });
  if (filter.families?.length) params.set("families", filter.families.join(","));
  if (filter.categories?.length) params.set("categories", filter.categories.join(","));
  if (filter.minStars) params.set("minStars", String(filter.minStars));
  if (filter.query?.trim()) params.set("q", filter.query.trim());
  if (filter.exactOnly) params.set("exactOnly", "1");

  return api<MapResponse>(`/travel/hotels/map?${params.toString()}`, {
    anonymous: true,
    signal,
  });
}

// --- marker appearance ------------------------------------------------------

/**
 * Count bands. Radius and colour come from the same row so a marker's size and
 * its colour can never disagree — the same invariant the web map holds.
 */
const BANDS = [
  { max: 5, r: 20, bg: "#8BCF4A", fg: "#FFFFFF" },
  { max: 15, r: 22, bg: "#8BCF4A", fg: "#FFFFFF" },
  { max: 50, r: 24, bg: "#F4C430", fg: "#1F2937" },
  { max: 100, r: 26, bg: "#F97316", fg: "#FFFFFF" },
  { max: Number.POSITIVE_INFINITY, r: 28, bg: "#F97316", fg: "#FFFFFF" },
] as const;

export function bandFor(count: number): { r: number; bg: string; fg: string } {
  return BANDS.find((b) => count <= b.max) ?? BANDS[BANDS.length - 1];
}

/**
 * The luxury categories, in the order the filter pills render.
 *
 * Mirrors LUXURY_MAP_CATEGORIES in the web app. Order matters: a property's
 * colour is its FIRST matching category, so reordering this silently recolours
 * the map.
 */
export const LUXURY_CATEGORIES: { id: string; label: string; color: string }[] = [
  { id: "ultra_luxury", label: "5-star Ultra Luxury", color: "#B8860B" },
  { id: "boutique", label: "Boutique Design", color: "#8B5CF6" },
  { id: "overwater_villas", label: "Island & Overwater", color: "#0E7490" },
  { id: "alpine_chalets", label: "Alpine Chalets", color: "#2563EB" },
  { id: "heritage_castles", label: "Castles & Palaces", color: "#9A3412" },
  { id: "vineyard_wellness", label: "Wine & Wellness", color: "#1B7A4E" },
  { id: "executive_suites", label: "Business Executive", color: "#334155" },
  { id: "michelin_dining", label: "Michelin Dining", color: "#C2410C" },
  { id: "helipad_transit", label: "Helipad & Transit", color: "#64748B" },
  { id: "crypto_escrow", label: "Pay with USDC", color: "#0F766E" },
];

const CATEGORY_COLOR = new Map(LUXURY_CATEGORIES.map((c) => [c.id, c.color]));

export function categoryColor(categories: string[] | undefined): string {
  for (const c of LUXURY_CATEGORIES) {
    if (categories?.includes(c.id)) return c.color;
  }
  return "#8B5CF6";
}

export function categoryLabel(id: string): string | undefined {
  return LUXURY_CATEGORIES.find((c) => c.id === id)?.label;
}

export { CATEGORY_COLOR };

/** The property families, for the header's Hotels / Resorts / Villas controls. */
export const FAMILIES: { id: PropertyFamily; label: string; icon: string }[] = [
  { id: "hotels", label: "Hotels", icon: "business-outline" },
  { id: "resorts", label: "Resorts", icon: "sunny-outline" },
  { id: "villas", label: "Villas", icon: "home-outline" },
];

/**
 * The best image for a property, or nothing.
 *
 * Local file first — the web serves 150 downloaded Commons photographs from
 * /hotels/... — then the Commons URL. A local path is relative to the web
 * origin, so it has to be absolutised for a native client.
 *
 * Google Places photography is deliberately absent: its policy permits storing
 * the place ID and nothing else, so it is fetched per view on the web and is
 * not part of this payload at all.
 */
export function imageUriFor(
  p: { imageLocalPath?: string; imageUrl?: string; imageThumbUrl?: string },
  origin: string
): string | undefined {
  if (p.imageLocalPath) return `${origin}${p.imageLocalPath}`;
  return p.imageThumbUrl ?? p.imageUrl;
}
