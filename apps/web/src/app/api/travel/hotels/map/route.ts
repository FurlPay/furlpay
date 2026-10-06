import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { osmHotelsInBBox, bboxTooLarge } from "@/lib/travel/osmHotels";
import {
  googlePlacesInBBox,
  prominence,
  selectSpatially,
  datasetStats,
  type GooglePlaceProperty,
} from "@/lib/hotels/googlePlacesLayer";
import {
  clusterPoints,
  curatedInBBox,
  curatedMatching,
  curatedStats,
  CLUSTER_MAX_ZOOM,
  type CuratedCluster,
  type CuratedFilter,
  type CuratedPoint,
  type PropertyFamily,
} from "@/lib/hotels/curated";
import { haversineMeters, jaroWinkler, normalizeName } from "@/lib/hotels/h3";
import { parseRadius, withinRadius } from "@/lib/hotels/radius";
import { inArea, parseArea } from "@/lib/hotels/drawArea";
import { LUXURY_MAP_CATEGORIES, type LuxuryCategoryId } from "@/lib/hotels/luxuryTiers";

export const dynamic = "force-dynamic";

/** How long a map request waits for OpenStreetMap before answering without
 *  it. Overpass answers a cached or light query well inside this; a slow one
 *  keeps running and lands in the cache for the next request. */
const OSM_WAIT_MS = 5_000;

// GET /api/travel/hotels/map — hotels inside a viewport.
//
// TWO SOURCES, ONE MEANING. Every point is a real hotel that somebody recorded
// at that position. A marker makes exactly one claim — "this hotel is here" —
// and that claim is always true. Where it comes from is stated per point:
//
//   curated  one of 507 luxury properties from the FurlPay CSV, each resolved
//            against Google Places by scripts/resolve-luxury-properties.mts.
//            Carries `precision`: `exact` when Google confirmed the building,
//            `approximate` when it did not and the compiled coordinate stands.
//   osm      any hotel OpenStreetMap records in the viewport, via Overpass.
//
// WHAT THE CURATED LAYER FIXED. Overpass cannot answer a bounding box wider
// than a few degrees, so before this layer existed every view above a single
// metropolitan area returned zero points and said "Zoom in to load hotels". A
// world map whose world view is empty. The curated set is bounded and local, so
// it answers at any zoom — including zoom 1 — instantly and without an upstream
// call. It is the map's spine, not its coverage: zoomed in, OSM still supplies
// every mapped hotel around it.
//
// WHY CLUSTERS ARE NOT THE OLD CITY PINS. This route once fell back to
// `generateStays()`, emitting one point per known city carrying an invented
// hotel COUNT and an invented AVERAGE NIGHTLY PRICE. A cluster here counts the
// properties it actually contains and hands back their bounds, so zooming in
// shows exactly the things that were counted. A count you can verify by looking
// is a different kind of object from one produced by a generator.
//
// PRICES ARE NOT HERE AT ALL. Neither source has nightly rates. Pricing is a
// separate, lazy, per-hotel call to /api/travel/hotels/price, so drawing the
// map costs no supplier requests.

export type MapPointKind = "property" | "cluster";
/**
 * Where a pin's facts came from.
 *
 * `registry` is the universal_hotels table (migration 0015), delivered as
 * vector tiles rather than through this route — so it never appears in the
 * balancing below, and its quota is zero by construction. It exists in the
 * union because the hover card shows provenance, and a registry pin must not
 * be labelled as OSM or Google when it may have come from Overture.
 */
/**
 * `google-live` is discovered per-viewport at request time through
 * /api/places/discover, as opposed to `google`, which is the harvested
 * snapshot in data/google-places.json.
 *
 * They are separate values on purpose. When live discovery is unavailable the
 * map still shows snapshot points, and nothing may relabel those as live —
 * a freshness claim the data does not support is worse than an outage the UI
 * admits to. The hover card reads this field to say where a pin came from.
 */
export type MapPointSource = "curated" | "osm" | "google" | "google-live" | "registry";

export interface MapPoint {
  id: string;
  kind: "property";
  source: MapPointSource;
  latitude: number;
  longitude: number;
  name: string;
  city: string;
  country: string;
  /** Star class, when a source recorded one. Absent is not zero. */
  stars?: number;
  /**
   * Google's user rating, 1-5. A DIFFERENT MEASUREMENT from `stars`: one is an
   * official classification, the other is what visitors thought. They are never
   * blended, and a card that shows one says which it is.
   */
  rating?: number;
  ratingCount?: number;
  brand?: string;
  website?: string;
  /** OSM `tourism` value, or the curated property type. */
  hotelType: string;

  // --- curated only ---------------------------------------------------------
  categories?: LuxuryCategoryId[];
  /** `exact` only when Google confirmed the building under the resolver's
   *  gates. Rendered differently, so a pin never overstates what is known. */
  precision?: "exact" | "approximate";
  /** Google's place ID — the one Places field that may be stored. */
  placeId?: string;
  googleMapsUri?: string;
  /** 0-100 FurlPay L-Score. Ranking only; never presented as a rating. */
  lScore?: number;
  /** True when an OSM record for the same building was folded into this one. */
  corroboratedByOsm?: boolean;
  /**
   * A locally-hosted photograph, preferred over everything else.
   *
   * Downloaded from Commons by scripts/download-property-images.mts, so it
   * needs no key, no round trip to another host, and cannot change underneath
   * the map. `imageUrl` is the Commons fallback for anything rendering outside
   * this deployment. Google's photography is in neither field — it may not be
   * stored, so it stays a per-view lookup via /api/travel/hotels/preview.
   */
  imageLocalPath?: string;
  imageUrl?: string;
  imageThumbUrl?: string;
  imageCredit?: string;
}

export interface MapCluster extends Omit<CuratedCluster, "id"> {
  id: string;
  kind: "cluster";
}

export interface MapResponse {
  points: MapPoint[];
  clusters: MapCluster[];
  /**
   * Counts, kept separate because they count DIFFERENT THINGS.
   *
   * Collapsing them reads as a lie even when every number is right: a Manhattan
   * viewport drawing 8 curated properties and 196 OSM hotels was reported as
   * "204 shown of 507 matching", which invites the reading that 204 of the 507
   * curated properties are on screen. They are two populations and the UI has
   * to be able to name each one.
   */
  counts: {
    /** Curated properties drawn individually in this viewport. */
    curatedInView: number;
    /** Curated properties folded into clusters in this viewport. */
    curatedClustered: number;
    /** OSM hotels drawn in this viewport. */
    osmInView: number;
    /** Google-discovered accommodation drawn in this viewport. */
    googleInView: number;
    /** Curated properties matching the filter ANYWHERE, so a viewport with
     *  none can still say how many exist elsewhere. */
    curatedMatchingWorldwide: number;
  };
  /** Set when the render budget capped the response, with what was dropped.
   *  A silent truncation reads as "this is everything", which it would not be. */
  truncated: number;
  /** True when the viewport is too wide for Overpass. The curated layer still
   *  answered, so this is a note about COVERAGE, not an empty map. */
  osmZoomIn: boolean;
  /** Set when Overpass failed, so the UI can distinguish "no OSM hotels here"
   *  from "we could not find out". */
  osmUnavailable: boolean;
  /**
   * True when a curated-only filter is active and the OpenStreetMap layer was
   * therefore not queried.
   *
   * OSM has no notion of a FurlPay collection, a property family or a confirmed
   * position, so a filtered view cannot honestly include it — but dropping ~200
   * pins with no explanation reads as a bug. This is what lets the UI say which
   * of the two it is.
   */
  osmFilteredOut: boolean;
  /** True when OSM was asked but answered after the route stopped waiting:
   *  the layer is still loading into the cache, not missing and not down. */
  osmDeferred: boolean;
  /** The circle this answer was narrowed to, when it was a radius search. */
  radius: { latitude: number; longitude: number; km: number } | null;
  /** Set when the answer was narrowed to a drawn area. */
  area: { vertices: number } | null;
  dataset: ReturnType<typeof curatedStats>;
  googleDataset: ReturnType<typeof datasetStats>;
  fetchedAt: string;
  attribution: string;
}

const ATTRIBUTION =
  "© OpenStreetMap contributors (ODbL) · Powered by Google · Curated positions verified with Google";

/**
 * The most markers worth putting on screen at once.
 *
 * Not a performance limit — MapLibre draws far more than this. It is a
 * legibility limit: past a few hundred pins a dense city is a solid block of
 * overlapping labels and the map stops answering questions. What gets dropped
 * is chosen by rank, and the count that was dropped is returned.
 */
const RENDER_BUDGET = 400;

/**
 * `bbox=minLng,minLat,maxLng,maxLat`.
 *
 * OUT-OF-RANGE IS CLAMPED, NOT REJECTED. A zoomed-out MapLibre viewport shows
 * the world more than once, and getBounds() reports that honestly: at zoom 1 it
 * returns longitudes like -253.1 to 253.1. Those are legitimate map state, not
 * malformed input. Rejecting them made the world view answer 400, which the UI
 * then reported as "could not reach the hotel service" — an outage message for
 * a working system.
 *
 * Clamping folds such a viewport to the whole world, which the curated layer
 * answers in full. Genuine garbage — non-numeric, wrong arity, or inverted
 * after clamping — is still rejected.
 */
function parseBbox(raw: string | null): number[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const minLng = clamp(parts[0], -180, 180);
  const minLat = clamp(parts[1], -90, 90);
  const maxLng = clamp(parts[2], -180, 180);
  const maxLat = clamp(parts[3], -90, 90);

  if (minLat >= maxLat) return null;

  // THE ANTIMERIDIAN IS A REAL VIEWPORT, NOT BAD INPUT.
  //
  // A map centred on Fiji, Auckland or Hawaii reports a west edge of +177 and
  // an east edge of -179: the viewport crosses 180 and the western number is
  // LARGER than the eastern one. Treating that as inverted-and-invalid answered
  // 400, which the client renders as "Could not reach the hotel service" — an
  // outage message for a working system, over most of the Pacific.
  //
  // Widening to the whole world is the honest repair. The alternative, querying
  // two boxes and stitching them, is more code for a case where the viewport
  // already spans the Pacific and is far past the zoom at which Overpass can be
  // asked anything; the curated layer answers a world box in full, so nothing
  // is actually lost.
  if (minLng >= maxLng) return [-180, minLat, 180, maxLat];

  return [minLng, minLat, maxLng, maxLat];
}

const VALID_CATEGORIES = new Set<string>(LUXURY_MAP_CATEGORIES.map((c) => c.id));
const VALID_FAMILIES = new Set<string>(["hotels", "resorts", "villas"]);

function parseFilter(sp: URLSearchParams): CuratedFilter {
  const categories = (sp.get("categories") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => VALID_CATEGORIES.has(c)) as LuxuryCategoryId[];

  const families = (sp.get("families") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => VALID_FAMILIES.has(c)) as PropertyFamily[];

  const minStars = Number(sp.get("minStars"));
  const q = (sp.get("q") ?? "").trim().slice(0, 80).toLowerCase();

  return {
    categories,
    families,
    minStars: Number.isFinite(minStars) && minStars >= 1 && minStars <= 5 ? minStars : undefined,
    query: q || undefined,
    exactOnly: sp.get("exactOnly") === "1",
  };
}

/**
 * The property-type families the UI offers, mapped onto the taxonomy the Google
 * layer normalizes to.
 *
 * "Villas" deliberately includes guest houses: Google files private guest rooms,
 * cottages and farmstays under types that mean the same thing to a traveller
 * looking for a whole place to themselves, and a Villas filter that returned
 * only the literal `villa` type would hide most of what it should show.
 */
function familiesToTypes(families: PropertyFamily[]): string[] {
  const out = new Set<string>();
  for (const f of families) {
    // Serviced apartments and motels are what a traveller means by "a hotel
    // room" even when Google files them separately.
    if (f === "hotels") ["hotel", "extended_stay", "motel"].forEach((t) => out.add(t));
    if (f === "resorts") out.add("resort");
    // WHOLE-PROPERTY STAYS ONLY. This used to include guest_house, and before
    // the taxonomy was corrected it also swept up private_guest_room — so a
    // Villas filter returned 1,922 spare bedrooms in other people's houses.
    // A villa is a place you have to yourself.
    if (f === "villas") out.add("villa");
  }
  return [...out];
}

/** A Google place as a map point. Every field is passed through or left absent;
 *  nothing is derived to fill a gap. */
function googleToPoint(g: GooglePlaceProperty): MapPoint {
  return {
    id: `gp_${g.placeId}`,
    kind: "property",
    source: "google",
    latitude: g.latitude,
    longitude: g.longitude,
    name: g.name,
    city: g.city ?? "",
    country: g.country ?? "",
    // The label's second line. Google's own display name for the type when it
    // has one ("Hotel", "Resort hotel"), else the normalized family.
    hotelType: g.typeDisplay ?? g.propertyType,
    // Google's user rating is NOT a star class, so it does not go in `stars`.
    rating: g.rating ?? undefined,
    ratingCount: g.ratingCount ?? undefined,
    website: g.website ?? undefined,
    placeId: g.placeId,
    googleMapsUri: g.googleMapsUrl ?? undefined,
    // A discovered position is Google's own, so it is exact by construction.
    precision: "exact",
  };
}

function curatedToPoint(p: CuratedPoint, corroborated: boolean): MapPoint {
  return {
    id: p.id,
    kind: "property",
    source: "curated",
    latitude: p.latitude,
    longitude: p.longitude,
    name: p.name,
    city: p.city,
    country: p.country,
    stars: p.stars,
    brand: p.brand,
    website: p.website,
    hotelType: p.propertyType,
    categories: p.categories,
    precision: p.precision,
    placeId: p.placeId,
    googleMapsUri: p.googleMapsUri,
    lScore: p.lScore,
    corroboratedByOsm: corroborated,
    imageLocalPath: p.imageLocalPath,
    imageUrl: p.imageUrl,
    imageThumbUrl: p.imageThumbUrl,
    imageCredit: p.imageCredit,
  };
}

/**
 * Drop OSM hotels that are the curated property under another spelling.
 *
 * Without this a confirmed luxury property draws twice — once from the curated
 * layer with its categories and place ID, once from OSM as a bare dot a few
 * metres away — and the two look like neighbouring hotels rather than one
 * building described twice.
 *
 * Requires BOTH proximity and name agreement, for the reason h3.ts sets out:
 * distance alone merges a hotel with the hostel in its basement, and name alone
 * merges every Hilton in a city. The curated record always wins the identity —
 * it carries a coordinate a second source confirmed, plus the metadata OSM has
 * no opinion about — and the OSM record is folded in as corroboration.
 */
const DEDUPE_DISTANCE_M = 120;
const DEDUPE_NAME_MIN = 0.82;

function dedupe(
  curated: CuratedPoint[],
  osm: Awaited<ReturnType<typeof osmHotelsInBBox>>
): { points: MapPoint[]; corroborated: Set<string> } {
  const corroborated = new Set<string>();
  const points: MapPoint[] = [];

  for (const h of osm ?? []) {
    const twin = curated.find(
      (c) =>
        haversineMeters(c.latitude, c.longitude, h.latitude, h.longitude) <= DEDUPE_DISTANCE_M &&
        jaroWinkler(normalizeName(c.name), normalizeName(h.name)) >= DEDUPE_NAME_MIN
    );
    if (twin) {
      corroborated.add(twin.id);
      continue;
    }
    points.push({
      id: h.id,
      kind: "property",
      source: "osm",
      latitude: h.latitude,
      longitude: h.longitude,
      name: h.name,
      city: h.city ?? "",
      country: h.country ?? "",
      stars: h.stars,
      brand: h.brand,
      website: h.website,
      hotelType: h.kind,
    });
  }

  return { points, corroborated };
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.hotels.map", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const bbox = parseBbox(sp.get("bbox"));
  if (!bbox) {
    return NextResponse.json({ error: "bbox=minLng,minLat,maxLng,maxLat is required" }, { status: 400 });
  }

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const box = { minLat, minLng, maxLat, maxLng };
  const filter = parseFilter(sp);

  const zoomRaw = Number(sp.get("z"));
  const zoom = Number.isFinite(zoomRaw) ? Math.min(20, Math.max(0, zoomRaw)) : 3;

  // --- radius search ----------------------------------------------------------
  //
  // `near=lat,lng&radiusKm=N` narrows every source to a circle, server-side.
  // The client sends the circle's bounding box as `bbox`, so the sources are
  // asked about the right area; this then keeps only what is truly inside.
  // Curated properties are listed individually in a radius search (never
  // clustered): a cluster's count would include members outside the circle.
  const radius = parseRadius(sp.get("near"), sp.get("radiusKm"));
  // A drawn area (`area=lng,lat;...`) works the same way, and both may apply.
  // parseArea rejects anything unbounded, oversized or self-crossing.
  const area = parseArea(sp.get("area"));
  const inCircle = <T extends { latitude: number; longitude: number }>(p: T) =>
    (!radius || withinRadius(p, radius)) && (!area || inArea(p, area));

  // --- curated layer: always answers, at any zoom ---------------------------
  const curated = curatedInBBox(box, filter).filter(inCircle);

  // --- OSM layer: only where Overpass can be asked ---------------------------
  //
  // Above CLUSTER_MAX_ZOOM the curated layer is drawing individual pins, which
  // is also the point at which a city fits on screen and OSM's coverage starts
  // to matter. Below it a viewport spans countries, Overpass would refuse, and
  // the curated spine is the whole answer.
  const osmWanted = zoom >= CLUSTER_MAX_ZOOM - 2 && !bboxTooLarge(box);
  const osmZoomIn = zoom >= CLUSTER_MAX_ZOOM - 2 && bboxTooLarge(box);

  // A text query or a category filter is a question about the curated set; OSM
  // has neither field, so answering it with unfiltered OSM pins would silently
  // ignore the filter the user set.
  const filtersCurated = Boolean(
    filter.query || filter.categories?.length || filter.families?.length || filter.exactOnly
  );

  // --- is Overpass worth waiting for? ---------------------------------------
  //
  // MEASURED, NOT ASSUMED. A Paris viewport at zoom 13 took 10-50 SECONDS, and
  // the same zoom over open ocean took 1.8s: the entire difference is the
  // Overpass round trip. Worse, the OSM points it returned were then discarded
  // — `osmInView` was 0, because the render budget had already filled with
  // Google properties that outrank them. The map was paying half a minute of
  // latency for data it threw away.
  //
  // So OSM is fetched only where it can actually help: viewports the Google
  // layer covers thinly. That inverts the failure — instead of OSM being
  // permanently invisible behind better data, it appears exactly where the
  // better data runs out, which is the only place it was ever adding anything.
  const googleCandidates = zoom >= CLUSTER_MAX_ZOOM - 2
    ? googlePlacesInBBox(box, {
        types: filter.families?.length ? familiesToTypes(filter.families) : undefined,
        query: filter.query,
      })
    : [];

  /** Below this, the Google layer is thin enough that OSM adds real coverage. */
  const GOOGLE_DENSE_ENOUGH = 120;
  /** The most Google points one viewport may draw, so no single source can take
   *  the whole render budget. */
  const GOOGLE_QUOTA = 300;
  const googleCoversIt = googleCandidates.length >= GOOGLE_DENSE_ENOUGH;

  // --- bounded wait --------------------------------------------------------
  //
  // MEASURED: a Tokyo viewport at zoom 12 answered in 31.3 s, all of it this
  // await, to return 8 curated hotels that were ready in milliseconds; the
  // worst case is every endpoint's 20 s budget in turn. So the route waits at
  // most OSM_WAIT_MS and then answers with what it has. The lookup is NOT
  // cancelled: it keeps running and fills its 6-hour cache (osmHotels.ts), so
  // the next request for this area — "Search this area", a small pan — gets
  // the OSM layer instantly. `osmDeferred` tells the client the layer is
  // still coming, which is different from "no OSM hotels" and from an outage.
  //
  // THE CACHE CANNOT BE RELIED ON TO CARRY IT. On Vercel the function is
  // frozen once the response is sent, and the cache is KV, which production
  // refuses to back with memory — so a deferred lookup may never land. The
  // client therefore follows a deferred answer with ONE `osm=wait` request for
  // the same view, which waits for the lookup like the route always used to.
  // First paint stays fast; the OSM layer arrives when Overpass answers.
  const osmWaitFull = sp.get("osm") === "wait";
  const osmAttempted = osmWanted && !filtersCurated && !googleCoversIt;
  let osm: Awaited<ReturnType<typeof osmHotelsInBBox>> = null;
  let osmDeferred = false;
  if (osmAttempted && osmWaitFull) {
    osm = await osmHotelsInBBox(box, filter.minStars ?? 0);
  } else if (osmAttempted) {
    const lookup = osmHotelsInBBox(box, filter.minStars ?? 0);
    const LATE = Symbol("late");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raced = await Promise.race([
      lookup,
      new Promise<typeof LATE>((resolve) => {
        timer = setTimeout(() => resolve(LATE), OSM_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (raced === LATE) {
      osmDeferred = true;
      lookup.catch(() => {}); // finishes in the background, into the cache
    } else {
      osm = raced;
    }
  }
  // null from a call we made is an upstream failure; null because we never
  // called — or stopped waiting — is not. Collapsing them would let a slow
  // upstream or a wide zoom read as an outage.
  const osmUnavailable = osmAttempted && !osmDeferred && osm === null;

  const { points: osmPoints, corroborated } = dedupe(curated, osm);

  // --- Google layer ---------------------------------------------------------
  //
  // Real accommodation with real coordinates across the destinations that have
  // been discovered, sitting between the curated spine and the OSM coverage:
  // richer than an OSM dot (it carries a rating, a type and an address) and
  // broader than the curated 507. Served from a static dataset, so it costs no
  // upstream call and answers at any zoom the viewport allows.
  //
  // Deduped against the curated layer on the same proximity-plus-name rule as
  // OSM, because a curated property is very often ALSO a Google place, and two
  // pins on one building read as two hotels.
  const googleRaw = googleCandidates;

  // GEOGRAPHIC REPRESENTATION BEFORE DEDUPE. Taking the strongest 300 by
  // prominence dropped 20% of Paris' occupied grid cells, 30% of Tokyo's and
  // 35% of Dubai's — prominence tracks tourist density, so whole districts went
  // dark to fit more hotels around the centre. Sampling across cells first
  // means every occupied part of the viewport is represented, and ranking then
  // decides which property speaks for each part.
  const googleSampled = selectSpatially(googleRaw, box, GOOGLE_QUOTA);

  const googlePoints: MapPoint[] = [];
  for (const g of googleSampled) {
    const twin = curated.find(
      (c) =>
        haversineMeters(c.latitude, c.longitude, g.latitude, g.longitude) <= DEDUPE_DISTANCE_M &&
        jaroWinkler(normalizeName(c.name), normalizeName(g.name)) >= DEDUPE_NAME_MIN
    );
    if (twin) {
      corroborated.add(twin.id);
      continue;
    }
    googlePoints.push(googleToPoint(g));
  }

  // --- assemble --------------------------------------------------------------
  const { clusters, singles } = clusterPoints(curated, radius || area ? Math.max(zoom, CLUSTER_MAX_ZOOM) : zoom);

  const curatedPoints = singles.map((p) => curatedToPoint(p, corroborated.has(p.id)));

  // Rank before capping, so what survives a cap is the most significant rather
  // than whatever the sources happened to list first. Curated properties outrank
  // OSM dots: they carry a verified position and the metadata the map is for.
  // `google-live` ranks last and is never produced by this route: live points
  // are merged in the browser after this response paints, by
  // lib/places/liveAugment.ts. It appears in these two maps only because the
  // union demands exhaustiveness.
  const RANK: Record<MapPointSource, number> = { curated: 0, google: 1, osm: 2, registry: 3, "google-live": 4 };
  const all = [...curatedPoints, ...googlePoints, ...osmPoints].filter(inCircle).sort((a, b) => {
    if (a.source !== b.source) return RANK[a.source] - RANK[b.source];
    // Within a source, the most significant first, so a cap keeps the
    // properties a reader is most likely to be looking for.
    if (a.source === "google") return (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
    return (b.lScore ?? 0) - (a.lScore ?? 0) || (b.stars ?? 0) - (a.stars ?? 0);
  });

  // --- per-source quotas ------------------------------------------------------
  //
  // A single ranked slice let the densest source take everything: Paris drew
  // 391 Google properties, 9 curated and 0 OSM. Ranking still decides WHICH
  // properties survive within a source, but each source gets a floor so the map
  // stays a picture of what is there rather than of whichever layer happens to
  // be deepest.
  //
  // Curated is uncapped because it is never large — 507 worldwide, and a
  // viewport holds a handful — and it is the layer FurlPay actually curates.
  const OSM_QUOTA = 60;
  const taken = { curated: 0, google: 0, osm: 0, registry: 0, "google-live": 0 } as Record<MapPointSource, number>;
  const quota: Record<MapPointSource, number> = {
    curated: Number.POSITIVE_INFINITY,
    google: GOOGLE_QUOTA,
    osm: OSM_QUOTA,
    // Zero, and not an oversight: registry pins reach the client as vector
    // tiles from /api/travel/hotels/tiles, never through this route. A
    // non-zero quota here would silently create a second delivery path for
    // the same data and draw every registry hotel twice.
    registry: 0,
    // Zero for the same reason: live points are discovered by the browser and
    // merged client-side, so this route must never emit one. A non-zero quota
    // would duplicate every live result the moment it also appeared here.
    "google-live": 0,
  };

  const points: MapPoint[] = [];
  for (const p of all) {
    if (points.length >= RENDER_BUDGET) break;
    if (taken[p.source] >= quota[p.source]) continue;
    taken[p.source] += 1;
    points.push(p);
  }

  const body: MapResponse = {
    points,
    clusters: clusters.map((c) => ({ ...c, kind: "cluster" as const })),
    counts: {
      curatedInView: points.filter((p) => p.source === "curated").length,
      curatedClustered: clusters.reduce((n, c) => n + c.count, 0),
      osmInView: points.filter((p) => p.source === "osm").length,
      googleInView: points.filter((p) => p.source === "google").length,
      curatedMatchingWorldwide: curatedMatching(filter).length,
    },
    truncated: all.length - points.length,
    osmZoomIn,
    osmUnavailable,
    osmDeferred,
    osmFilteredOut: osmWanted && filtersCurated,
    radius: radius ? { latitude: radius.center.latitude, longitude: radius.center.longitude, km: radius.km } : null,
    area: area ? { vertices: area.length } : null,
    dataset: curatedStats(),
    // Freshness of the Google layer, so the UI can say why coverage thinned if
    // the dataset ages out rather than silently drawing fewer pins.
    googleDataset: datasetStats(),
    fetchedAt: new Date().toISOString(),
    attribution: ATTRIBUTION,
  };

  return NextResponse.json(body);
}
