import type { BBox } from "@/lib/travel/osmHotels";
import type { CuratedDataset, CuratedProperty } from "./curatedTypes";
import type { LuxuryCategoryId } from "./luxuryTiers";
import dataset from "@/data/luxury-properties.json";

// ---------------------------------------------------------------------------
// The curated luxury layer: 507 properties, resolved against Google Places by
// scripts/resolve-luxury-properties.mts, served from memory.
//
// WHY THIS LAYER EXISTS AT ALL. The map used to be OSM-only, and OSM can only
// be queried through Overpass, which refuses anything wider than a few degrees.
// So every view above a metropolitan area answered "Zoom in to load hotels" —
// technically true, and a world map whose world view is empty. This layer is
// bounded, local and instant: it answers at ANY zoom, including zoom 1, with
// real properties at coordinates a second source confirmed.
//
// IT DOES NOT REPLACE OSM, IT ANCHORS IT. 507 properties is the luxury spine of
// the map, not its coverage. Zoomed into a city, Overpass still supplies every
// mapped hotel around them. The two are merged, deduplicated, and labelled.
//
// NOTHING HERE IS GENERATED. Every field traces to the curated CSV or to a
// Google response the resolver accepted under the gates in resolve.ts. Where a
// property could not be confirmed it keeps its approximate coordinate and SAYS
// so, rather than being dropped (which hides a real hotel) or promoted (which
// claims a precision nobody measured).
// ---------------------------------------------------------------------------

const data = dataset as unknown as CuratedDataset;

/**
 * How long a Google-derived coordinate may be served.
 *
 * The Places policy permits storing the place ID indefinitely and caching other
 * content only for a limited period. A coordinate read from a Places response
 * is that other content, so it expires: past this age the property falls back
 * to its curated coordinate and is re-labelled `approximate`. Re-running the
 * resolver refreshes it.
 *
 * The consequence of forgetting to refresh is therefore a map that gets vaguer
 * and admits it — never one that silently serves content it should not hold.
 * The same constant lives in the resolver; they must not drift apart.
 */
export const CURATED_STALE_DAYS = 30;

export interface CuratedPoint extends CuratedProperty {
  /** False when a Google-derived coordinate has aged out and the curated one is
   *  being served in its place. */
  fresh: boolean;
}

let index: CuratedPoint[] | null = null;

/**
 * Properties sorted by latitude, with expiry already applied.
 *
 * Sorted because that is what makes a viewport query a binary search plus a
 * short scan rather than a full sweep. At 507 rows either is instant; written
 * this way because the CSV is expected to grow and a linear scan that is fine
 * today is the kind of thing nobody revisits until it is not.
 */
function build(): CuratedPoint[] {
  const now = Date.now();
  const maxAge = CURATED_STALE_DAYS * 86_400_000;

  const points = (data.properties ?? []).map((p): CuratedPoint => {
    const expired =
      p.coordinateSource === "google_places" &&
      (!p.resolvedAt || now - Date.parse(p.resolvedAt) > maxAge);

    if (!expired) return { ...p, fresh: true };
    return {
      ...p,
      latitude: p.curatedLatitude,
      longitude: p.curatedLongitude,
      precision: "approximate",
      coordinateSource: "curated_csv",
      fresh: false,
    };
  });

  // A row whose coordinate never parsed cannot be drawn anywhere truthful.
  return points
    .filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180
    )
    .sort((a, b) => a.latitude - b.latitude);
}

export function curatedProperties(): CuratedPoint[] {
  index ??= build();
  return index;
}

export interface CuratedStats {
  total: number;
  exact: number;
  approximate: number;
  stale: number;
  generatedAt: string;
}

/** What the dataset knows about itself. Surfaced in the API so a client can
 *  tell the user how much of the map is confirmed. */
export function curatedStats(): CuratedStats {
  const all = curatedProperties();
  return {
    total: all.length,
    exact: all.filter((p) => p.precision === "exact").length,
    approximate: all.filter((p) => p.precision === "approximate").length,
    stale: all.filter((p) => !p.fresh).length,
    generatedAt: data.generatedAt ?? "",
  };
}

/** First index whose latitude is >= value. Standard lower bound. */
function lowerBound(points: CuratedPoint[], latitude: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].latitude < latitude) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The three families the header filters and the card stats both use.
 *
 * A complete partition of the 16 property types in the CSV — every property
 * lands in exactly one family, so the three numbers on a card always sum to the
 * cluster's count. A leftover "other" bucket would make the card's arithmetic
 * fail to add up in front of the user.
 */
export type PropertyFamily = "hotels" | "resorts" | "villas";

const FAMILY_BY_TYPE: Record<string, PropertyFamily> = {
  Hotel: "hotels",
  Palace: "hotels",
  Castle: "hotels",
  Chateau: "hotels",
  "Manor House": "hotels",
  Inn: "hotels",
  Ryokan: "hotels",
  "Chalet Hotel": "hotels",
  Resort: "resorts",
  "Medical Wellness Resort": "resorts",
  Lodge: "resorts",
  "Boutique Lodge": "resorts",
  Camp: "resorts",
  Villa: "villas",
  Estate: "villas",
  "Private Island": "villas",
};

/** An unmapped type falls to `hotels` rather than vanishing: a new CSV type
 *  should show up somewhere countable, not silently drop out of the totals. */
export function familyOf(propertyType: string): PropertyFamily {
  return FAMILY_BY_TYPE[propertyType] ?? "hotels";
}

export interface CuratedFilter {
  /** Any-of. An empty or absent list means no category filter. */
  categories?: LuxuryCategoryId[];
  /** Any-of, from the header's Hotels / Resorts / Villas controls. */
  families?: PropertyFamily[];
  minStars?: number;
  /** Substring over name, brand, city and country. Already lowercased. */
  query?: string;
  /** Drop properties whose position was never confirmed. Off by default: a
   *  property we know less about is still a property. */
  exactOnly?: boolean;
}

function matches(p: CuratedPoint, f: CuratedFilter): boolean {
  if (f.exactOnly && p.precision !== "exact") return false;
  if (f.families?.length && !f.families.includes(familyOf(p.propertyType))) return false;
  if (f.minStars && (p.stars ?? 0) < f.minStars) return false;
  if (f.categories?.length && !f.categories.some((c) => p.categories.includes(c))) return false;
  if (f.query) {
    const haystack = `${p.name} ${p.brand ?? ""} ${p.city} ${p.country} ${p.destination ?? ""}`;
    if (!haystack.toLowerCase().includes(f.query)) return false;
  }
  return true;
}

/**
 * Curated properties inside a bounding box.
 *
 * The latitude index bounds the scan; longitude is checked per candidate. A
 * bbox is assumed already clamped and non-inverted — the map route does both
 * before calling, because a viewport zoomed out past the world wraps and
 * reports longitudes beyond +/-180.
 */
export function curatedInBBox(bbox: BBox, filter: CuratedFilter = {}): CuratedPoint[] {
  const points = curatedProperties();
  const out: CuratedPoint[] = [];
  for (let i = lowerBound(points, bbox.minLat); i < points.length; i++) {
    const p = points[i];
    if (p.latitude > bbox.maxLat) break;
    if (p.longitude < bbox.minLng || p.longitude > bbox.maxLng) continue;
    if (!matches(p, filter)) continue;
    out.push(p);
  }
  return out;
}

/** Every property matching a filter, ignoring the viewport. Used for the "N of
 *  M worldwide" counter, so a filter that empties the current view can still
 *  say how many exist elsewhere. */
export function curatedMatching(filter: CuratedFilter = {}): CuratedPoint[] {
  return curatedProperties().filter((p) => matches(p, filter));
}

// --- clustering -------------------------------------------------------------

/** One property as the hover card lists it. Everything here is read from the
 *  dataset — no rating, no price, no photo, because the dataset has none. */
export interface ClusterMember {
  id: string;
  name: string;
  city: string;
  country: string;
  propertyType: string;
  stars?: number;
  categories: LuxuryCategoryId[];
  precision: "exact" | "approximate";
  placeId?: string;
  latitude: number;
  longitude: number;
  /** Stored Commons imagery, when the enrichment pass found any. The local
   *  file is preferred; the remote URL is the fallback. */
  imageLocalPath?: string;
  imageUrl?: string;
  imageThumbUrl?: string;
  imageCredit?: string;
}

export interface CuratedCluster {
  id: string;
  latitude: number;
  longitude: number;
  /** How many real properties this stands for. Never an estimate. */
  count: number;
  /** The strongest member, so a cluster can be labelled by something real. */
  topName: string;
  /** What to call this group: the city when they share one, otherwise the
   *  country, otherwise the region. Derived from the members, never invented. */
  label: string;
  sublabel: string;
  /** Counts by family. These sum to `count`. */
  families: Record<PropertyFamily, number>;
  /** How many of the members have a Google-confirmed position. */
  confirmed: number;
  /** Highest-ranked members, for the card's property row. */
  top: ClusterMember[];
  /** Bounds of the members, so clicking one zooms to exactly what it holds. */
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number };
}

function toMember(p: CuratedPoint): ClusterMember {
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    country: p.country,
    propertyType: p.propertyType,
    stars: p.stars,
    categories: p.categories,
    precision: p.precision,
    placeId: p.placeId,
    latitude: p.latitude,
    longitude: p.longitude,
    imageLocalPath: p.imageLocalPath,
    imageUrl: p.imageUrl,
    imageThumbUrl: p.imageThumbUrl,
    imageCredit: p.imageCredit,
  };
}

/**
 * Name a group of properties from what they have in common.
 *
 * Walks up the geography until it finds something that is true of most of them:
 * a shared city, then a shared country, then the region. The subtitle always
 * states the real count, so a label that had to generalise is still precise
 * about what it is counting.
 */
function describe(members: CuratedPoint[]): { label: string; sublabel: string } {
  const tally = (pick: (p: CuratedPoint) => string) => {
    const counts = new Map<string, number>();
    for (const p of members) {
      const key = pick(p);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  };

  const city = tally((p) => p.city);
  const country = tally((p) => p.country);
  const region = tally((p) => p.region);
  const n = members.length;
  const noun = n === 1 ? "property" : "properties";

  // "Most" is two thirds: a label has to be true of the group, not of a
  // plurality of it. Below that it generalises rather than mislabelling.
  if (city && city[1] >= n * 0.66) {
    return { label: city[0], sublabel: `${n} ${noun}${country ? ` · ${country[0]}` : ""}` };
  }
  if (country && country[1] >= n * 0.66) {
    return { label: country[0], sublabel: `${n} ${noun}` };
  }
  return { label: region?.[0] ?? "Selected area", sublabel: `${n} ${noun}` };
}

/**
 * Web Mercator normalised coordinates, 0..1 on both axes.
 *
 * Clustering in projected space rather than in degrees is what keeps cells
 * visually square. A fixed-degree grid is fine at the equator and increasingly
 * wrong toward the poles, where a degree of longitude is a fraction of a degree
 * of latitude — Reykjavik and Tromso would cluster into tall thin strips while
 * Nairobi clustered into squares.
 */
function mercator(lat: number, lng: number): { x: number; y: number } {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: (lng + 180) / 360,
    y: (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2,
  };
}

/** Cluster cell width in pixels. About two pin-widths — small enough that a
 *  cluster is local, large enough that it actually thins a dense city. */
const CLUSTER_CELL_PX = 68;
/** Above this zoom every property gets its own pin. By then a city fits on
 *  screen and a cluster hides more than it helps. */
export const CLUSTER_MAX_ZOOM = 11;

/**
 * Group points into clusters for a zoom level.
 *
 * A cluster's count is the number of REAL properties in its cell — this is the
 * distinction from the city-marker generator this map used to carry, which
 * emitted "10 hotels" per known city from a deterministic function and rendered
 * it in the same visual language as measured data. A count here can be verified
 * by zooming in, because the things being counted are the things that appear.
 *
 * A cell holding one property yields no cluster: the property itself is
 * returned, because a "cluster of 1" is just a pin wearing a disguise.
 */
export function clusterPoints(
  points: CuratedPoint[],
  zoom: number
): { clusters: CuratedCluster[]; singles: CuratedPoint[] } {
  if (zoom >= CLUSTER_MAX_ZOOM || points.length <= 1) {
    return { clusters: [], singles: points };
  }

  // World is 256 * 2^zoom pixels across, and mercator() is normalised to 1.
  const cell = CLUSTER_CELL_PX / (256 * Math.pow(2, zoom));
  const cells = new Map<string, CuratedPoint[]>();

  for (const p of points) {
    const m = mercator(p.latitude, p.longitude);
    const key = `${Math.floor(m.x / cell)}:${Math.floor(m.y / cell)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(p);
    else cells.set(key, [p]);
  }

  const clusters: CuratedCluster[] = [];
  const singles: CuratedPoint[] = [];

  for (const [key, members] of cells) {
    if (members.length === 1) {
      singles.push(members[0]);
      continue;
    }
    // Centroid in projected space, then unprojected — averaging raw degrees
    // puts the marker off-centre for the same reason the grid is projected.
    let sx = 0;
    let sy = 0;
    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;
    for (const p of members) {
      const m = mercator(p.latitude, p.longitude);
      sx += m.x;
      sy += m.y;
      minLat = Math.min(minLat, p.latitude);
      maxLat = Math.max(maxLat, p.latitude);
      minLng = Math.min(minLng, p.longitude);
      maxLng = Math.max(maxLng, p.longitude);
    }
    const x = sx / members.length;
    const y = sy / members.length;
    const lng = x * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

    const ranked = [...members].sort((a, b) => b.lScore - a.lScore);
    const families: Record<PropertyFamily, number> = { hotels: 0, resorts: 0, villas: 0 };
    for (const p of members) families[familyOf(p.propertyType)]++;

    clusters.push({
      id: `cl_${zoom}_${key}`,
      latitude: lat,
      longitude: lng,
      count: members.length,
      topName: ranked[0].name,
      ...describe(members),
      families,
      confirmed: members.filter((p) => p.precision === "exact").length,
      top: ranked.slice(0, 3).map(toMember),
      bounds: { minLat, minLng, maxLat, maxLng },
    });
  }

  return { clusters, singles };
}
