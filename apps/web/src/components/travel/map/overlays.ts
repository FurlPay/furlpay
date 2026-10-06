import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";

// Travel-context overlays on the hotel map: airports, a flight route, the
// radius-search circle and nearby places. Each is its own GeoJSON source so
// none of them touches the hotel features or their feature-state.
//
// Drawn UNDER the hotel layers (added before them), so a hotel pin always wins
// a hit-test and an overlay can never steal a hotel's hover or click — except
// airports, which are only interactive while their layer is switched on.

export const SRC_AIRPORTS = "hm-airports";
export const SRC_ROUTE = "hm-route";
export const SRC_RADIUS = "hm-radius";
export const SRC_POIS = "hm-pois";

export const LYR_AIRPORT_DOT = "hm-airport-dot";
export const LYR_AIRPORT_LABEL = "hm-airport-label";
export const LYR_ROUTE = "hm-route-line";
export const LYR_ROUTE_ENDS = "hm-route-ends";
export const LYR_RADIUS_FILL = "hm-radius-fill";
export const LYR_RADIUS_LINE = "hm-radius-line";
export const LYR_POI = "hm-poi";
export const LYR_POI_LABEL = "hm-poi-label";

export const OVERLAY_SOURCES = [SRC_RADIUS, SRC_ROUTE, SRC_POIS, SRC_AIRPORTS] as const;

/** One colour per nearby-place category, readable on both map grounds. */
export const POI_COLORS: Record<string, string> = {
  restaurant: "#F59E0B",
  cafe: "#D97706",
  attraction: "#A78BFA",
  museum: "#8B5CF6",
  shopping: "#EC4899",
  transport: "#38BDF8",
};

const poiColorExpr = [
  "match",
  ["get", "category"],
  ...Object.entries(POI_COLORS).flat(),
  "#94A3B8",
] as unknown as ExpressionSpecification;

/** Layers in draw order, all BELOW the hotel layers. */
export function overlayLayerSpecs(): LayerSpecification[] {
  return [
    {
      id: LYR_RADIUS_FILL,
      type: "fill",
      source: SRC_RADIUS,
      paint: { "fill-color": "#00E6A7", "fill-opacity": 0.07 },
    },
    {
      id: LYR_RADIUS_LINE,
      type: "line",
      source: SRC_RADIUS,
      paint: { "line-color": "#00E6A7", "line-width": 1.5, "line-opacity": 0.8, "line-dasharray": [3, 2] },
    },
    {
      // Geodesic arc between two real airports. Dashed and translucent so it
      // reads as "the way there", never as a road on the cartography.
      id: LYR_ROUTE,
      type: "line",
      source: SRC_ROUTE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round" },
      paint: {
        "line-color": "#38BDF8",
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.6, 8, 2.6],
        "line-opacity": 0.85,
        "line-dasharray": [2, 1.6],
      },
    },
    {
      id: LYR_ROUTE_ENDS,
      type: "circle",
      source: SRC_ROUTE,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 5,
        "circle-color": "#38BDF8",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#030505",
      },
    },
    {
      id: LYR_POI,
      type: "circle",
      source: SRC_POIS,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3.5, 16, 5.5],
        "circle-color": poiColorExpr,
        "circle-stroke-width": 1.2,
        "circle-stroke-color": "#030505",
        "circle-opacity": 0.95,
      },
    },
    {
      id: LYR_POI_LABEL,
      type: "symbol",
      source: SRC_POIS,
      minzoom: 15,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10.5,
        "text-anchor": "top",
        "text-offset": [0, 0.7],
        "text-max-width": 9,
        "text-optional": true,
      },
      paint: { "text-color": "#C9CFCD", "text-halo-color": "rgba(5,9,9,0.9)", "text-halo-width": 1.2 },
    },
    {
      id: LYR_AIRPORT_DOT,
      type: "circle",
      source: SRC_AIRPORTS,
      paint: {
        "circle-radius": [
          "*",
          ["match", ["get", "size"], 3, 7, 2, 5.5, 4],
          ["case", ["boolean", ["feature-state", "hover"], false], 1.25, 1],
        ],
        "circle-color": "#0B1F2A",
        "circle-stroke-width": 2,
        "circle-stroke-color": ["case", ["boolean", ["feature-state", "hover"], false], "#7DD3FC", "#38BDF8"],
      },
    },
    {
      // The IATA code, the thing travellers actually read on a departures
      // board. Hubs from zoom 4, everything from 8; names from 11.
      id: LYR_AIRPORT_LABEL,
      type: "symbol",
      source: SRC_AIRPORTS,
      minzoom: 4,
      layout: {
        "text-field": [
          "step",
          ["zoom"],
          ["case", ["==", ["get", "size"], 3], ["get", "iata"], ""],
          8,
          ["get", "iata"],
          11,
          ["format", ["get", "iata"], {}, "\n", {}, ["get", "name"], { "font-scale": 0.8 }],
        ],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.9],
        "text-max-width": 10,
        "text-optional": true,
      },
      paint: { "text-color": "#7DD3FC", "text-halo-color": "rgba(5,9,9,0.92)", "text-halo-width": 1.4 },
    },
  ];
}

/** Airports as features. Numeric ids so feature-state hover works. */
export function airportFeatures(
  airports: Array<{ iata: string; name: string; city: string; country: string; size: number; latitude: number; longitude: number }>
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: airports.map((a, i) => ({
      type: "Feature",
      id: i + 1,
      geometry: { type: "Point", coordinates: [a.longitude, a.latitude] },
      properties: { iata: a.iata, name: a.name, city: a.city, country: a.country, size: a.size },
    })),
  };
}
