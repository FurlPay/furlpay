"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// maplibre-gl v6 is ESM-only and exports NO default — the bundle ends in a
// named-export list. `import maplibregl from "maplibre-gl"` therefore binds
// undefined, and the failure surfaces late and confusingly as
// "Cannot read properties of undefined (reading 'Map')" at first render.
// Named imports are the supported shape.
import {
  Map as MapLibreMap,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LngLatBounds,
  type MapGeoJSONFeature,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// ---------------------------------------------------------------------------
// Tell MapLibre where its tile-parsing worker is. THIS IS LOAD-BEARING: without
// it the map draws nothing at all.
//
// MapLibre v6 finds its own worker with `new URL("./maplibre-gl-worker.mjs",
// import.meta.url)`, guarded by `if (!/^https?:/.test(import.meta.url)) return
// ""`. Webpack rewrites import.meta.url to a non-http value inside a bundle, so
// that guard trips and the resolver hands back an empty string — which is then
// passed straight to `new Worker("")`. An empty worker URL resolves against the
// current document, so the browser loads the HTML page and tries to execute it
// as a module worker.
//
// It fails without throwing anywhere visible. The map still constructs, the
// canvas still appears, the controls still work and tiles are still fetched —
// they are simply never decoded, because the decoder never started. A blank map
// with a fully working interface is the signature of this bug.
//
// The path is served from public/ and kept in step with the installed version
// by scripts/sync-maplibre-worker.mjs, which runs before dev and before build.
// A bare specifier here would NOT work: webpack does not resolve package names
// inside new URL(), so `new URL("maplibre-gl/dist/...", import.meta.url)`
// silently produces a 404 under /_next/static/chunks/.
//
// Module scope on purpose — it has to be set before any Map is constructed.
// ---------------------------------------------------------------------------
setWorkerUrl("/maplibre-gl-worker.mjs");
import type { MapCluster, MapPoint, MapResponse } from "@/app/api/travel/hotels/map/route";
import type { ClusterMember, PropertyFamily } from "@/lib/hotels/curated";
import { LUXURY_MAP_CATEGORIES, type LuxuryCategoryId } from "@/lib/hotels/luxuryTiers";
import { applyPaletteToMap, luxuryMapStyle, readStoredMapTheme, storeMapTheme, type MapTheme } from "@/lib/hotels/mapStyle";
import MapViewControls from "./map/MapViewControls";
import HotelDetailPanel, { type DetailTarget } from "./HotelDetailPanel";
import DestinationCard from "./map/DestinationCard";
import HotelMapSearchHeader, { type Destination } from "./map/HotelMapSearchHeader";
import { clearRecent, pushRecent, readRecent } from "@/lib/hotels/recentSearches";
import { decideViewAction, type BBox } from "@/lib/hotels/viewport";
import { useSavedIds } from "./map/SaveButton";
import { ThumbnailRegistry, thumbId, thumbnailSource } from "@/lib/hotels/markerThumbnails";
import HotelMapHoverCard, { type HoverTarget } from "./map/HotelMapHoverCard";
// Live Google Places discovery, layered over the indexed sources. See
// lib/places/liveAugment.ts for why it augments rather than replaces them.
import { discoverLive, liveStatusLabel, type LiveStatus } from "@/lib/places/discoverClient";
import { mergeLivePoints, toMapPoints } from "@/lib/places/liveAugment";
import AccessibleMarkerList, { type ListEntry } from "./map/AccessibleMarkerList";
import HotelResultsPanel from "./map/HotelResultsPanel";
import { isResultSort, type ResultSort } from "@/lib/hotels/resultSort";
import { priceLabel, stayFromParams, type StayContext } from "@/lib/hotels/mapPrices";
import { useMapRates } from "./map/useMapRates";
import StayPicker from "./map/StayPicker";
import RadiusControl, { type RadiusCentre } from "./map/RadiusControl";
import TravelContextChips from "./map/TravelContextChips";
import ResultsSheet, { type SheetSnap } from "./map/ResultsSheet";
import DrawControl from "./map/DrawControl";
import { useDrawArea } from "./map/useDrawArea";
import { encodeArea, parseArea, ringBBox, type Ring } from "@/lib/hotels/drawArea";
import { OVERLAY_SOURCES, overlayLayerSpecs } from "./map/overlays";
import { parseRouteParam, useTravelOverlays, type NearbyPoi } from "./map/useTravelOverlays";
import { parseRadius, type RadiusQuery } from "@/lib/hotels/radius";
import { circleBBox } from "@/lib/geo/geodesy";
import {
  LYR_HEATMAP,
  LYR_PRICE,
  LYR_PROPERTY_NAME,
  MARKER_LAYERS,
  PRICE_PILL_IMAGE,
  pricePillImage,
  buildFeatures,
  categoryColor,
  hashId,
  layerSpecs,
  INTERACTIVE_LAYERS,
  LYR_PULSE,
  bandFor,
  SRC_LEADERS,
  SRC_POINTS,
  SRC_PULSE,
  LYR_VECTOR,
  SRC_VECTOR,
  vectorLayerSpecs,
  vectorSourceSpec,
  type BuiltFeatures,
} from "./map/layers";
import { CategoryIcon, CloseIcon, SearchIcon } from "./map/icons";
import { startTracking, type UserLocation, type LocationTracker } from "@/lib/hotels/userLocation";
import { CompassConfidenceEstimator } from "@/lib/hotels/compassConfidence";
import { HeadingFusion } from "@/lib/hotels/headingFusion";

// ---------------------------------------------------------------------------
// The luxury hotel map.
//
// MapLibre over OpenFreeMap tiles, recoloured to a warm ivory palette by
// lib/hotels/mapStyle.ts. The map is the whole viewport and the whole
// navigation surface: a user discovers properties by moving the pointer, not by
// filling in a form.
//
// EVERYTHING IS DRAWN ON THE GPU. Markers used to be DOM buttons handed to
// MapLibre's Marker class — the approach MapLibre's own large-data guide names
// as the classic way to make a GL map slow, because every pin is a style
// recalculation on the main thread for every frame of a pan. They are now
// features in a GeoJSON source; see map/layers.ts.
//
// AND EVERYTHING IS ALSO IN THE DOM, ONCE. A canvas has nothing to focus, so
// AccessibleMarkerList renders the same features as real buttons off-screen.
// That is what makes the map keyboard-operable — which the DOM-marker version
// never actually was, because a pin's blur handler closed the card before Tab
// could reach it.
//
// THREE KINDS OF MARKER, and the differences carry information:
//
//   cluster   N curated properties, sized and coloured by N. The number is a
//             real count and clicking it zooms to exactly what it counted.
//   property  one curated luxury property, coloured by category, drawn with a
//             translucent ring when its position is approximate.
//   osm dot   any other hotel OpenStreetMap records here — small and quiet,
//             because OSM knows where it is and little else.
//
// HOVER IS THE PRIMARY INTERACTION, which makes the open/close timing the most
// important behaviour in the file. It lives here rather than in the card,
// because only this component sees both the markers and the card and can tell
// the difference between "the pointer left" and "the pointer is on its way".
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 350;

// --- user location layers ---------------------------------------------------
/** The GeoJSON source holding the user's live position. */
const SRC_USER_LOC = "hm-user-loc";
const LYR_USER_ACCURACY = "hm-user-accuracy";
const LYR_USER_DOT = "hm-user-dot";
const LYR_USER_DOT_INNER = "hm-user-dot-inner";
const LYR_USER_HEADING = "hm-user-heading";
/** How long the card stays after the pointer leaves both marker and card. Long
 *  enough to cross the gap between them, short enough not to feel stuck. */
const HOVER_GRACE_MS = 200;

/** World view: the whole map, at the first zoom the basemap labels cities. */
const DEFAULT_VIEW = { center: [20, 25] as [number, number], zoom: 3 };

/** Map movement, per the reference's timing. Never a teleport. */
const FLY_MS = 650;

/**
 * Ease-in-out cubic, for camera moves the reader did not initiate.
 *
 * MapLibre's default is a linear ramp, which starts and stops abruptly enough
 * that a long fly reads as the map being dragged rather than travelling. Easing
 * both ends makes the same duration feel deliberate.
 */
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** One full breath of the halo behind the active marker, in ms. */
const PULSE_MS = 1800;

/**
 * Initial camera from `?lat=&lng=&z=`.
 *
 * Makes a view shareable — "look at this hotel" is a link rather than a set of
 * directions. Anything malformed or out of range falls back to the world view
 * rather than throwing the map to Null Island.
 */
function viewFromUrl(): { center: [number, number]; zoom: number } {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  const q = new URLSearchParams(window.location.search);
  const lat = Number(q.get("lat"));
  const lng = Number(q.get("lng"));
  const z = Number(q.get("z"));
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return DEFAULT_VIEW;
  }
  return { center: [lng, lat], zoom: Number.isFinite(z) ? Math.min(18, Math.max(1, z)) : 14 };
}

// ---------------------------------------------------------------------------
// Search state in the URL.
//
// The camera (lat/lng/z) was already readable from the URL; filters, sort and
// the selected hotel now are too, and all of it is written back with
// replaceState as it changes. That is what makes Back from a hotel page — or a
// reload, or a shared link — return to the same place, the same filters and
// the same open hotel. Short flat keys, no JSON: `?stars=4&types=hotels,resorts`.
// Everything read is validated; anything unknown is dropped, never trusted.
// ---------------------------------------------------------------------------
const FAMILY_IDS: readonly PropertyFamily[] = ["hotels", "resorts", "villas"];

interface UrlSearchState {
  minStars: number;
  families: PropertyFamily[];
  categories: LuxuryCategoryId[];
  textFilter: string;
  exactOnly: boolean;
  sort: ResultSort;
  hotel: string | null;
  /** Stay dates and party (`?in=&out=&adults=`). Prices are asked for only
   *  with these — a rate without dates is a guess. */
  stay: StayContext | null;
  /** Radius search (`?near=lat,lng&r=5&rl=label`). */
  radius: RadiusQuery | null;
  radiusLabel: string;
  /** A drawn search area (`?area=lng,lat;...`), revalidated on read. */
  area: Ring | null;
}

/** Today in the reader's own calendar, as YYYY-MM-DD. */
function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function searchStateFromUrl(): UrlSearchState {
  const empty: UrlSearchState = { minStars: 0, families: [], categories: [], textFilter: "", exactOnly: false, sort: "recommended", hotel: null, stay: null, radius: null, radiusLabel: "", area: null };
  if (typeof window === "undefined") return empty;
  const q = new URLSearchParams(window.location.search);
  const list = (k: string) => (q.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const stars = Number(q.get("stars"));
  const catIds = new Set<string>(LUXURY_MAP_CATEGORIES.map((c) => c.id));
  const sort = q.get("sort");
  const hotel = q.get("hotel");
  return {
    minStars: Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : 0,
    families: list("types").filter((f): f is PropertyFamily => (FAMILY_IDS as readonly string[]).includes(f)),
    categories: list("cats").filter((c): c is LuxuryCategoryId => catIds.has(c)),
    textFilter: (q.get("q") ?? "").slice(0, 80),
    exactOnly: q.get("exact") === "1",
    sort: isResultSort(sort) ? sort : "recommended",
    hotel: hotel && /^[\w:.\-]{1,120}$/.test(hotel) ? hotel : null,
    stay: stayFromParams(q, todayLocalIso()),
    radius: parseRadius(q.get("near"), q.get("r")),
    area: parseArea(q.get("area")),
    radiusLabel: (q.get("rl") ?? "").replace(/[^\p{L}\p{N} .,'&()\-]/gu, "").slice(0, 80) || "this point",
  };
}

/** Write the current search into the URL without adding history entries
 *  (a pan is not a navigation). Unrelated params, like `?all=1`, survive. */
function writeSearchToUrl(s: Omit<UrlSearchState, "hotel"> & { hotel: string | null; camera?: { lat: number; lng: number; z: number } }) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  const set = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k));
  if (s.camera) {
    q.set("lat", s.camera.lat.toFixed(4));
    q.set("lng", s.camera.lng.toFixed(4));
    q.set("z", s.camera.z.toFixed(2));
  }
  set("stars", s.minStars ? String(s.minStars) : null);
  set("types", s.families.length ? [...s.families].sort().join(",") : null);
  set("cats", s.categories.length ? [...s.categories].sort().join(",") : null);
  set("q", s.textFilter.trim() || null);
  set("exact", s.exactOnly ? "1" : null);
  set("sort", s.sort !== "recommended" ? s.sort : null);
  set("hotel", s.hotel);
  set("in", s.stay?.checkIn ?? null);
  set("out", s.stay?.checkOut ?? null);
  set("adults", s.stay ? String(s.stay.adults) : null);
  set("near", s.radius ? `${s.radius.center.latitude.toFixed(5)},${s.radius.center.longitude.toFixed(5)}` : null);
  set("r", s.radius ? String(s.radius.km) : null);
  set("rl", s.radius ? s.radiusLabel : null);
  set("area", s.area ? encodeArea(s.area) : null);
  const next = `${window.location.pathname}${q.toString() ? `?${q}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Narrow a hit-test to the layers actually present in the style right now.
 *
 * `queryRenderedFeatures({ layers })` treats an unknown layer id as a caller
 * error and reports one per id — "The layer 'hm-photo' does not exist in the
 * map's style and cannot be queried for features" — on every pointer move,
 * which is how a single mismatch becomes a console full of noise.
 *
 * The set of drawn layers is genuinely dynamic, so the query list and the style
 * can disagree without anyone doing anything wrong:
 *   - `showRegistryTiles` decides whether LYR_VECTOR is ever added, and the
 *     handler below reads that flag from a closure the effect does not re-run
 *     when it changes;
 *   - a map torn down and rebuilt (React Strict Mode double-invokes effects in
 *     development) leaves the previous instance's handlers able to fire against
 *     a style that no longer holds its layers.
 *
 * Asking only about layers that exist is also the more honest question: the
 * hit-test wants what is under the cursor, and a layer that is not in the style
 * is drawing nothing to be under it. Filtering changes no outcome — a missing
 * layer contributed no features before either — it just stops the renderer
 * being asked something that cannot be answered.
 */
function layersInStyle(m: MapLibreMap, ids: string[]): string[] {
  return ids.filter((id) => Boolean(m.getLayer(id)));
}

/**
 * `showRegistryTiles` overlays the universal lodging registry (migration 0015)
 * as vector tiles beneath the curated markers.
 *
 * OFF BY DEFAULT because `universal_hotels` is empty until someone runs
 * scripts/ingest-hotel-seeds.mts — turning it on before ingest would add an
 * empty layer and a stream of 204s, which looks like a broken map rather than
 * an unpopulated one. Enable per-deployment once the registry has rows.
 */
export default function HotelMap({ showRegistryTiles = false }: { showRegistryTiles?: boolean } = {}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** id -> the full record behind a rendered feature. Feature properties can
   *  only hold primitives, so the objects live here. */
  const index = useRef<BuiltFeatures["index"]>(new Map());
  /** The feature currently lit by feature-state, so it can be cleared. */
  const litId = useRef<number | null>(null);
  /**
   * Which feature the pointer is currently over.
   *
   * mousemove fires per FRAME, so without this the hit test would call
   * setHover() sixty times a second and re-render the card on every one — the
   * same main-thread cost that moving off DOM markers was meant to remove,
   * reintroduced one layer up. Only a CHANGE of feature is a state change.
   */
  const hoveredId = useRef<string | null>(null);
  const cursorRef = useRef<string>("");
  const latest = useRef<{ clusters: MapCluster[]; points: MapPoint[] }>({ clusters: [], points: [] });

  /** Rolling compass-confidence estimate, and the fusion engine it feeds.
   *  Refs because both are stateful across updates and neither should ever
   *  trigger a re-render of its own. */
  const compass = useRef(new CompassConfidenceEstimator());
  const fusion = useRef(new HeadingFusion());
  const [hover, setHover] = useState<{ target: HoverTarget; anchor: { x: number; y: number } } | null>(null);
  /**
   * The current hover, readable from the map's event handlers.
   *
   * Those handlers are registered once, inside the `load` effect, so they close
   * over the FIRST render's `hover` forever. Reading state through a ref is how
   * the tap path can ask "is the card already showing this property?" and get
   * today's answer rather than `null`.
   */
  const hoverRef = useRef<{ target: HoverTarget; anchor: { x: number; y: number } } | null>(null);
  hoverRef.current = hover;
  /**
   * Does this device point coarsely (finger) rather than finely (mouse)?
   *
   * Read once and kept in a ref rather than state: it decides behaviour inside
   * an event handler and must never trigger a re-render. `matchMedia` is
   * guarded because this component is server-rendered too, where there is no
   * window to ask.
   */
  const coarsePointer = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    coarsePointer.current = mq.matches;
    // A hybrid laptop can gain or lose a touchscreen mid-session, and a mouse
    // plugged into a tablet changes the right answer. Cheap to follow.
    const onChange = (e: MediaQueryListEvent) => { coarsePointer.current = e.matches; };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Offline is not an error. With no connection the map keeps the last hotels
   * it loaded and says how old they are, instead of an outage banner — and it
   * reloads the view by itself when the connection returns.
   */
  const [offline, setOffline] = useState(false);
  /** When the hotels on screen were fetched (the response's own timestamp). */
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [meta, setMeta] = useState<Omit<MapResponse, "points" | "clusters"> | null>(null);
  const [noWebgl, setNoWebgl] = useState(false);
  const [selected, setSelected] = useState<DetailTarget | null>(null);
  /** The cluster whose destination card is currently open, or null. */
  const [destinationCluster, setDestinationCluster] = useState<MapCluster | null>(null);

  // --- user location tracking -----------------------------------------------
  //
  // THREE MODES, matching Google Maps' locate button behaviour:
  //   "off"     not tracking — the default
  //   "locate"  one-shot: centre the map, show the dot, do not follow
  //   "track"   continuous: the map follows, heading rotates the cone
  //
  // The transition is off → locate → track → off.
  const [trackMode, setTrackMode] = useState<"off" | "locate" | "track">("off");
  const [userLoc, setUserLoc] = useState<UserLocation | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const tracker = useRef<LocationTracker | null>(null);

  /** Push a location fix to the map's user-location source. */
  const paintUserLoc = useCallback((loc: UserLocation | null) => {
    const m = map.current;
    const src = m?.getSource(SRC_USER_LOC) as GeoJSONSource | undefined;
    if (!src) return;
    if (!loc) {
      src.setData(EMPTY_FC);
      compass.current.reset();
      fusion.current.reset();
      return;
    }

    // --- heading fusion ------------------------------------------------------
    //
    // The cone used to be drawn from `loc.heading`, the raw magnetometer
    // reading, which is wrong in two situations the reader never sees coming: a
    // compass thrown ninety degrees by a steel doorframe, and a stationary
    // phone whose reading wanders. Both drew a confident arrow.
    //
    // The fusion engine decides between the compass, the GPS course and (later)
    // a matched road bearing, and is allowed to answer "I do not know" — which
    // the layer filter below renders as a dot with NO cone rather than a cone
    // pointing at nothing.
    //
    // Run here rather than in a hook of its own on purpose: UserLocation
    // already carries compass heading, course, speed and accuracy, so a
    // separate hook would have to open a SECOND watchPosition. Two GPS
    // subscriptions cost battery and give two sources of truth about where the
    // reader is.
    if (loc.heading !== null) compass.current.push(loc.heading);
    const fused = fusion.current.update({
      compassHeading: loc.heading,
      compassConfidence: compass.current.confidence(),
      gpsCourse: loc.courseHeading,
      speed: loc.speed,
      positionAccuracy: loc.accuracy,
      // Map matching needs road geometry queried from the rendered tiles; that
      // is the next phase. Null is a supported input meaning "no opinion".
      mapMatch: null,
      now: loc.timestamp,
    });
    src.setData({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Point", coordinates: [loc.longitude, loc.latitude] },
        properties: {
          accuracy: loc.accuracy,
          lat: loc.latitude,
          // Absent, not zero, when the engine has no trustworthy heading — the
          // cone layer filters on `has`, so omitting it draws no cone at all.
          ...(fused.heading !== null ? { heading: fused.heading } : {}),
          // Drives the cone's spread: a wide translucent wedge is the honest
          // way to say "somewhere this way".
          headingConfidence: fused.confidence,
        },
      }],
    });
  }, []);

  // When tracking mode changes, start or stop the tracker.
  useEffect(() => {
    // Clear stale errors when mode changes.
    setLocError(null);

    if (trackMode === "off") {
      tracker.current?.stop();
      tracker.current = null;
      setUserLoc(null);
      paintUserLoc(null);
      return;
    }

    // Already tracking from a prior mode transition.
    if (tracker.current) return;

    let centred = false;
    tracker.current = startTracking(
      (loc) => {
        setUserLoc(loc);
        paintUserLoc(loc);

        // Centre the map on the first fix (both locate and track modes).
        if (!centred) {
          centred = true;
          programmatic.current = true;
          map.current?.flyTo({
            center: [loc.longitude, loc.latitude],
            zoom: Math.max(map.current.getZoom(), 14),
            duration: FLY_MS,
            easing: easeInOutCubic,
            essential: true,
          });
        }
        // In track mode, keep following.
        else if (trackMode === "track") {
          map.current?.easeTo({
            center: [loc.longitude, loc.latitude],
            duration: 400,
          });
        }
      },
      (msg) => {
        setLocError(msg);
        setTrackMode("off");
      }
    );

    return () => {
      tracker.current?.stop();
      tracker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackMode, paintUserLoc]);

  // Clear location error after 5 seconds.
  useEffect(() => {
    if (!locError) return;
    const t = setTimeout(() => setLocError(null), 5000);
    return () => clearTimeout(t);
  }, [locError]);

  // --- filters --------------------------------------------------------------
  //
  // `query` drives the header's suggestions only; `textFilter` narrows the map.
  // They were one value, which meant typing a destination silently emptied the
  // map while the user was still reading the list.
  const [query, setQuery] = useState("");
  const [textFilter, setTextFilter] = useState("");
  const [families, setFamilies] = useState<PropertyFamily[]>([]);
  const [categories, setCategories] = useState<LuxuryCategoryId[]>([]);
  const [minStars, setMinStars] = useState(0);
  const [exactOnly, setExactOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // --- results list ---------------------------------------------------------
  // The individual properties the map last painted — the list's only data.
  const [listPoints, setListPoints] = useState<MapPoint[]>([]);
  /** A card the pointer (or keyboard focus) is on, lighting its marker. */
  const [listHoverId, setListHoverId] = useState<string | null>(null);
  const [sort, setSort] = useState<ResultSort>("recommended");
  /** Map centre, for "distance from map centre" — updated on moveend only. */
  const [center, setCenter] = useState<{ latitude: number; longitude: number } | null>(null);
  /** Phones show one surface at a time. Desktop shows both. */
  /** Phones: how far the results sheet is pulled up over the map. */
  const [sheet, setSheet] = useState<SheetSnap>("peek");
  /** The reader's stay; null until they pick dates (then prices appear). */
  const [stay, setStay] = useState<StayContext | null>(null);

  // --- travel context: radius, airports, route, nearby places ---------------
  const [radius, setRadius] = useState<RadiusQuery | null>(null);
  const [radiusLabel, setRadiusLabel] = useState("");
  /** Read by `load` (registered once) — same pattern as `filters`. */
  const radiusRef = useRef<RadiusQuery | null>(null);
  radiusRef.current = radius;
  const [area, setArea] = useState<Ring | null>(null);
  const areaRef = useRef<Ring | null>(null);
  areaRef.current = area;
  /** True while the reader is drawing — the hotel handlers stand down. */
  const drawing = useRef(false);
  const [airportsOn, setAirportsOn] = useState(false);
  const [routeCodes, setRouteCodes] = useState<[string, string] | null>(null);
  const [nearbyPois, setNearbyPois] = useState<NearbyPoi[]>([]);
  /** True once the style and every source exist, so overlays can be drawn. */
  const [mapReady, setMapReady] = useState(false);
  /** Whether the URL gave a camera — if not, a route flies to its destination. */
  const urlHadCamera = useRef(false);

  // --- map view: theme, density, fullscreen ---------------------------------
  // The theme is read from storage AFTER mount (the server has no storage) —
  // the map itself is built client-side from the stored value, so there is no
  // flash of the other palette, only these buttons settling.
  const [mapTheme, setMapTheme] = useState<MapTheme>("dark");
  const [density, setDensity] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const mapColumn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMapTheme(readStoredMapTheme());
    setFullscreenSupported(Boolean(document.fullscreenEnabled));
    const onFs = () => setFullscreen(document.fullscreenElement === mapColumn.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void mapColumn.current?.requestFullscreen().catch(() => {});
  }, []);
  const toggleTheme = useCallback(() => {
    setMapTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      storeMapTheme(next);
      return next;
    });
  }, []);
  /** The URL's ?hotel=, reopened once its point has loaded. */
  const pendingHotel = useRef<string | null>(null);
  /** False until the URL has been READ, so nothing writes over it first. */
  const urlRead = useRef(false);

  // Restore the search from the URL AFTER mount, not in the initial state: the
  // server renders this component without a URL, and seeding state from one
  // during render would give the client markup the server never produced.
  // The map's first load happens later (it waits for the style), so it already
  // sees these values.
  useEffect(() => {
    const s = searchStateFromUrl();
    setTextFilter(s.textFilter);
    setFamilies(s.families);
    setCategories(s.categories);
    setMinStars(s.minStars);
    setExactOnly(s.exactOnly);
    setSort(s.sort);
    setStay(s.stay);
    setRadius(s.radius);
    setRadiusLabel(s.radius ? s.radiusLabel : "");
    setArea(s.area);
    const q = new URLSearchParams(window.location.search);
    setRouteCodes(parseRouteParam(q.get("route")));
    urlHadCamera.current = q.has("lat") && q.has("lng");
    pendingHotel.current = s.hotel;
    urlRead.current = true;
  }, []);

  // --- prices ---------------------------------------------------------------
  //
  // Live rates for the hotels on screen, once the reader has chosen dates.
  // The labels reach the GPU through a ref read by `paint` (registered on map
  // events once, like `filters`), and a change repaints what is already drawn.
  const { rates, status: ratesStatus } = useMapRates(listPoints, center, stay);

  const overlays = useTravelOverlays({
    map: map.current,
    ready: mapReady,
    airportsOn,
    routeCodes,
    radius,
    pois: nearbyPois,
    // A shared route link with no camera lands on the destination city.
    onRouteLoaded: (r) => {
      if (urlHadCamera.current) return;
      urlHadCamera.current = true;
      programmatic.current = true;
      map.current?.flyTo({ center: [r.to.longitude, r.to.latitude], zoom: 11, duration: FLY_MS, easing: easeInOutCubic, essential: true });
    },
  });

  const draw = useDrawArea({
    map: map.current,
    ready: mapReady,
    area,
    onComplete: (ring) => {
      setArea(ring);
      const b = ringBBox(ring);
      programmatic.current = true;
      map.current?.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], { padding: 56, duration: FLY_MS, easing: easeInOutCubic });
    },
  });
  drawing.current = draw.mode !== null;

  /** What a radius can be drawn around — only real places the reader has in
   *  front of them. The open hotel first, since that is the usual question. */
  const radiusCentres = useMemo<RadiusCentre[]>(() => {
    const out: RadiusCentre[] = [];
    if (selected) out.push({ label: selected.name, point: { latitude: selected.latitude, longitude: selected.longitude } });
    if (overlays.selectedAirport) {
      const a = overlays.selectedAirport;
      out.push({ label: `${a.name} (${a.iata})`, point: { latitude: a.latitude, longitude: a.longitude } });
    }
    if (userLoc) out.push({ label: "My location", point: { latitude: userLoc.latitude, longitude: userLoc.longitude } });
    if (center) out.push({ label: "Map centre", point: center });
    return out;
  }, [selected, overlays.selectedAirport, userLoc, center]);

  /** Apply a radius: draw it, fit the map to it, and reload for the circle. */
  const applyRadius = useCallback((r: RadiusQuery | null, label = "") => {
    setRadius(r);
    setRadiusLabel(r ? label : "");
    if (!r) return;
    const b = circleBBox(r.center, r.km);
    programmatic.current = true;
    map.current?.fitBounds([[b.minLng, b.minLat], [b.maxLng, b.maxLat]], { padding: 48, duration: FLY_MS, easing: easeInOutCubic });
  }, []);
  const priceLabels = useRef<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const now = Date.now();
    const labels = new Map<string, string>();
    for (const [id, r] of rates) {
      const l = priceLabel(r, now);
      if (l) labels.set(id, l);
    }
    priceLabels.current = labels;
    const m = map.current;
    if (m?.getSource(SRC_POINTS)) paint(latest.current.clusters, latest.current.points);
    // `paint` is stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates]);

  // Status of the LIVE layer only. The indexed sources have their own
  // `error` state; conflating them would report a working map as broken
  // whenever Places is down.
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("idle");

  // What "More filters" stands for: everything NOT already named by its own
  // button in the header. `minStars` is excluded because the Rating button
  // reports it directly — counting it here would show the same filter twice.
  const moreFilterCount =
    categories.length + (exactOnly ? 1 : 0) + (textFilter.trim() ? 1 : 0);
  const filterKey = useMemo(
    () =>
      `${[...families].sort().join(",")}|${[...categories].sort().join(",")}|${minStars}|${textFilter.trim()}|${exactOnly}`,
    [families, categories, minStars, textFilter, exactOnly]
  );
  // Read inside `load` without making it a dependency: `load` is wired into
  // MapLibre event handlers once at mount, and rebuilding it on every keystroke
  // would tear those down and re-register them mid-pan.
  const filters = useRef({ textFilter, families, categories, minStars, exactOnly });
  filters.current = { textFilter, families, categories, minStars, exactOnly };

  // --- hover timing ---------------------------------------------------------
  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHover(null), HOVER_GRACE_MS);
  }, [cancelClose]);

  /** Light a feature via feature-state — a GPU-side hover, no DOM involved. */
  const light = useCallback((featureId: number | null) => {
    const m = map.current;
    if (!m) return;
    if (litId.current !== null && litId.current !== featureId) {
      m.setFeatureState({ source: SRC_POINTS, id: litId.current }, { hover: false });
    }
    if (featureId !== null) {
      m.setFeatureState({ source: SRC_POINTS, id: featureId }, { hover: true });
    }
    litId.current = featureId;
  }, []);

  const openFor = useCallback(
    (id: string, featureId: number | null) => {
      const m = map.current;
      const entry = index.current.get(id);
      if (!m || !entry) return;
      cancelClose();
      light(featureId);
      const pt = m.project(entry.lngLat);
      const target: HoverTarget =
        entry.kind === "cluster"
          ? { kind: "cluster", cluster: entry.cluster! }
          : { kind: "property", point: entry.point! };
      setHover({ target, anchor: { x: pt.x, y: pt.y } });
    },
    [cancelClose, light]
  );

  /** Show the destination card for a cluster. The card carries its own CTA that
   *  zooms into the region — the reader sees the overview FIRST. */
  const showDestinationCard = useCallback((c: MapCluster) => {
    setDestinationCluster(c);
    setHover(null);
  }, []);

  /** Zoom a cluster to exactly the properties it counted. */
  const expandCluster = useCallback((c: MapCluster) => {
    programmatic.current = true;
    map.current?.fitBounds(
      [[c.bounds.minLng, c.bounds.minLat], [c.bounds.maxLng, c.bounds.maxLat]],
      { padding: 120, maxZoom: 15, duration: FLY_MS, easing: easeInOutCubic }
    );
    setHover(null);
    setDestinationCluster(null);
  }, []);

  const openDetail = useCallback((p: MapPoint | ClusterMember) => {
    setSelected({
      id: p.id,
      name: p.name,
      latitude: p.latitude,
      longitude: p.longitude,
      city: p.city,
      country: p.country,
      stars: p.stars,
      placeId: p.placeId,
      source: "source" in p ? p.source : undefined,
    });
    setHover(null);
  }, []);

  /**
   * Push the built features into the two GeoJSON sources.
   *
   * Wrapped, because this is the single point where a bug stops being visible.
   * Building features projects every coordinate through MapLibre; if any of
   * that throws, the sources keep their previous contents and the map simply
   * shows nothing — no error, no empty state, just a basemap and no pins, which
   * is indistinguishable from "there are no hotels here". Catching it turns a
   * silent blank into a message the user and the console can both act on.
   */
  const paint = useCallback((clusters: MapCluster[], points: MapPoint[]) => {
    const m = map.current;
    if (!m || !m.getSource(SRC_POINTS)) return;
    try {
      // Where `styleimagemissing` looks up what to fetch. A GeoJSON feature can
      // only carry primitives, and the event hands back nothing but the icon
      // id, so the id → (url, ring colour) mapping has to live beside the map.
      // Rebuilt each paint from the features actually drawn, so it never grows
      // past what is on screen.
      const srcs = new Map<string, { url: string; ring: string }>();
      for (const p of points) {
        const url = thumbnailSource(p);
        if (url && p.source === "curated") {
          srcs.set(thumbId(p.id), { url, ring: categoryColor(p) });
        }
      }
      thumbSrcById.current = srcs;

      // The Saved filter narrows what is DRAWN, not what is fetched — it is
      // answered from the response already in hand, so toggling it costs no
      // request and is instant.
      //
      // Read through a ref, not from props, for the same reason `load` does:
      // `paint` is registered on MapLibre events once at mount, and changing
      // its identity would re-run the mount effect and rebuild the whole map.
      const { savedOnly, savedIds } = saved.current;
      if (savedOnly) {
        // CLUSTERS ARE DROPPED ENTIRELY, not filtered. A cluster's count is of
        // every property in its cell; showing "38" over a cell holding two
        // saved hotels would be a straightforward lie, and there is no way to
        // recount from here — the members are not in the response.
        clusters = [];
        points = points.filter((p) => savedIds.has(p.id));
      }
      const built = buildFeatures(clusters, points, m, null, priceLabels.current);
      index.current = built.index;
      (m.getSource(SRC_POINTS) as GeoJSONSource).setData(built.points);
      (m.getSource(SRC_LEADERS) as GeoJSONSource).setData(built.leaders);
      setEntries([...built.index.entries()].map(([id, e]) => ({ id, ...e })));
      // The results list shows exactly what was just drawn — same array, same
      // Saved filter — so list and markers cannot disagree.
      setListPoints(points);
    } catch (e) {
      console.error("hotel map: could not draw markers", e);
      setError("Could not draw the markers for this view");
    }
  }, []);

  /** Fetch points for the current viewport. Debounced and cancellable, so a
   *  fast pan issues one request rather than one per frame. */
  const load = useCallback(
    async (bounds: LngLatBounds, zoom: number) => {
      inflight.current?.abort();
      // No connection: keep what is drawn, say so, and wait for "online".
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setOffline(true);
        setLoading(false);
        return;
      }
      const ac = new AbortController();
      inflight.current = ac;
      setLoading(true);

      // getBounds() reports the viewport, which at low zoom spans the world more
      // than once — longitudes come back beyond ±180. Clamp before sending so
      // the request describes a real region of the earth.
      const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
      // A radius search asks about the CIRCLE, wherever the camera is: the
      // list shows everything within N km even after a pan, and the server
      // keeps only what is truly inside (route.ts, near=/radiusKm=).
      const rq = radiusRef.current;
      const ar = areaRef.current;
      // A drawn area is the tighter question when both are set; the server
      // applies both either way.
      const rb = ar ? ringBBox(ar) : rq ? circleBBox(rq.center, rq.km) : null;
      const west = clamp(rb ? rb.minLng : bounds.getWest(), -180, 180);
      const south = clamp(rb ? rb.minLat : bounds.getSouth(), -90, 90);
      const east = clamp(rb ? rb.maxLng : bounds.getEast(), -180, 180);
      const north = clamp(rb ? rb.maxLat : bounds.getNorth(), -90, 90);
      const bbox = [west, south, east, north].map((n) => n.toFixed(4)).join(",");

      const f = filters.current;
      const params = new URLSearchParams({ bbox, z: zoom.toFixed(2) });
      if (rq) {
        params.set("near", `${rq.center.latitude.toFixed(5)},${rq.center.longitude.toFixed(5)}`);
        params.set("radiusKm", String(rq.km));
      }
      if (ar) params.set("area", encodeArea(ar));
      if (f.families.length) params.set("families", f.families.join(","));
      if (f.categories.length) params.set("categories", f.categories.join(","));
      if (f.minStars) params.set("minStars", String(f.minStars));
      if (f.textFilter.trim()) params.set("q", f.textFilter.trim());
      if (f.exactOnly) params.set("exactOnly", "1");

      try {
        const res = await fetch(`/api/travel/hotels/map?${params}`, { signal: ac.signal });
        if (!res.ok) throw new Error(`hotels ${res.status}`);
        const data: MapResponse = await res.json();
        loadedView.current = {
          bbox: { minLng: west, minLat: south, maxLng: east, maxLat: north },
          zoom,
        };
        setViewDrifted(false);
        latest.current = { clusters: data.clusters, points: data.points };
        paint(data.clusters, data.points);
        const { points: _points, clusters: _clusters, ...rest } = data;
        setMeta(rest);
        setError(null);
        setOffline(false);
        setLoadedAt(data.fetchedAt);

        // The route stopped waiting for OpenStreetMap to answer fast. Ask once
        // more for the same view, waiting this time (see the route's bounded
        // wait), and repaint when it lands. Shares `ac`, so a pan cancels it;
        // live Google points already merged into this view are kept.
        if (data.osmDeferred) {
          void (async () => {
            try {
              const full = new URLSearchParams(params);
              full.set("osm", "wait");
              const r = await fetch(`/api/travel/hotels/map?${full}`, { signal: ac.signal });
              if (!r.ok) return;
              const d: MapResponse = await r.json();
              if (ac.signal.aborted || inflight.current !== ac) return;
              const live = latest.current.points.filter((p) => p.source === "google-live");
              const points = live.length ? mergeLivePoints(d.points, live).points : d.points;
              latest.current = { clusters: d.clusters, points };
              paint(d.clusters, points);
              const { points: _p, clusters: _c, ...m } = d;
              setMeta(m);
            } catch {
              // Aborted or failed: the first answer stands, and says so.
            }
          })();
        }

        // --- live Google Places augmentation ---------------------------------
        //
        // Fired AFTER the indexed sources have already painted, and never
        // awaited by them. The snapshot answers instantly and covers the
        // world; live discovery covers whatever rectangle is actually on
        // screen, including properties the harvest never visited.
        //
        // Deliberately non-blocking and failure-tolerant: when Places API is
        // unavailable the map keeps exactly what it just drew, and the only
        // visible change is a quiet notice. It shares `ac` so a fast pan
        // cancels the live call along with the request that started it.
        //
        // "Confirmed positions only" SUPPRESSES this layer entirely.
        //
        // That filter is applied server-side by /api/travel/hotels/map, and
        // live points are merged here, afterwards — so without this guard they
        // would bypass it completely and the map would show unconfirmed pins
        // while the box was ticked.
        //
        // Suppressing rather than filtering is the honest reading: `precision`
        // is `exact` only when the curated resolver confirmed the building
        // against Google under its own gates. A Text Search result has had no
        // such check, so NO live point can honestly claim a confirmed
        // position — filtering them would always remove all of them anyway,
        // and skipping the request saves a billed call.
        if (f.exactOnly) {
          setLiveStatus("idle");
          return;
        }

        void (async () => {
          const live = await discoverLive(
            { north, south, east, west },
            f.textFilter.trim() || undefined,
            ac.signal
          );
          if (ac.signal.aborted || inflight.current !== ac) return;

          setLiveStatus(live.status);
          if (!live.places.length) return;

          const merged = mergeLivePoints(latest.current.points, toMapPoints(live.places));
          if (!merged.added) return;

          // Repaint through the SAME path the indexed load uses, so clusters,
          // hover targets and the accessible list all recompute together
          // rather than drifting out of step with the markers.
          latest.current = { clusters: latest.current.clusters, points: merged.points };
          paint(latest.current.clusters, merged.points);
        })();
      } catch (e) {
        // Check the SIGNAL, not just the error name. Aborting during fetch()
        // raises AbortError, but aborting while res.json() is still reading the
        // body raises SyntaxError: "Unexpected end of JSON input" — a truncated
        // read, not a server fault. Matching on the name alone let that surface
        // as a spurious "unavailable" banner every time a fast pan superseded
        // an in-flight request.
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setOffline(true);
          return;
        }
        setError("Could not reach the hotel service");
      } finally {
        if (inflight.current === ac) setLoading(false);
      }
    },
    [paint]
  );

  useEffect(() => {
    if (!container.current || map.current) return;

    // MapLibre is a WebGL2 renderer with no 2D fallback. When the context is
    // unavailable — hardware acceleration off, a blocklisted driver, a headless
    // or remote session — the constructor throws from deep inside GPU init and
    // the error surfaces as "Cannot read properties of undefined (reading '0')",
    // which says nothing about the cause and takes the whole route down.
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2");
    if (!gl) {
      setNoWebgl(true);
      return;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();

    const ac = new AbortController();
    let disposed = false;

    void (async () => {
      const style = await luxuryMapStyle(ac.signal, readStoredMapTheme());
      if (disposed || !container.current) return;

      let m: MapLibreMap;
      try {
        const view = viewFromUrl();
        m = new MapLibreMap({
          container: container.current,
          style,
          center: view.center,
          zoom: view.zoom,
          minZoom: 1,
          maxZoom: 18,
          // The built-in control clashes with the design; attribution is
          // rendered in the status bar instead, where the licences still get
          // the visible credit they require.
          attributionControl: false,
        });
      } catch {
        setNoWebgl(true);
        return;
      }
      map.current = m;

      m.on("load", () => {
        if (disposed) return;
        m.addSource(SRC_LEADERS, { type: "geojson", data: EMPTY_FC });
        // `generateId` is off: ids are assigned in buildFeatures so they stay
        // stable across repaints, which is what makes feature-state hover
        // survive a pan.
        m.addSource(SRC_POINTS, { type: "geojson", data: EMPTY_FC });
        m.addSource(SRC_PULSE, { type: "geojson", data: EMPTY_FC });

        // Registry tiles go in FIRST so every curated layer added below draws
        // on top of them. Order here is z-order: the curated set is the
        // product and must never be occluded by the long tail.
        if (showRegistryTiles) {
          m.addSource(SRC_VECTOR, vectorSourceSpec());
          for (const spec of vectorLayerSpecs()) {
            m.addLayer(spec as Parameters<typeof m.addLayer>[0]);
          }
        }

        // Travel overlays (radius, route, nearby places, airports) go in
        // BEFORE the hotel layers, so a hotel pin is always drawn on top and
        // always wins a hit-test.
        for (const id of OVERLAY_SOURCES) m.addSource(id, { type: "geojson", data: EMPTY_FC });
        for (const spec of overlayLayerSpecs()) m.addLayer(spec);

        // The price pill, registered before the layer that draws it.
        if (!m.hasImage(PRICE_PILL_IMAGE)) {
          const pill = pricePillImage();
          m.addImage(PRICE_PILL_IMAGE, { width: pill.width, height: pill.height, data: pill.data }, pill.options);
        }

        for (const spec of layerSpecs()) m.addLayer(spec);

        // Native scale bar, metric. Styled for the dark chrome by the map
        // column's classes; top-left keeps it clear of every other control.
        m.addControl(new ScaleControl({ maxWidth: 96, unit: "metric" }), "top-left");

        // --- user location layers -------------------------------------------
        // Source: one point with accuracy (metres) and heading (degrees) as
        // properties. Empty until the first fix arrives.
        m.addSource(SRC_USER_LOC, { type: "geojson", data: EMPTY_FC });

        // Accuracy circle — metres converted to screen pixels by MapLibre's
        // `circle-radius` expression, which can read the zoom and do the math.
        m.addLayer({
          id: LYR_USER_ACCURACY,
          type: "circle",
          source: SRC_USER_LOC,
          paint: {
            // Accuracy in metres → pixels at the current zoom/latitude.
            // Formula: pixels = metres / (cos(lat) × 78271.484 / 2^zoom)
            // MapLibre resolves this per frame, so the circle scales with zoom.
            "circle-radius": [
              "interpolate", ["exponential", 2], ["zoom"],
              0, 0,
              20, [
                "/",
                ["get", "accuracy"],
                ["*", ["cos", ["*", ["get", "lat"], ["/", ["pi"], 180]]], 0.075]
              ],
            ],
            "circle-color": "#4285F4",
            "circle-opacity": 0.12,
            "circle-stroke-width": 0,
            "circle-pitch-alignment": "map",
          },
        });

        // Outer ring of the blue dot.
        m.addLayer({
          id: LYR_USER_DOT,
          type: "circle",
          source: SRC_USER_LOC,
          paint: {
            "circle-radius": 11,
            "circle-color": "#FFFFFF",
            "circle-pitch-alignment": "map",
          },
        });

        // Inner blue dot.
        m.addLayer({
          id: LYR_USER_DOT_INNER,
          type: "circle",
          source: SRC_USER_LOC,
          paint: {
            "circle-radius": 7,
            "circle-color": "#4285F4",
            "circle-pitch-alignment": "map",
          },
        });

        // Heading cone — a triangle pointing in the compass direction.
        // Built as a symbol layer so it can be rotated per feature.
        // The icon is generated once below as a tiny canvas image.
        m.addLayer({
          id: LYR_USER_HEADING,
          type: "symbol",
          source: SRC_USER_LOC,
          // No heading, no cone. The fusion engine omits the property entirely
          // when it has nothing trustworthy, and a dot with no cone is the
          // honest rendering of "I know where you are, not which way you face".
          filter: ["has", "heading"],
          layout: {
            "icon-image": "user-heading-cone",
            // UNCERTAINTY IS DRAWN AS SIZE. A crisp cone at 20% confidence is
            // the specific lie a confident-arrow app tells; growing the wedge
            // as confidence falls makes a doubtful heading look doubtful.
            // Interpolated rather than stepped so it breathes as confidence
            // recovers instead of snapping between two widths.
            "icon-size": [
              "interpolate", ["linear"], ["coalesce", ["get", "headingConfidence"], 0],
              0, 0.95,
              1, 0.55,
            ],
            "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            // Push it away from the dot centre so it sits at the edge.
            "icon-offset": [0, -20],
          },
        });

        // Generate the heading cone icon: a simple triangle pointing up.
        if (!m.hasImage("user-heading-cone")) {
          const sz = 48;
          const canvas = document.createElement("canvas");
          canvas.width = sz;
          canvas.height = sz;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "rgba(66, 133, 244, 0.55)";
          ctx.beginPath();
          ctx.moveTo(sz / 2, 2);
          ctx.lineTo(sz - 6, sz - 2);
          ctx.lineTo(sz / 2, sz * 0.65);
          ctx.lineTo(6, sz - 2);
          ctx.closePath();
          ctx.fill();
          m.addImage("user-heading-cone", ctx.getImageData(0, 0, sz, sz), { pixelRatio: 2 });
        }

        // Photograph markers, loaded ON DEMAND rather than up front.
        //
        // MapLibre fires this for an `icon-image` it does not hold, which makes
        // it exactly the right hook: only the thumbnails for markers actually
        // in view are ever fetched or decoded, and panning away costs nothing.
        // Loading all 141 at mount would decode a megabyte of images for a
        // world view that renders none of them.
        thumbs.current = new ThumbnailRegistry(m);
        m.on("styleimagemissing", (e: { id: string }) => {
          const src = thumbSrcById.current.get(e.id);
          if (!src) return;
          void thumbs.current?.ensure(e.id, src.url, src.ring);
        });

        // ONE hit-test replaces per-marker DOM listeners: the renderer is asked
        // what sits under the pointer, instead of 400 elements each waiting for
        // an event that will only ever reach one of them.
        m.on("mousemove", (ev) => {
          // Drawing an area: the pointer belongs to the outline, not to pins.
          if (drawing.current) return;
          // Curated layers are queried FIRST and registry pins only as a
          // fallback, so a registry pin sitting under a curated one can never
          // steal its hover. The curated set is the product.
          const layers = layersInStyle(
            m,
            showRegistryTiles ? [...INTERACTIVE_LAYERS, LYR_VECTOR] : INTERACTIVE_LAYERS
          );
          if (!layers.length) return;
          const hit = m.queryRenderedFeatures(ev.point, { layers })[0] as
            | MapGeoJSONFeature
            | undefined;

          // A vector-tile feature carries its facts in `properties` rather than
          // in `index`, which only holds records built from the GeoJSON route.
          // Registering it on demand means openFor below works unchanged for
          // both kinds of pin.
          if (hit && hit.layer?.id === LYR_VECTOR) {
            const props = hit.properties as Record<string, unknown>;
            const rid = String(props.id ?? "");
            if (rid && !index.current.has(rid)) {
              const geom = hit.geometry as GeoJSON.Point;
              const [lng, lat] = geom.coordinates as [number, number];
              index.current.set(rid, {
                kind: "property",
                lngLat: [lng, lat],
                point: {
                  id: rid,
                  kind: "property",
                  source: "registry",
                  latitude: lat,
                  longitude: lng,
                  name: String(props.name ?? "Unnamed property"),
                  city: "",
                  country: "",
                  // `stars` absent is NOT zero — a property nobody has
                  // classified must not render as a zero-star hotel.
                  stars: typeof props.stars === "number" ? props.stars : undefined,
                  hotelType: String(props.property_type ?? "hotel"),
                },
              } as never);
            }
          }

          // Writing style.cursor is a DOM write; only do it on a change.
          const wanted = hit ? "pointer" : "";
          if (cursorRef.current !== wanted) {
            m.getCanvas().style.cursor = wanted;
            cursorRef.current = wanted;
          }

          const id = hit ? (hit.properties.id as string) : null;
          if (id === hoveredId.current) return; // same feature, nothing changed
          hoveredId.current = id;

          if (!id) {
            scheduleClose();
            light(null);
            return;
          }
          openFor(id, (hit!.id as number) ?? null);
        });

        // Leaving the canvas entirely is not a mousemove, so it needs its own
        // handler — otherwise the card stays open when the pointer exits onto
        // the header or off the window.
        m.on("mouseout", () => {
          hoveredId.current = null;
          light(null);
          scheduleClose();
        });

        m.on("click", (ev) => {
          if (drawing.current) return;
          // Same guard as the mousemove hit-test above: a click can land during
          // the same window in which the style does not hold every layer.
          const clickLayers = layersInStyle(m, INTERACTIVE_LAYERS);
          if (!clickLayers.length) return;
          const hit = m.queryRenderedFeatures(ev.point, { layers: clickLayers })[0] as
            | MapGeoJSONFeature
            | undefined;
          if (!hit) {
            setHover(null);
            return;
          }
          const id = hit.properties.id as string;
          const entry = index.current.get(id);
          if (!entry) return;

          // A cluster means the same thing under either input: show me what you
          // counted. It now answers that with the destination card rather than
          // an immediate zoom — the card names the place, counts it by family
          // and prices its top properties, and carries the zoom as its own CTA.
          // Zooming first threw the reader into a viewport with no explanation
          // of what they had opened. Only the property branch differs.
          if (entry.kind === "cluster") {
            showDestinationCard(entry.cluster!);
            return;
          }

          // TOUCH HAS NO HOVER, so a tap has to do the work of two gestures.
          //
          // On a mouse the card is already open by the time a click lands — the
          // pointer had to cross the marker to get there — so a click is
          // unambiguously "I have seen the preview, show me the whole thing".
          // On a touch screen `mousemove` never fires, so going straight to the
          // detail panel means the preview card is unreachable: the reader is
          // dropped into a full-screen surface for a marker they were only
          // pointing at.
          //
          // So on a coarse pointer the first tap opens the card and the second
          // opens the detail. The state that distinguishes them is the card
          // already being open for THIS property — no extra timer, no
          // double-tap window, and tapping a different marker still just moves
          // the card, which is what the gesture looks like it should do.
          if (coarsePointer.current) {
            const showing =
              hoverRef.current?.target.kind === "property" &&
              hoverRef.current.target.point.id === id;
            if (!showing) {
              hoveredId.current = id;
              openFor(id, (hit.id as number) ?? null);
              return;
            }
          }

          openDetail(entry.point!);
        });

        void load(m.getBounds(), m.getZoom());
        const c0 = m.getCenter();
        setCenter({ latitude: c0.lat, longitude: c0.lng });
        setMapReady(true);
      });

      const schedule = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void load(m.getBounds(), m.getZoom()), DEBOUNCE_MS);
      };
      m.on("moveend", () => {
        // Feeds the list's distances and the URL's camera. State setter, so
        // it is stable and does not rebuild this effect.
        const c = m.getCenter();
        setCenter({ latitude: c.lat, longitude: c.lng });
        // Our own camera moves always load: the reader asked to go somewhere, so
        // making them then ask again for what is there would be absurd.
        if (programmatic.current) {
          programmatic.current = false;
          schedule();
          return;
        }
        const b = m.getBounds();
        const action = decideViewAction(loadedView.current, {
          bbox: {
            minLng: b.getWest(), minLat: b.getSouth(),
            maxLng: b.getEast(), maxLat: b.getNorth(),
          },
          zoom: m.getZoom(),
        });
        if (action === "refetch") schedule();
        else if (action === "offer") setViewDrifted(true);
      });
      // Spiderfy offsets are computed in SCREEN space, so they have to be
      // rebuilt when the scale changes — otherwise a fanned group drifts apart
      // as you zoom and the leader lines stretch across the city.
      m.on("zoomend", () => paint(latest.current.clusters, latest.current.points));
      // Keep an open card pinned to its marker while the map moves.
      m.on("move", () => {
        setHover((h) => {
          if (!h) return h;
          const at: [number, number] =
            h.target.kind === "cluster"
              ? [h.target.cluster.longitude, h.target.cluster.latitude]
              : [h.target.point.longitude, h.target.point.latitude];
          const pt = m.project(at);
          return { ...h, anchor: { x: pt.x, y: pt.y } };
        });
      });
    })();

    return () => {
      disposed = true;
      ac.abort();
      if (timer.current) clearTimeout(timer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      inflight.current?.abort();
      thumbs.current?.dispose();
      thumbs.current = null;
      map.current?.remove();
      map.current = null;
    };
    // `showRegistryTiles` is listed even though it cannot currently change in
    // place: it is derived from a server-rendered search param (?all=1) in
    // hotels/map/page.tsx, so flipping it is a navigation and the whole map
    // remounts anyway. It belongs here regardless — the effect decides whether
    // LYR_VECTOR is added at all and which layers are interactive, so if the
    // prop ever becomes stateful a rebuild is the correct response, not a
    // stale layer set. Listing a value that never changes costs nothing;
    // omitting it would have been a real bug the day someone made it dynamic.
  }, [load, paint, openFor, showDestinationCard, openDetail, scheduleClose, light, showRegistryTiles]);

  // Connection lost / back. Losing it only flags the state (requests would
  // fail anyway); regaining it reloads the current view so nothing stays stale.
  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => {
      setOffline(false);
      const m = map.current;
      if (m) void load(m.getBounds(), m.getZoom());
    };
    if (navigator.onLine === false) setOffline(true);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [load]);

  // A filter change re-asks the same viewport, on the same debounce as a pan so
  // typing issues one request rather than one per character.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(m.getBounds(), m.getZoom()), DEBOUNCE_MS);
  }, [filterKey, radius, area, load]);

  // Escape closes whatever is open, innermost first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selected) setSelected(null);
      else if (hover) setHover(null);
      else if (filtersOpen) setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, hover, filtersOpen]);

  // --- search suggestions ---------------------------------------------------
  //
  // Built from what the last response actually returned, so every row is
  // somewhere the map can go and every count beside one is real. A hardcoded
  // list of glamorous cities would look identical until somebody picked one the
  // dataset holds nothing in.
  const suggestions: Destination[] = useMemo(() => {
    const { clusters, points } = latest.current;
    const q = query.trim().toLowerCase();
    const hit = (s: string) => !q || s.toLowerCase().includes(q);

    const destinations: Destination[] = clusters
      .filter((c) => hit(c.label))
      .slice(0, 6)
      .map((c) => ({
        label: c.label,
        sublabel: c.sublabel,
        latitude: c.latitude,
        longitude: c.longitude,
        count: c.count,
        kind: "destination" as const,
      }));

    const properties: Destination[] = points
      .filter((p) => p.source === "curated" && hit(p.name))
      .slice(0, 6)
      .map((p) => ({
        label: p.name,
        sublabel: [p.city, p.country].filter(Boolean).join(", "),
        latitude: p.latitude,
        longitude: p.longitude,
        count: 1,
        kind: "property" as const,
      }));

    return [...destinations, ...properties];
    // `latest` is a ref, so writing it does not re-render and the linter cannot
    // see it as a dependency. `meta` is set from the SAME response, one line
    // later, so listing it is what makes this recompute when new data arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, query]);

  // Recent searches. Seeded from localStorage AFTER mount rather than in the
  // initial state, because the server renders this component too and reading
  // the store during render would produce markup the client cannot reproduce.
  // Starting empty and filling in on mount means the first paint matches.
  const [recent, setRecent] = useState<Destination[]>([]);
  useEffect(() => setRecent(readRecent()), []);

  // Saved hotels, and whether the map is currently showing only those.
  const savedIds = useSavedIds();
  const [savedOnly, setSavedOnly] = useState(false);
  // Mirrored into a ref so `paint` can read it without taking it as a
  // dependency — see the note inside `paint`.
  const saved = useRef({ savedOnly, savedIds });
  saved.current = { savedOnly, savedIds };

  /** On-demand photograph markers. See markerThumbnails for the LRU it holds. */
  const thumbs = useRef<ThumbnailRegistry | null>(null);
  const thumbSrcById = useRef<Map<string, { url: string; ring: string }>>(new Map());

  // The search bar now sits in the toolbar ABOVE the map instead of floating
  // over it, so overlays inside the map column start at its top edge. (This was
  // a measured header height while the bar covered the map.)
  const belowHeader = 12;

  // ── "Search this area" ───────────────────────────────────────────────────
  //
  // What the last response actually described, so a move can be compared
  // against it. Null until the first load returns.
  const loadedView = useRef<{ bbox: BBox; zoom: number } | null>(null);
  const [viewDrifted, setViewDrifted] = useState(false);
  // Set immediately before any camera move THIS COMPONENT initiates. A move the
  // reader asked for (picking a destination, expanding a cluster, locating
  // themselves) should just load; only a move they made by hand gets offered.
  const programmatic = useRef(false);

  // Redraw when the filter is toggled, and when a hotel is saved or un-saved
  // while it is on — otherwise a marker the reader just removed stays painted.
  useEffect(() => {
    paint(latest.current.clusters, latest.current.points);
  }, [savedOnly, savedIds, paint]);

  const flyTo = useCallback((d: Destination) => {
    const m = map.current;
    if (!m) return;
    // Recorded here, at the single point every pick passes through — the
    // suggestion list, the recent list and the keyboard path all land on this
    // callback, so none of them can forget to write history.
    setRecent(pushRecent(d));
    programmatic.current = true;
    m.flyTo({
      center: [d.longitude, d.latitude],
      zoom: d.kind === "property" ? 15 : Math.max(m.getZoom(), 9),
      duration: FLY_MS,
      easing: easeInOutCubic,
      essential: true,
    });
  }, []);

  // The halo behind the active marker.
  //
  // Runs ONLY while something is hovered. An idle rAF loop on a map page costs a
  // frame's work forever for a decoration nobody is looking at, so the loop is
  // started by a hover and cancelled the moment it ends — and the source is
  // emptied on the way out so no stale ring is left painted.
  useEffect(() => {
    const m = map.current;
    if (!m || !m.getSource(SRC_PULSE)) return;
    const src = m.getSource(SRC_PULSE) as GeoJSONSource;

    if (!hover) {
      src.setData(EMPTY_FC);
      m.setPaintProperty(LYR_PULSE, "circle-opacity", 0);
      return;
    }

    const at: [number, number] =
      hover.target.kind === "cluster"
        ? [hover.target.cluster.longitude, hover.target.cluster.latitude]
        : [hover.target.point.longitude, hover.target.point.latitude];
    const base = hover.target.kind === "cluster" ? bandFor(hover.target.cluster.count).r : 11;

    src.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: {} }],
    });

    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      // Sawtooth: the ring grows out from the marker and fades, then restarts.
      const t = ((now - started) % PULSE_MS) / PULSE_MS;
      m.setPaintProperty(LYR_PULSE, "circle-radius", base * (1 + t * 1.6));
      m.setPaintProperty(LYR_PULSE, "circle-opacity", 0.3 * (1 - t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      // The map can be torn down between the hover ending and this running.
      if (!map.current?.getSource(SRC_PULSE)) return;
      src.setData(EMPTY_FC);
      m.setPaintProperty(LYR_PULSE, "circle-opacity", 0);
    };
  }, [hover]);

  const toggleFamily = useCallback((f: PropertyFamily) => {
    setFamilies((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }, []);

  // ── list ↔ map ───────────────────────────────────────────────────────────
  //
  // ONE SOURCE OF TRUTH FOR SELECTION: `selected` (the detail panel's target).
  // The list's highlighted card, the lit marker and the open panel are all
  // derived from its id, so they cannot drift apart. Hover is the same: a
  // card's hover lights its marker through feature-state, and a marker's hover
  // (the map's own hover card) highlights its card.
  const selectedId = selected?.id ?? null;
  const markerHoverId = hover?.target.kind === "property" ? hover.target.point.id : null;
  const hoveredCardId = listHoverId ?? markerHoverId;

  const onListHover = useCallback(
    (id: string | null) => {
      setListHoverId(id);
      light(id ? hashId(id) : null);
    },
    [light]
  );

  const onListSelect = useCallback(
    (p: MapPoint) => {
      openDetail(p);
      const m = map.current;
      if (!m) return;
      light(hashId(p.id));
      // Move the map only when the hotel is off-screen: a camera jump for a
      // hotel already in view would throw away where the reader was looking.
      if (!m.getBounds().contains([p.longitude, p.latitude])) {
        programmatic.current = true;
        m.easeTo({ center: [p.longitude, p.latitude], duration: FLY_MS, easing: easeInOutCubic });
      }
    },
    [openDetail, light]
  );

  const filtersActive = minStars > 0 || families.length > 0 || categories.length > 0 || exactOnly || textFilter.trim() !== "";
  const clearFilters = useCallback(() => {
    setCategories([]);
    setMinStars(0);
    setExactOnly(false);
    setFamilies([]);
    setTextFilter("");
  }, []);

  // Keep the URL in step with the search (camera, filters, sort, open hotel).
  useEffect(() => {
    if (!urlRead.current) return;
    const m = map.current;
    writeSearchToUrl({
      minStars,
      families,
      categories,
      textFilter,
      exactOnly,
      sort,
      // Until a pending ?hotel= has been reopened, keep it rather than erase it.
      hotel: selectedId ?? pendingHotel.current,
      stay,
      radius,
      radiusLabel,
      area,
      camera: m && center ? { lat: center.latitude, lng: center.longitude, z: m.getZoom() } : undefined,
    });
  }, [center, minStars, families, categories, textFilter, exactOnly, sort, selectedId, stay, radius, radiusLabel, area]);

  // Light/dark: recolour the basemap in place. Markers, prices and the user's
  // position are untouched — they read on either ground.
  useEffect(() => {
    const m = map.current;
    if (!m?.isStyleLoaded()) return;
    applyPaletteToMap(m, mapTheme);
    // Hotel names are the one app layer drawn ON the cartography rather than
    // as a badge, so they follow the ground: light text on dark, dark on ivory.
    if (m.getLayer(LYR_PROPERTY_NAME)) {
      const light = mapTheme === "light";
      m.setPaintProperty(LYR_PROPERTY_NAME, "text-color", light ? "#1F2421" : "#F5F7F6");
      m.setPaintProperty(LYR_PROPERTY_NAME, "text-halo-color", light ? "rgba(255,255,255,0.95)" : "rgba(5,9,9,0.92)");
    }
    // Price pills invert with the ground so they never sink into it: light
    // pills on the dark map, dark pills on ivory. Hover/selected stay emerald.
    if (m.getLayer(LYR_PRICE)) {
      const active: ExpressionSpecification = ["any", ["boolean", ["feature-state", "hover"], false], ["boolean", ["feature-state", "selected"], false]];
      const light = mapTheme === "light";
      m.setPaintProperty(LYR_PRICE, "icon-color", ["case", active, "#00E6A7", light ? "#0D1314" : "#F5F7F6"]);
      m.setPaintProperty(LYR_PRICE, "text-color", ["case", active, "#030505", light ? "#F5F7F6" : "#030505"]);
    }
  }, [mapTheme]);

  // Density: the heatmap and the markers draw from one source, so switching is
  // a visibility change — no refetch, no rebuild.
  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer(LYR_HEATMAP)) return;
    m.setLayoutProperty(LYR_HEATMAP, "visibility", density ? "visible" : "none");
    for (const id of MARKER_LAYERS) {
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", density ? "none" : "visible");
    }
    if (density) setHover(null);
  }, [density]);

  // The open hotel's price pill turns emerald, through feature-state like hover.
  const selectedFeature = useRef<number | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m?.getSource(SRC_POINTS)) return;
    if (selectedFeature.current !== null) {
      m.setFeatureState({ source: SRC_POINTS, id: selectedFeature.current }, { selected: false });
    }
    selectedFeature.current = selectedId ? hashId(selectedId) : null;
    if (selectedFeature.current !== null) {
      m.setFeatureState({ source: SRC_POINTS, id: selectedFeature.current }, { selected: true });
    }
  }, [selectedId, listPoints]);

  // Reopen ?hotel= once its point is on the map (Back, reload, shared link).
  useEffect(() => {
    const want = pendingHotel.current;
    if (!want) return;
    const p = listPoints.find((x) => x.id === want);
    if (p) {
      pendingHotel.current = null;
      openDetail(p);
    }
  }, [listPoints, openDetail]);

  // The map's column changes width when the detail panel docks or the list
  // toggles; MapLibre only watches the WINDOW, so it is told explicitly.
  useEffect(() => {
    const el = container.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => map.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (noWebgl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0B1112] p-6">
        <div className="max-w-[420px] text-center">
          <p className="text-[16px] font-bold text-[#F5F7F6]">This map needs WebGL2</p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#A4AAA9]">
            The renderer could not get a WebGL2 context, so the map cannot draw. This is a
            browser or driver setting rather than a problem with the page.
          </p>
          <ul className="mt-4 space-y-1.5 text-left text-[13px] text-[#A4AAA9]">
            <li>
              • Chrome: enable{" "}
              <span className="text-[#F5F7F6]">Settings → System → Use graphics acceleration</span>,
              then restart the browser.
            </li>
            <li>
              • Check <span className="text-[#F5F7F6]">chrome://gpu</span> — it lists WebGL2 as
              enabled or blocklisted, and why.
            </li>
            <li>• Remote desktop and VM sessions often have no GPU to hand through.</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    // WORKSPACE: search toolbar on top; below it the results list, the map and
    // (when a hotel is open) the detail panel DOCKED BESIDE the map. The panel
    // carries Google Places content, which may not be drawn on a non-Google
    // map — beside it is where it belongs (see HotelDetailPanel). Phones show
    // the list OR the map, switched by the segmented control at the bottom.
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#030505]">
      <div className="relative z-30 border-b border-white/[0.08] bg-[#050909] px-3 py-3 sm:px-4 lg:px-5">
        <HotelMapSearchHeader
          query={query}
          onQuery={setQuery}
          suggestions={suggestions}
          onPick={(d) => {
            flyTo(d);
            setSheet("peek");
          }}
          families={families}
          minStars={minStars}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((v) => !v)}
          moreFilterCount={moreFilterCount}
          recent={recent}
          onClearRecent={() => setRecent(clearRecent())}
          leading={
            <>
              <StayPicker stay={stay} onChange={setStay} today={todayLocalIso()} />
              <RadiusControl radius={radius} label={radiusLabel} centres={radiusCentres} onApply={applyRadius} onClear={() => applyRadius(null)} />
              <DrawControl mode={draw.mode} hasArea={area !== null} onStart={(m) => { setSheet("peek"); draw.start(m); }} onClear={() => setArea(null)} />
            </>
          }
        />
      </div>

      <div className="relative flex min-h-0 flex-1">
      <ResultsSheet
        snap={sheet}
        onSnap={setSheet}
        label={`${listPoints.length} ${listPoints.length === 1 ? "property" : "properties"} in view`}
      >
        <HotelResultsPanel
          points={listPoints}
          meta={meta}
          loading={loading}
          error={error}
          sort={sort}
          onSort={setSort}
          center={center}
          hoveredId={hoveredCardId}
          selectedId={selectedId}
          savedIds={savedIds}
          filtersActive={filtersActive}
          onHover={onListHover}
          onSelect={onListSelect}
          onRetry={() => {
            const m = map.current;
            if (m) void load(m.getBounds(), m.getZoom());
          }}
          onClearFilters={clearFilters}
          rates={rates}
          ratesStatus={ratesStatus}
          hasStay={stay !== null}
        />
      </ResultsSheet>

      <div
        ref={mapColumn}
        className={`relative min-w-0 flex-1 overflow-hidden bg-[#0B1112] [&_.maplibregl-ctrl-scale]:rounded-[4px] [&_.maplibregl-ctrl-scale]:border-white/40 [&_.maplibregl-ctrl-scale]:bg-[#090D0E]/85 [&_.maplibregl-ctrl-scale]:px-1 [&_.maplibregl-ctrl-scale]:text-[10px] [&_.maplibregl-ctrl-scale]:text-[#C9CFCD]`}
      >
      <div ref={container} className="h-full w-full" />

      {/* The map, as a list. Off-screen until focused — see AccessibleMarkerList. */}
      <AccessibleMarkerList
        entries={entries}
        onFocusEntry={(e) => openFor(e.id, null)}
        onBlurEntry={scheduleClose}
        onActivate={(e) =>
          e.kind === "cluster" ? showDestinationCard(e.cluster!) : openDetail(e.point!)
        }
      />

      {filtersOpen && (
        <FilterPanel
          top={belowHeader}
          categories={categories}
          onToggleCategory={(id) =>
            setCategories((prev) =>
              prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
            )
          }
          minStars={minStars}
          onMinStars={setMinStars}
          exactOnly={exactOnly}
          onExactOnly={setExactOnly}
          families={families}
          onToggleFamily={toggleFamily}
          textFilter={textFilter}
          onTextFilter={setTextFilter}
          onClose={() => setFiltersOpen(false)}
          onReset={() => {
            setCategories([]);
            setMinStars(0);
            setExactOnly(false);
            setFamilies([]);
            setTextFilter("");
          }}
        />
      )}

      <MapControls
        top={belowHeader}
        onZoom={(delta) => {
          const m = map.current;
          if (m) m.easeTo({ zoom: m.getZoom() + delta, duration: 220 });
        }}
      />

      <MapViewControls
        top={belowHeader + 84 + 10}
        fullscreen={fullscreen}
        fullscreenSupported={fullscreenSupported}
        onToggleFullscreen={toggleFullscreen}
        theme={mapTheme}
        onToggleTheme={toggleTheme}
        density={density}
        onToggleDensity={() => setDensity((d) => !d)}
        airports={airportsOn}
        onToggleAirports={() => setAirportsOn((a) => !a)}
      />

      <TravelContextChips
        area={area !== null && !draw.mode}
        onClearArea={() => setArea(null)}
        radius={radius}
        radiusLabel={radiusLabel}
        onClearRadius={() => applyRadius(null)}
        route={overlays.route}
        routeError={overlays.routeError ? routeCodes : null}
        onClearRoute={() => {
          setRouteCodes(null);
          const q = new URLSearchParams(window.location.search);
          q.delete("route");
          window.history.replaceState(window.history.state, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}`);
        }}
        airport={overlays.selectedAirport}
        onCloseAirport={() => overlays.setSelectedAirport(null)}
        onAirportRadius={(a) => {
          applyRadius({ center: { latitude: a.latitude, longitude: a.longitude }, km: 25 }, `${a.name} (${a.iata})`);
          overlays.setSelectedAirport(null);
        }}
      />

      {airportsOn && overlays.airports.length > 0 && (
        // Airports for keyboard and screen-reader users: the canvas has nothing
        // to focus, so the same airports are real buttons, visible on focus.
        <nav aria-label="Airports in view" className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-24 focus-within:left-4 focus-within:z-30 focus-within:max-h-48 focus-within:overflow-auto focus-within:rounded-xl focus-within:border focus-within:border-white/[0.10] focus-within:bg-[#090D0E] focus-within:p-2">
          <ul>
            {overlays.airports.slice(0, 40).map((a) => (
              <li key={a.iata}>
                <button type="button" onClick={() => overlays.setSelectedAirport(a)} className="w-full rounded px-2 py-1 text-left text-[12px] text-[#E6EAE8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]">
                  {a.iata} · {a.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {density && (
        <p className="pointer-events-none absolute left-1/2 top-[64px] z-20 -translate-x-1/2 rounded-full border border-white/[0.10] bg-[#090D0E]/95 px-3 py-1.5 text-[11.5px] text-[#C9CFCD]" role="status">
          Density of the hotels loaded for this view
        </p>
      )}

      <SavedFilterButton
        active={savedOnly}
        count={savedIds.size}
        drawn={savedOnly ? latest.current.points.filter((p) => savedIds.has(p.id)).length : 0}
        onToggle={() => setSavedOnly((v) => !v)}
      />

      <LocateButton
        mode={trackMode}
        userLoc={userLoc}
        error={locError}
        onToggle={() =>
          setTrackMode((m) =>
            m === "off" ? "locate" : m === "locate" ? "track" : "off"
          )
        }
      />

      {/* The offer. Occupies the same slot as the loading pill and never both:
          while a request is in flight there is nothing to ask for. */}
      {draw.mode && (
        <div
          role="status"
          className="absolute left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-[#00E6A7]/40 bg-[#090D0E]/95 px-3 py-2 text-[12px] text-[#E6EAE8] shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
          style={{ top: belowHeader }}
        >
          <span>
            {draw.mode === "rectangle"
              ? draw.count === 0
                ? "Click one corner of the area"
                : "Now click the opposite corner"
              : draw.count < 3
                ? `Click to add points (${draw.count} so far)`
                : `${draw.count} points — double-click or click the first point to finish`}
          </span>
          {draw.problem && <span className="text-amber-300">{draw.problem}</span>}
          {draw.mode === "polygon" && draw.count >= 3 && (
            <button type="button" onClick={draw.finish} className="h-7 rounded-full bg-[#00E6A7] px-3 text-[12px] font-bold text-[#030505] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              Finish
            </button>
          )}
          <button type="button" onClick={draw.cancel} className="h-7 rounded-full border border-white/[0.15] px-3 text-[12px] font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]">
            Cancel
          </button>
        </div>
      )}

      {offline && (
        <div
          role="status"
          className="absolute left-1/2 z-20 max-w-[calc(100%-120px)] -translate-x-1/2 rounded-full border border-amber-300/30 bg-[#1A1408]/95 px-3.5 py-1.5 text-center text-[12px] font-medium text-amber-100 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          style={{ top: belowHeader }}
        >
          {/* The app's own banner already says "offline"; this says what the
              map is showing meanwhile. */}
          {loadedAt
            ? `Showing hotels loaded at ${new Date(loadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Showing the hotels already loaded"}
          {" — they'll refresh when you're back online."}
        </div>
      )}

      {viewDrifted && !loading && !offline && (
        <div
          className="absolute left-1/2 z-20 -translate-x-1/2"
          style={{ top: belowHeader }}
        >
          <button
            type="button"
            onClick={() => {
              const m = map.current;
              if (!m) return;
              setViewDrifted(false);
              void load(m.getBounds(), m.getZoom());
            }}
            className="app-pop-in flex h-[42px] items-center gap-2 rounded-full border border-white/[0.12] bg-[#090D0E] px-4 text-[13px] font-semibold text-[#F5F7F6] shadow-[0_16px_40px_rgba(0,0,0,0.35)] transition-colors hover:border-[#00E6A7]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E6A7]"
          >
            <SearchIcon className="h-4 w-4 shrink-0" />
            Search this area
          </button>
        </div>
      )}

      {loading && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/[0.10] bg-[#090D0E]/95 px-3 py-1.5 text-[12px] font-medium text-[#A4AAA9] shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          style={{ top: belowHeader }}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#00E6A7]" aria-hidden />
          Updating stays…
        </div>
      )}

      {hover && (
        <HotelMapHoverCard
          target={hover.target}
          anchor={hover.anchor}
          onEnter={cancelClose}
          onLeave={scheduleClose}
          onOpenProperty={openDetail}
          onViewAll={() => {
            if (hover.target.kind === "cluster") showDestinationCard(hover.target.cluster);
          }}
        />
      )}

      {/* Destination card — the cluster overview. Opened by a click, a keyboard
          activation, or the hover card's "View all", so every route into a
          cluster lands in the same place. */}
      {destinationCluster && (
        <DestinationCard
          cluster={destinationCluster}
          top={belowHeader}
          onClose={() => setDestinationCluster(null)}
          onViewAll={() => expandCluster(destinationCluster)}
          onOpenProperty={openDetail}
          onSearchArea={() => expandCluster(destinationCluster)}
        />
      )}

      <StatusBar error={error} meta={meta} loading={loading} liveStatus={liveStatus} />
      </div>

      <HotelDetailPanel
        target={selected}
        onClose={() => setSelected(null)}
        stay={stay}
        rate={selected ? rates.get(selected.id) : undefined}
        onNearbyPois={setNearbyPois}
      />
      </div>
    </div>
  );
}

/** Zoom controls, styled to the design rather than MapLibre's default. */
function MapControls({ top, onZoom }: { top: number; onZoom: (delta: number) => void }) {
  return (
    <div
      className="absolute right-4 z-20 flex flex-col overflow-hidden rounded-xl bg-[#090D0E] shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
      style={{ top }}
    >
      <button
        type="button"
        onClick={() => onZoom(1)}
        aria-label="Zoom in"
        className="flex h-[42px] w-[42px] items-center justify-center text-[#C9CFCD] transition-colors hover:bg-white/[0.05]"
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <div className="h-px bg-white/[0.05]" />
      <button
        type="button"
        onClick={() => onZoom(-1)}
        aria-label="Zoom out"
        className="flex h-[42px] w-[42px] items-center justify-center text-[#C9CFCD] transition-colors hover:bg-white/[0.05]"
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Show only saved hotels.
 *
 * Sits beside the locate button rather than in the filter sheet because it is a
 * mode, not a facet: it changes what the map IS rather than narrowing what it
 * is already showing, and the reader needs to see at a glance that it is on.
 *
 * It filters the CURRENT VIEW, since that is all the map has in hand — so the
 * honest empty state is "none of your saved hotels are in this view", not "you
 * have no saved hotels". The two are very different messages and getting them
 * the wrong way round would tell a reader with 40 saves that they have none.
 */
function SavedFilterButton({
  active,
  count,
  drawn,
  onToggle,
}: {
  active: boolean;
  /** Total saved, everywhere. */
  count: number;
  /** How many of them are in the current view. Only meaningful when active. */
  drawn: number;
  onToggle: () => void;
}) {
  // Nothing saved anywhere: the control would filter to an empty map and could
  // not explain why, so it is not offered until it can do something.
  if (count === 0) return null;

  return (
    <div className="absolute bottom-[72px] left-[74px] z-20 flex items-center gap-2 max-sm:hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={`flex h-[46px] items-center gap-2 rounded-full px-4 text-[13px] font-semibold shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B7A4E] ${
          active
            ? "bg-[#1B7A4E] text-white hover:bg-[#146B44]"
            : "bg-[#090D0E] text-[#C9CFCD] hover:bg-white/[0.05]"
        }`}
      >
        <svg
          className="h-[18px] w-[18px] shrink-0"
          viewBox="0 0 20 20"
          fill={active ? "currentColor" : "none"}
          aria-hidden
        >
          <path
            d="M10 16.5S3.5 12.6 3.5 8.2A3.7 3.7 0 0 1 10 5.9a3.7 3.7 0 0 1 6.5 2.3c0 4.4-6.5 8.3-6.5 8.3Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
        Saved
        <span className={active ? "text-white/70" : "text-[#6E7675]"}>{count}</span>
      </button>

      {active && drawn === 0 && (
        <p
          role="status"
          className="rounded-lg bg-[#090D0E] px-3 py-1.5 text-[12px] font-medium text-[#C9CFCD] shadow-[0_4px_14px_rgba(0,0,0,0.10)]"
        >
          None of your saved hotels are in this view
        </p>
      )}
    </div>
  );
}

/**
 * The circular control at the bottom left: centre the map on the reader, then
 * optionally track them continuously with compass heading.
 *
 * THREE STATES, matching Google Maps' locate button:
 *   off     → tap → locate (one-shot centre + blue dot)
 *   locate  → tap → track  (continuous follow with compass cone)
 *   track   → tap → off    (stop tracking, remove blue dot)
 *
 * Each state has its own icon and colour so the reader knows what tapping will
 * do. The accuracy badge shows the same High/Medium/Low labels Google Maps
 * uses in its compass calibration screen.
 *
 * No location data is stored, sent to the server, or added to the URL.
 */
function LocateButton({
  mode,
  userLoc,
  error,
  onToggle,
}: {
  mode: "off" | "locate" | "track";
  userLoc: UserLocation | null;
  error: string | null;
  onToggle: () => void;
}) {
  const active = mode !== "off";

  return (
    <div className="absolute bottom-[72px] left-4 z-20 flex flex-col items-start gap-2 max-sm:hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-label={
          mode === "off"
            ? "Centre the map on my location"
            : mode === "locate"
              ? "Track my location continuously"
              : "Stop tracking"
        }
        aria-pressed={active}
        className={`grid h-[46px] w-[46px] place-items-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] ${
          mode === "track"
            ? "bg-[#4285F4] text-white hover:bg-[#3574D4]"
            : active
              ? "bg-[#090D0E] text-[#4285F4] hover:bg-white/[0.05]"
              : "bg-[#090D0E] text-[#C9CFCD] hover:bg-white/[0.05]"
        }`}
      >
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden>
          {mode === "track" ? (
            // Navigation arrow — actively tracking.
            <path
              d="M10 2 L16 16 L10 12 L4 16 Z"
              fill="currentColor"
            />
          ) : (
            // Crosshair — locate or idle.
            <>
              <circle
                cx="10" cy="10" r="3"
                stroke="currentColor" strokeWidth="1.8"
                fill={active ? "currentColor" : "none"}
              />
              <path
                d="M10 1.5v2.2M10 16.3v2.2M18.5 10h-2.2M3.7 10H1.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </>
          )}
        </svg>
      </button>

      {/* Accuracy badge — shows the same High/Medium/Low levels as Google Maps
          calibration. Only visible while tracking. */}
      {active && userLoc && (
        <div className="rounded-lg bg-[#090D0E] px-3 py-1.5 shadow-[0_4px_14px_rgba(0,0,0,0.10)]">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#C9CFCD]">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                userLoc.accuracyLevel === "high"
                  ? "bg-[#34A853]"
                  : userLoc.accuracyLevel === "medium"
                    ? "bg-[#F4B400]"
                    : "bg-[#EA4335]"
              }`}
            />
            {userLoc.accuracyLevel === "high"
              ? "High accuracy"
              : userLoc.accuracyLevel === "medium"
                ? "Medium accuracy"
                : "Low accuracy"}
            <span className="text-[#6E7675]">
              ±{Math.round(userLoc.accuracy)}m
            </span>
          </p>
          {userLoc.heading !== null && (
            <p className="mt-0.5 text-[11px] text-[#6E7675]">
              Heading {Math.round(userLoc.heading)}°
              {userLoc.speed !== null && userLoc.speed > 0.5
                ? ` · ${(userLoc.speed * 3.6).toFixed(1)} km/h`
                : ""}
            </p>
          )}
        </div>
      )}

      {error && (
        <p
          role="status"
          className="rounded-lg bg-[#090D0E] px-3 py-1.5 text-[12px] font-medium text-[#C9CFCD] shadow-[0_4px_14px_rgba(0,0,0,0.10)]"
        >
          {error}
        </p>
      )}

    </div>
  );
}

/** The Filters popover: everything the header pills have no room for. */
function FilterPanel({
  top,
  categories, onToggleCategory, minStars, onMinStars, exactOnly, onExactOnly,
  families, onToggleFamily, textFilter, onTextFilter, onClose, onReset,
}: {
  top: number;
  categories: LuxuryCategoryId[];
  onToggleCategory: (id: LuxuryCategoryId) => void;
  minStars: number;
  onMinStars: (n: number) => void;
  exactOnly: boolean;
  onExactOnly: (b: boolean) => void;
  families: PropertyFamily[];
  onToggleFamily: (f: PropertyFamily) => void;
  textFilter: string;
  onTextFilter: (s: string) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className="absolute right-4 z-30 w-[340px] max-w-[calc(100%-32px)] rounded-2xl border border-white/[0.10] bg-[#090D0E] p-4 shadow-[0_15px_40px_rgba(0,0,0,0.16)]"
      style={{ top }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-bold text-[#F5F7F6]">Filters</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="text-[#6E7675] transition-colors hover:text-white"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Filtering BY NAME lives here, not in the header.
          The header's search box used to do both jobs at once: typing "dubai"
          narrowed the world from 507 properties to 8, emptying the map while
          the user was still reading the suggestions. Search now only suggests
          and flies; narrowing the set is this explicit control. */}
      <label className="mt-3 block">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#6E7675]">
          Name contains
        </span>
        <input
          value={textFilter}
          onChange={(e) => onTextFilter(e.target.value)}
          placeholder="Aman, Belmond, Kyoto…"
          className="mt-1.5 w-full rounded-lg border border-white/[0.10] bg-[#090D0E] px-2.5 py-1.5 text-[12.5px] text-[#F5F7F6] outline-none placeholder:text-[#6E7675] focus:border-[#B6DCC8]"
        />
      </label>

      {/* On a narrow viewport the header's family pills are hidden, so they
          appear here instead — a control is never simply unreachable. */}
      {/* Shown at EVERY width. This used to be `lg:hidden` because the header
          carried its own family pills on desktop; those are gone, so this is
          now the only place property type can be set. */}
      <div className="mt-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#6E7675]">Property type</p>
        <div className="mt-2 flex gap-1.5">
          {(["hotels", "resorts", "villas"] as PropertyFamily[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onToggleFamily(f)}
              aria-pressed={families.includes(f)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                families.includes(f)
                  ? "border-[#B6DCC8] bg-[rgba(0,230,167,0.10)] text-[#1B7A4E]"
                  : "border-white/[0.10] bg-[#090D0E] text-[#A4AAA9]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3.5 text-[11px] font-bold uppercase tracking-wide text-[#6E7675]">Collection</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {LUXURY_MAP_CATEGORIES.map((c) => {
          const on = categories.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggleCategory(c.id)}
              aria-pressed={on}
              title={
                c.basis === "editorial"
                  ? "Editorial: FurlPay's own classification"
                  : c.basis === "furlpay"
                    ? "A fact about FurlPay's own systems"
                    : "Observed: recorded in the source data"
              }
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                on ? "border-transparent text-white" : "border-white/[0.10] bg-[#090D0E] text-[#A4AAA9]"
              }`}
              style={on ? { background: c.color } : undefined}
            >
              <CategoryIcon id={c.id} className="h-3.5 w-3.5 shrink-0" />
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-[12.5px] text-[#A4AAA9]">
          Min stars
          <select
            value={minStars}
            onChange={(e) => onMinStars(Number(e.target.value))}
            className="rounded-lg border border-white/[0.10] bg-[#090D0E] px-2 py-1 text-[12.5px] text-[#F5F7F6]"
          >
            <option value={0}>Any</option>
            <option value={4}>4+</option>
            <option value={5}>5</option>
          </select>
        </label>
        <button
          type="button"
          onClick={onReset}
          className="text-[12px] font-semibold text-[#1B7A4E] transition-opacity hover:opacity-75"
        >
          Reset
        </button>
      </div>

      <label
        className="mt-2.5 flex items-center gap-2 text-[12.5px] text-[#A4AAA9]"
        title="Hide properties whose position could not be confirmed against Google"
      >
        <input
          type="checkbox"
          checked={exactOnly}
          onChange={(e) => onExactOnly(e.target.checked)}
          className="accent-[#1B7A4E]"
        />
        Confirmed positions only
      </label>
    </div>
  );
}

/**
 * The one place the map talks about itself, plus the attribution the tile and
 * Places licences require.
 *
 * Several DIFFERENT facts, each given its own referent rather than folded into
 * one number. A Manhattan viewport draws 8 curated properties and 196
 * OpenStreetMap hotels; "204 shown of 507" was true of nothing in particular.
 */
function StatusBar({
  error, meta, loading, liveStatus,
}: {
  error: string | null;
  meta: Omit<MapResponse, "points" | "clusters"> | null;
  loading: boolean;
  /** State of the LIVE Google layer only -- never conflated with `error`,
   *  which belongs to the indexed sources. */
  liveStatus: LiveStatus;
}) {
  const notes: string[] = [];
  if (meta && !loading) {
    const { curatedInView, curatedClustered, osmInView, curatedMatchingWorldwide } = meta.counts;
    const luxuryHere = curatedInView + curatedClustered;

    if (luxuryHere === 0) {
      notes.push(
        curatedMatchingWorldwide > 0
          ? `No luxury properties in view — ${curatedMatchingWorldwide} elsewhere`
          : "No luxury properties match these filters"
      );
    } else {
      notes.push(`${luxuryHere} luxury ${luxuryHere === 1 ? "property" : "properties"} in view`);
    }
    if (osmInView > 0) notes.push(`${osmInView} other mapped hotels`);
    // Never silently. A cap that does not announce itself reads as "this is
    // everything", which is exactly what it is not.
    if (meta.truncated > 0) notes.push(`${meta.truncated} more not drawn — zoom in`);
    if (meta.osmUnavailable) notes.push("OpenStreetMap layer unavailable");
    else if (meta.osmFilteredOut) notes.push("Filters apply to luxury properties only — other hotels hidden");
    else if (meta.osmZoomIn) notes.push("Zoom in for all mapped hotels");
  }

  // The live layer speaks for itself, and only when it has something to say.
  // Appended after the indexed notes so a working map reads normally and the
  // live state is an aside, not a headline.
  const liveNote = liveStatusLabel(liveStatus);
  if (liveNote) notes.push(liveNote);

  const warn = Boolean(error) || Boolean(meta?.osmUnavailable);

  return (
    // Compact: the results list already carries the headline count, so this is
    // a two-line-max footnote that never buries the map. Full text stays in the
    // DOM (line-clamp hides overflow visually only).
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-3 p-3 max-lg:pb-[160px] max-sm:flex-col max-sm:items-stretch">
      <div
        className={`line-clamp-2 max-w-[min(560px,62%)] rounded-xl px-3 py-1.5 text-[11.5px] font-medium leading-[1.45] shadow-[0_4px_14px_rgba(0,0,0,0.10)] max-sm:max-w-none ${
          warn ? "bg-[#F97316] text-white" : "bg-[#090D0E]/95 text-[#C9CFCD]"
        }`}
      >
        {error ?? notes.join(" · ")}
        {!error && meta && (
          <span className="ml-2 text-[#6E7675]">
            {meta.dataset.exact} of {meta.dataset.total} positions confirmed
          </span>
        )}
      </div>
      {/* Required by the ODbL and by Google's Places policy. Rendered
          unconditionally: it is the condition under which the data may be shown
          at all, not a caption. */}
      <p className="max-w-[38%] rounded-lg bg-[#090D0E]/85 px-2 py-1 text-right text-[10px] leading-snug text-[#6E7675] max-sm:max-w-none max-sm:text-left">
        {meta?.attribution ?? "© OpenStreetMap contributors"}
      </p>
    </div>
  );
}
