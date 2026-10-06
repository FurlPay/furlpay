import type {
  ExpressionSpecification,
  LayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import type { MapCluster, MapPoint } from "@/app/api/travel/hotels/map/route";
import { LUXURY_MAP_CATEGORIES } from "@/lib/hotels/luxuryTiers";
import { thumbId, thumbnailSource } from "@/lib/hotels/markerThumbnails";

// ---------------------------------------------------------------------------
// The map's render layer.
//
// WHY THIS REPLACED DOM MARKERS. Every pin used to be a real <button> handed to
// MapLibre's Marker class, which repositions each one on every frame of a pan.
// MapLibre's own large-data guide names that as the classic way to make a
// GL-backed map slow: 400 absolutely-positioned DOM nodes are 400 style
// recalculations per frame, and the browser does that work on the main thread
// while the GPU sits idle. Drawn as a GeoJSON source instead, the same points
// are part of the map texture and cost the main thread nothing to move.
//
// WHAT THAT COSTS, AND HOW IT IS PAID BACK. DOM markers came with focus,
// hover and keyboard handling for free; a GPU layer has none of those, because
// there is nothing in the accessibility tree to focus. That is not a regression
// to accept — it is the same gap the DOM version had anyway, since a card that
// closed on blur could never be tabbed into. Both are solved together by
// AccessibleMarkerList, which renders the same features as real buttons off
// screen. That is the documented pattern for canvas and WebGL maps: keep a
// semantic DOM equivalent of everything drawn, rather than trying to make the
// canvas itself focusable.
//
// SIZE AND COLOUR STILL CARRY MEANING, and still come from one table — see
// BANDS below — so a marker can never end up large and green.
// ---------------------------------------------------------------------------

export const SRC_POINTS = "hm-points";
export const SRC_LEADERS = "hm-leaders";
/** Holds the one marker currently under the pointer, or nothing. */
export const SRC_PULSE = "hm-pulse";

export const LYR_PULSE = "hm-pulse-ring";
/** Circular photograph markers, for curated properties that have one. */
export const LYR_PHOTO = "hm-photo";
export const LYR_CLUSTER = "hm-cluster";
export const LYR_CLUSTER_LABEL = "hm-cluster-label";
export const LYR_PROPERTY = "hm-property";
export const LYR_PROPERTY_LABEL = "hm-property-label";
/** The property NAME beside the pin, as opposed to the star inside it. */
export const LYR_PROPERTY_NAME = "hm-property-name";
export const LYR_OSM = "hm-osm";
export const LYR_LEADERS = "hm-leaders-line";

// ---------------------------------------------------------------------------
// Universal registry vector tiles (migration 0015 + /api/travel/hotels/tiles).
//
// A SECOND, OPTIONAL source that sits alongside the GeoJSON one above rather
// than replacing it. The GeoJSON pipeline carries curated properties with
// photographs, live prices and hover cards — everything the product is built
// on. The vector tiles carry the long tail: every lodging in the registry,
// drawn as plain pins at a density GeoJSON cannot reach.
//
// OFF BY DEFAULT, and that is not timidity. `universal_hotels` is empty until
// someone runs scripts/ingest-hotel-seeds.mts against a real database, so
// switching this on before ingest would replace a working map with an empty
// one. It is enabled per-deployment once the registry has rows in it.
// ---------------------------------------------------------------------------

export const SRC_VECTOR = "hm-universal";
/** The layer name inside the tile — must match ST_AsMVT(..., 'hotels', ...). */
export const VECTOR_SOURCE_LAYER = "hotels";
export const LYR_VECTOR = "hm-universal-point";
export const LYR_VECTOR_NAME = "hm-universal-name";

export const VECTOR_TILE_URL = "/api/travel/hotels/tiles/{z}/{x}/{y}";

/**
 * Source definition for the registry tiles.
 *
 * minzoom 6: below that a tile covers most of a continent, and 2,500 pins per
 * tile would draw a grey smear that means nothing. maxzoom 14 with
 * overzooming — MapLibre reuses z14 tiles past that instead of asking the
 * server for tiles whose contents cannot differ, which keeps the cache hot.
 */
export function vectorSourceSpec() {
  return {
    type: "vector" as const,
    tiles: [VECTOR_TILE_URL],
    minzoom: 6,
    maxzoom: 14,
    attribution: "Lodging data © OpenStreetMap contributors, Overture Maps Foundation",
  };
}

/**
 * Layers for the registry tiles.
 *
 * Deliberately QUIETER than the curated markers: smaller radius, lower
 * opacity, no photograph, no star. The curated set is the product and must
 * stay visually dominant — if the long tail looked identical, a user could not
 * tell a property FurlPay has verified and priced from one it merely knows
 * exists.
 */
export function vectorLayerSpecs(): Array<Record<string, unknown>> {
  return [
    {
      id: LYR_VECTOR,
      type: "circle",
      source: SRC_VECTOR,
      "source-layer": VECTOR_SOURCE_LAYER,
      minzoom: 6,
      paint: {
        // Grows with zoom rather than sitting at one size: at z6 these are
        // texture, at z16 they are individual buildings.
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2, 11, 3.5, 16, 6],
        // A property with a verified direct-settlement path is worth
        // distinguishing, since that is the one FurlPay can actually book.
        "circle-color": [
          "case",
          ["==", ["get", "x402_supported"], true],
          "rgba(120, 220, 170, 0.92)",
          "rgba(226, 219, 205, 0.70)",
        ],
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(0,0,0,0.35)",
        // Fades in rather than popping: tiles arrive asynchronously and a hard
        // appearance reads as flicker while panning.
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.45, 10, 0.8],
      },
    },
    {
      id: LYR_VECTOR_NAME,
      type: "symbol",
      source: SRC_VECTOR,
      "source-layer": VECTOR_SOURCE_LAYER,
      // Names only once the view is street-level. Earlier than this and
      // MapLibre's collision detection drops most of them anyway, having spent
      // the layout cost first.
      minzoom: 14,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 10,
        "text-offset": [0, 0.9],
        "text-anchor": "top",
        "text-max-width": 9,
        // The curated labels win every collision — declared by drawing this
        // layer beneath them and letting it yield.
        "text-optional": true,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "rgba(232, 226, 214, 0.85)",
        "text-halo-color": "rgba(0,0,0,0.65)",
        "text-halo-width": 1.1,
      },
    },
  ];
}

/** Layers that answer a hover, topmost first. */
export const INTERACTIVE_LAYERS = [
  LYR_CLUSTER,
  LYR_PHOTO,
  LYR_PROPERTY,
  LYR_OSM,
  // The name is part of the marker, not a caption beside it: pointing at
  // either opens the same card. Last in the list because the pin wins a tie —
  // a label overlapping a NEIGHBOUR's pin must not hijack that pin's hover.
  LYR_PROPERTY_NAME,
];

/**
 * Count bands. Radius and colour are read off the same row, so a marker's size
 * and its colour can never disagree about how many properties it stands for.
 */
const BANDS = [
  // Density palette, and the radii that go with it. Colour carries the same
  // information as the number it sits behind, so the two must not disagree:
  // the bands are ordered and non-overlapping, and `bandFor` takes the first
  // whose ceiling the count fits under.
  //
  // LABEL COLOUR IS MEASURED, NOT ASSUMED. Three of these fills are light
  // enough that white numerals fall under the 3:1 floor for large bold text —
  // green lands at 2.09:1 and orange at 2.58:1, both unreadable at marker size
  // however confident they look in a mockup. Those take the dark label; only
  // coral is deep enough to carry white. The fills themselves are exactly the
  // specified palette, so nothing was re-toned to dodge the problem.
  //
  // DARK THEME (FurlPay Travels). Clusters are quiet emerald discs rather than
  // traffic-light bubbles: the fill deepens with the count and the numeral is
  // FurlPay green, which clears the 3:1 floor on every band (asserted in
  // __tests__/layers.spec.ts by measured contrast, not by hex).
  { max: 5, r: 19, bg: "#0C2A23", fg: "#00E6A7" },
  { max: 15, r: 21, bg: "#0D3128", fg: "#00E6A7" },
  { max: 50, r: 23, bg: "#0E392E", fg: "#00E6A7" },
  { max: 120, r: 25, bg: "#104235", fg: "#00E6A7" },
  { max: Infinity, r: 27, bg: "#124C3D", fg: "#5CF5C8" },
] as const;

/**
 * Which names survive when a street has more properties than room for labels.
 *
 * Lower sorts first. The ordering is deliberately about how much the map can
 * SAY about a property, not about how much we like it: a curated property with
 * a photograph, a confirmed position and a star class supports a label that
 * carries real information, while an unnamed OSM dot supports a name and
 * nothing else. Selection wins outright because the reader just asked for it.
 */
export function labelRankFor(p: MapPoint, selectedId: string | null): number {
  // The reader asked for this one by name — it outranks everything.
  if (selectedId && p.id === selectedId) return 0;

  // OSM points are context rather than subject, and are labelled last.
  if (p.source !== "curated") return 900;

  // 100 is the curated baseline; every signal below claws back from it, so a
  // fully-described property lands near 40 and a bare one stays near 100.
  let rank = 100;
  if (p.lScore !== undefined) rank -= Math.min(30, p.lScore * 0.3);
  if (p.stars) rank -= p.stars * 2;
  if (p.precision === "exact") rank -= 6;
  if (p.imageLocalPath || p.imageUrl) rank -= 5;
  if ((p.categories?.length ?? 0) > 0) rank -= 3;
  return Math.round(rank);
}

/** The label's second line: a FurlPay collection when the property has one,
 *  otherwise the source's own type, tidied. Never invented. */
export function categoryLabelFor(p: MapPoint): string {
  const collection = LUXURY_MAP_CATEGORIES.find((c) => (p.categories ?? []).includes(c.id));
  if (collection) return collection.label;
  const t = (p.hotelType ?? "").replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/**
 * The label itself: the property's name, then its category a size smaller.
 *
 * Held as one value because it appears twice in the zoom `step` below, and two
 * copies would be two things to keep in agreement.
 */
const NAME_LABEL: ExpressionSpecification = [
  "format",
  ["get", "name"], {},
  "\n", {},
  ["get", "categoryLabel"], { "font-scale": 0.82 },
];

export function bandFor(count: number) {
  return BANDS.find((b) => count <= b.max) ?? BANDS[BANDS.length - 1];
}

const CATEGORY_COLOR = new Map(LUXURY_MAP_CATEGORIES.map((c) => [c.id, c.color]));

/** A property's colour: its first category in pill order, so a pin and the
 *  filter that selects it always agree. */
export function categoryColor(point: MapPoint): string {
  for (const c of LUXURY_MAP_CATEGORIES) {
    if (point.categories?.includes(c.id)) return CATEGORY_COLOR.get(c.id)!;
  }
  return "#8B5CF6";
}

export type FeatureKind = "cluster" | "property" | "osm";

/** What each rendered feature carries. Primitives only — MapLibre stringifies
 *  anything else, and the full record is held client-side by id instead. */
export interface FeatureProps {
  id: string;
  kind: FeatureKind;
  label: string;
  color: string;
  textColor: string;
  radius: number;
  /** Cluster count, or 0 for a single property. */
  count: number;
  /**
   * The icon id for this property's photograph, or "" when it has none.
   *
   * MapLibre resolves `icon-image` against registered images and fires
   * `styleimagemissing` for one it does not hold, which is how the thumbnail
   * gets loaded on demand. An empty string resolves to nothing and draws
   * nothing, so a property without a photo falls through to the circle layer.
   */
  thumb: string;
  /** Where to fetch the photograph from. Empty when there is none. */
  thumbSrc: string;
  /**
   * The property's real name, for the map label. Empty for clusters and for
   * anything unnamed, which the label layer filters out rather than drawing an
   * empty box for.
   */
  name: string;
  /** "Resort", "Villa", "Ultra Luxury" — the second line of the label. */
  categoryLabel: string;
  /**
   * Placement priority, LOWER WINS.
   *
   * MapLibre drops a colliding label rather than moving it, and resolves ties
   * by `symbol-sort-key`, so this decides which name survives in a dense
   * street. It is computed from the data rather than from feature-state
   * because layout properties cannot read feature-state — and because
   * recomputing the whole source on every hover would reintroduce the
   * per-frame main-thread cost the GPU rewrite removed.
   */
  labelRank: number;
  /** 1 when the position was never confirmed — drives the dashed ring. */
  approx: number;
}

export interface BuiltFeatures {
  points: GeoJSON.FeatureCollection<GeoJSON.Point, FeatureProps>;
  /** Leader lines from a spiderfied marker back to where it really is. */
  leaders: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  /** Everything drawn, in render order, for the accessible listing. */
  index: Map<string, { kind: FeatureKind; cluster?: MapCluster; point?: MapPoint; lngLat: [number, number] }>;
}

// --- spiderfy ---------------------------------------------------------------

/**
 * Markers closer together than this on screen are treated as overlapping.
 *
 * A property circle is 34px across, so two of them within ~26px of one another
 * hide each other's centres and the rear one cannot be clicked. Measured
 * against the real data: sixteen curated pairs sit under 200m apart, and
 * Belmond Hotel Monasterio and Belmond Palacio Nazarenas in Cusco are 38m —
 * about a third of a pin width at zoom 15, and still touching at zoom 17.
 */
const OVERLAP_PX = 26;
/** Radius of the first spiral ring, in pixels. */
const SPIRAL_START_PX = 34;
/** How much further out each subsequent marker sits. */
const SPIRAL_STEP_PX = 13;

/**
 * Fan co-located markers out around their true position.
 *
 * WHY NOT JUST ZOOM FURTHER. Two hotels 38m apart stay overlapped until roughly
 * zoom 18, by which point the map shows one building and no context. Clustering
 * does not help either — these are already individual pins at that zoom, which
 * is the point at which a cluster would have broken apart.
 *
 * The established fix is spiderfying: keep the true position, draw the marker
 * displaced, and connect the two with a leader line so the displacement is
 * VISIBLE rather than a quiet lie about where the hotel is. That last part is
 * why the leader lines are not optional decoration.
 */
function spiderfy(
  entries: { id: string; lngLat: [number, number] }[],
  project: (lngLat: [number, number]) => { x: number; y: number },
  // Takes a TUPLE, not an {x,y} object. MapLibre normalises a point through
  // Point.convert, and an array is the one form every version of it accepts;
  // whether a plain object is handled has varied. A throw in here would leave
  // the whole map blank, so this side takes the shape that cannot be wrong.
  unproject: (p: [number, number]) => { lng: number; lat: number }
): Map<string, { display: [number, number]; anchor: [number, number] }> {
  const placed = new Map<string, { display: [number, number]; anchor: [number, number] }>();

  // Group by screen proximity. O(n^2) over what is on screen — a few hundred at
  // most after the render budget, so a spatial index would be ceremony.
  const groups: { id: string; lngLat: [number, number]; xy: { x: number; y: number } }[][] = [];
  for (const e of entries) {
    const xy = project(e.lngLat);
    const near = groups.find((g) =>
      g.some((m) => Math.hypot(m.xy.x - xy.x, m.xy.y - xy.y) < OVERLAP_PX)
    );
    if (near) near.push({ ...e, xy });
    else groups.push([{ ...e, xy }]);
  }

  for (const group of groups) {
    if (group.length === 1) continue; // nothing to separate

    // Anchor on the group's centre so the fan is symmetrical rather than
    // hanging off whichever member happened to be first.
    const cx = group.reduce((s, m) => s + m.xy.x, 0) / group.length;
    const cy = group.reduce((s, m) => s + m.xy.y, 0) / group.length;

    group.forEach((member, i) => {
      // A circle for small groups, opening into a spiral for larger ones, so
      // markers never land on top of each other again.
      const angle = (i / group.length) * Math.PI * 2 - Math.PI / 2;
      const radius = SPIRAL_START_PX + i * (group.length > 6 ? SPIRAL_STEP_PX : 0);
      const p = unproject([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
      placed.set(member.id, {
        display: [p.lng, p.lat],
        anchor: member.lngLat,
      });
    });
  }

  return placed;
}

// --- feature building -------------------------------------------------------

export function buildFeatures(
  clusters: MapCluster[],
  points: MapPoint[],
  map: MapLibreMap,
  /** The property the reader has opened, if any. Its name outranks every other
   *  label so a chosen property never loses its name to a neighbour. */
  selectedId: string | null = null
): BuiltFeatures {
  const project = (ll: [number, number]) => map.project(ll);
  const unproject = (p: [number, number]) => map.unproject(p);

  // Only individual properties are spiderfied. A cluster already stands for
  // several things and moving it would make its own bounds wrong.
  const spider = spiderfy(
    points.map((p) => ({ id: p.id, lngLat: [p.longitude, p.latitude] as [number, number] })),
    project,
    unproject
  );

  const features: GeoJSON.Feature<GeoJSON.Point, FeatureProps>[] = [];
  const leaders: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  const index: BuiltFeatures["index"] = new Map();

  for (const c of clusters) {
    const band = bandFor(c.count);
    features.push({
      type: "Feature",
      id: hashId(c.id),
      geometry: { type: "Point", coordinates: [c.longitude, c.latitude] },
      properties: {
        id: c.id,
        kind: "cluster",
        label: String(c.count),
        // A cluster is not a place, so it never gets a name label. The keys
        // exist anyway because a source with two feature shapes is a source
        // where half the expressions silently evaluate to null.
        name: "",
        categoryLabel: "",
        labelRank: 1000,
        color: band.bg,
        textColor: band.fg,
        radius: band.r,
        count: c.count,
        approx: 0,
        // A cluster is many properties; there is no single photograph that
        // honestly represents it, and picking one would advertise whichever
        // hotel happened to sort first.
        thumb: "",
        thumbSrc: "",
      },
    });
    index.set(c.id, { kind: "cluster", cluster: c, lngLat: [c.longitude, c.latitude] });
  }

  for (const p of points) {
    const moved = spider.get(p.id);
    const coords = moved?.display ?? [p.longitude, p.latitude];
    const curated = p.source === "curated";

    if (moved) {
      leaders.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [moved.anchor, moved.display] },
        properties: {},
      });
    }

    const thumbSrc = curated ? thumbnailSource(p) : null;

    features.push({
      type: "Feature",
      id: hashId(p.id),
      geometry: { type: "Point", coordinates: coords },
      properties: {
        id: p.id,
        kind: curated ? "property" : "osm",
        label: curated && p.stars ? String(p.stars) : "",
        color: curated ? categoryColor(p) : "#FFFFFF",
        textColor: "#FFFFFF",
        radius: curated ? 17 : 6,
        count: 0,
        approx: curated && p.precision !== "exact" ? 1 : 0,
        // Only curated properties can have a photograph; OSM points carry no
        // imagery at all, and are context rather than the subject.
        thumb: curated && thumbSrc ? thumbId(p.id) : "",
        thumbSrc: curated && thumbSrc ? thumbSrc : "",
        name: p.name ?? "",
        categoryLabel: categoryLabelFor(p),
        labelRank: labelRankFor(p, selectedId),
      },
    });
    // The listing and the hover card both need the TRUE position, not the
    // displaced one — a spiderfied marker is drawn beside its building, not on
    // a different building.
    index.set(p.id, { kind: curated ? "property" : "osm", point: p, lngLat: [p.longitude, p.latitude] });
  }

  return {
    points: { type: "FeatureCollection", features },
    leaders: { type: "FeatureCollection", features: leaders },
    index,
  };
}

/** MapLibre feature ids must be numeric for feature-state to work. */
/** Stable numeric feature id for a point's string id. Exported so the results
 *  list can light the marker for a card through feature-state. */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- layer specifications ---------------------------------------------------

/**
 * The layers, in draw order.
 *
 * Leader lines sit underneath everything so a fanned marker's tether never
 * crosses a neighbouring pin's face. OSM dots come next — they are context, not
 * the subject — then curated properties, then clusters on top.
 */
/**
 * How long a hover takes to settle, in ms.
 *
 * Without a transition the radius jumps between two integers on the frame the
 * pointer crosses the edge, which reads as a glitch rather than as a response.
 * 160ms is long enough to be seen as motion and short enough that the marker is
 * never still growing by the time the card opens over it.
 */
const HOVER_MS = 160;

export function layerSpecs(): LayerSpecification[] {
  // Typed rather than inferred: an untyped array literal widens to string[]
  // and MapLibre's expression types reject it.
  const hovered: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];

  return [
    {
      id: LYR_LEADERS,
      type: "line",
      source: SRC_LEADERS,
      paint: {
        "line-color": "#8A9599",
        "line-width": 1.25,
        "line-dasharray": [2, 2],
        "line-opacity": 0.9,
      },
    },
    {
      // A halo behind whichever marker is active. It is its OWN SOURCE holding a
      // single feature rather than a paint expression over all of them: MapLibre
      // `filter` cannot read feature-state, so the alternative was an expression
      // evaluated against every point on every animation frame. One feature is
      // cheaper and the animation can drive plain numeric paint properties.
      id: LYR_PULSE,
      type: "circle",
      source: SRC_PULSE,
      paint: {
        "circle-radius": 0,
        "circle-color": "#00E6A7",
        "circle-opacity": 0,
      },
    },
    {
      id: LYR_OSM,
      type: "circle",
      source: SRC_POINTS,
      filter: ["==", ["get", "kind"], "osm"],
      paint: {
        "circle-radius": ["case", hovered, 9, ["get", "radius"]],
        "circle-radius-transition": { duration: HOVER_MS, delay: 0 },
        "circle-color": ["get", "color"],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": ["case", hovered, "#00E6A7", "#94A3B8"],
        "circle-stroke-color-transition": { duration: HOVER_MS, delay: 0 },
        "circle-opacity": 0.95,
      },
    },
    {
      id: LYR_PROPERTY,
      type: "circle",
      source: SRC_POINTS,
      // Excludes anything drawn as a photograph, so the two never stack. A
      // property whose thumbnail FAILS to load keeps `thumb` set but renders
      // no icon — which is why the photo layer sits above this one rather than
      // replacing it: the circle underneath is the fallback, and it is already
      // there rather than needing to be put back.
      filter: ["==", ["get", "kind"], "property"],
      paint: {
        // Hover grows the circle here rather than in CSS. Same 8% lift the DOM
        // markers had, now done on the GPU.
        "circle-radius": [
          "*",
          ["get", "radius"],
          ["case", hovered, 1.12, 1],
        ],
        "circle-radius-transition": { duration: HOVER_MS, delay: 0 },
        "circle-color": ["get", "color"],
        "circle-stroke-width": 2.5,
        // An unconfirmed position is drawn differently rather than hidden. A
        // circle layer cannot dash its stroke, so the distinction is carried by
        // a translucent ring instead of a dashed one.
        "circle-stroke-color": [
          "case",
          ["==", ["get", "approx"], 1],
          "rgba(255,255,255,0.55)",
          "rgba(255,255,255,0.92)",
        ],
        "circle-opacity": ["case", ["==", ["get", "approx"], 1], 0.82, 1],
      },
    },
    {
      // Photographs. A symbol layer rather than a circle, because only symbols
      // can carry a bitmap.
      id: LYR_PHOTO,
      type: "symbol",
      source: SRC_POINTS,
      filter: ["all", ["==", ["get", "kind"], "property"], ["!=", ["get", "thumb"], ""]],
      layout: {
        "icon-image": ["get", "thumb"],
        // CONSTANT, and it has to be.
        //
        // This read `["case", ["boolean", ["feature-state", "hover"], false],
        // 1.12, 1]` to grow the photo on hover, matching the circle layer. That
        // is invalid: MapLibre supports `feature-state` in PAINT properties
        // only, and `icon-size` is a LAYOUT property.
        //
        // The failure was silent and total. `Style.addLayer` validates, fires an
        // error event and returns WITHOUT adding — it does not throw — so the
        // loop that adds the layers carried on and every later layer was added
        // normally. The photo layer simply was never in the style: no photo
        // markers drew, none answered a hover, and the only visible symptom was
        // `queryRenderedFeatures` reporting "The layer 'hm-photo' does not
        // exist" once per pointer move.
        //
        // There is no paint-property route back to the hover growth either: the
        // symbol paint properties that accept feature-state cannot scale a
        // BITMAP icon (`icon-color` applies to SDF icons only), and splitting
        // into a normal and a hovered layer needs a filter on feature-state,
        // which `filter` cannot read — the same limitation noted on LYR_PULSE.
        // That halo is what carries the active-marker emphasis here.
        "icon-size": 1,
        // A marker must stay on its building. Letting the collision detector
        // move or drop it would put the photograph on a different hotel.
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    {
      id: LYR_CLUSTER,
      type: "circle",
      source: SRC_POINTS,
      filter: ["==", ["get", "kind"], "cluster"],
      paint: {
        "circle-radius": ["*", ["get", "radius"], ["case", hovered, 1.1, 1]],
        "circle-radius-transition": { duration: HOVER_MS, delay: 0 },
        "circle-color": ["get", "color"],
        "circle-stroke-width": 1.5,
        // Emerald ring, brighter on hover: the cluster reads as a FurlPay
        // control on the dark basemap without a glow.
        "circle-stroke-color": ["case", hovered, "#00E6A7", "rgba(0,230,167,0.65)"],
      },
    },
    {
      id: LYR_PROPERTY_LABEL,
      type: "symbol",
      source: SRC_POINTS,
      filter: ["==", ["get", "kind"], "property"],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
        // The label belongs to its circle. Letting the collision detector move
        // or drop it would separate a star rating from the pin it describes.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": ["get", "textColor"] },
    },
    {
      // ── PROPERTY NAMES ────────────────────────────────────────────────
      // The layer that turns a map of anonymous dots into a directory.
      //
      // COLLISION IS ON HERE, deliberately unlike every other symbol layer in
      // this file. A star inside a circle belongs to that circle and must never
      // be moved or dropped, so those layers set allow-overlap. A NAME beside a
      // pin is the opposite case: in a dense street there is not room for all
      // of them, and drawing them anyway produces a stack of overlapping words
      // that is less readable than no names at all. So MapLibre may drop the
      // ones that do not fit, and `symbol-sort-key` decides which survive.
      //
      // MINZOOM IS THE OTHER HALF. Below 12 a viewport spans a country, and
      // hundreds of names would be a wall of text over the geography — which is
      // the exact failure the cluster counts exist to prevent.
      id: LYR_PROPERTY_NAME,
      type: "symbol",
      source: SRC_POINTS,
      filter: [
        "all",
        ["in", ["get", "kind"], ["literal", ["property", "osm"]]],
        // No name, no label. Never an empty box beside a pin.
        ["!=", ["get", "name"], ""],
      ],
      minzoom: 12,
      layout: {
        // Two lines in ONE label, so the name and its category collide, move
        // and drop together rather than drifting apart.
        //
        // DENSITY IS GATED BY ZOOM, not left to the collision detector alone.
        // Collision guarantees labels never overlap, but it does not decide
        // WHICH ones are worth showing: at zoom 12 a Dubai viewport holds ~200
        // mapped hotels and the detector will happily fill every gap, which is
        // readable and still far too busy to read a city through. So below
        // zoom 14 only the well-described properties are named — labelRank
        // puts curated ones near 40-100 and bare OSM points at 900 — and the
        // rest of the names arrive as the reader zooms in and earns the room
        // for them. An empty text-field draws nothing and reserves no
        // collision box, so a hidden label also frees space for a kept one.
        //
        // `["zoom"]` sits at the top level of a `step`, which is the only form
        // the style spec allows it in.
        "text-field": [
          "step",
          ["zoom"],
          ["case", [">=", ["get", "labelRank"], 500], "", NAME_LABEL],
          14,
          NAME_LABEL,
        ],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11, 16, 12.5],
        // Anchored left and offset right of the pin, so the label reads as
        // belonging to that marker rather than floating between two.
        "text-anchor": "left",
        "text-offset": [1.25, 0],
        "text-max-width": 10,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        // If the name cannot be placed, the PIN still draws. Without this
        // MapLibre drops the marker along with its label.
        "text-optional": true,
        "text-padding": 3,
        "symbol-sort-key": ["get", "labelRank"],
      },
      paint: {
        // A halo rather than a drawn pill: legible over terrain, water and
        // roads without putting an opaque rectangle on the cartography, which
        // is what makes a label feel part of the map instead of on top of it.
        // Light names on a dark halo for the dark basemap.
        "text-color": "#F5F7F6",
        "text-halo-color": "rgba(5,9,9,0.92)",
        "text-halo-width": 1.6,
        "text-halo-blur": 0.3,
      },
    },
    {
      id: LYR_CLUSTER_LABEL,
      type: "symbol",
      source: SRC_POINTS,
      filter: ["==", ["get", "kind"], "cluster"],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"],
        "text-size": ["step", ["get", "count"], 15, 100, 14, 1000, 12],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": ["get", "textColor"] },
    },
  ];
}
