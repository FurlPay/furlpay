import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import {
  INTERACTIVE_LAYERS,
  SRC_LEADERS,
  SRC_POINTS,
  SRC_PULSE,
  SRC_VECTOR,
  VECTOR_SOURCE_LAYER,
  layerSpecs,
  vectorLayerSpecs,
} from "../layers";
import { OVERLAY_SOURCES, overlayLayerSpecs } from "../overlays";

// ---------------------------------------------------------------------------
// Every layer the hit-test queries must actually be addable.
//
// WHY THIS EXISTS. MapLibre's `addLayer` does NOT throw on an invalid layer —
// Style.addLayer validates, fires an error event, and returns without adding.
// The loop that adds the layers therefore continues happily, and the only
// symptom is the NEXT thing that references the missing id. Here that was
// `queryRenderedFeatures({ layers })`, which reported
//
//   The layer 'hm-photo' does not exist in the map's style
//
// once per pointer move. A layer silently failing to be added is also a
// functional bug and not just console noise: a marker on a layer that was never
// added draws nothing and answers no hover, so photo pins would stop being
// interactive with nothing in the UI to say why.
//
// Asserting validity here catches that at test time rather than by reading a
// console during a manual pass.
// ---------------------------------------------------------------------------

/** A minimal style carrying the sources the layers reference. */
function styleWith(layers: unknown[]) {
  return {
    version: 8 as const,
    sources: {
      [SRC_POINTS]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      [SRC_LEADERS]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      [SRC_PULSE]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers,
  };
}

describe("layerSpecs() are valid against the MapLibre style spec", () => {
  it("produces no validation errors", () => {
    const errors = validateStyleMin(styleWith(layerSpecs()) as never);
    // Surface the actual messages when this fails — "expected 3 to be 0" would
    // otherwise send the reader back to the console we are trying to replace.
    expect(errors.map((e) => `${e.message}`)).toEqual([]);
  });

  it("every layer the hit-test queries is present in layerSpecs()", () => {
    // INTERACTIVE_LAYERS is the list passed to queryRenderedFeatures. An id in
    // it that layerSpecs() never builds is the exact mismatch that produced the
    // console error, and it is not otherwise checked anywhere.
    const built = new Set(layerSpecs().map((l) => l.id));
    const missing = INTERACTIVE_LAYERS.filter((id) => !built.has(id));
    expect(missing).toEqual([]);
  });

  it("the travel overlays (airports, route, radius, nearby places) are valid too", () => {
    const empty = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    const style = {
      version: 8 as const,
      sources: Object.fromEntries(OVERLAY_SOURCES.map((s) => [s, empty])),
      layers: overlayLayerSpecs(),
    };
    expect(validateStyleMin(style as never).map((e) => `${e.message}`)).toEqual([]);
  });

  it("the registry-tile layers are valid too", () => {
    // Added only under `?all=1`, and LYR_VECTOR joins the hit-test list when
    // they are — so the same silent-drop failure would reach the same query,
    // just for a subset of visitors. Covered here rather than left to whoever
    // next opens the map with that flag on.
    const style = {
      version: 8 as const,
      sources: {
        [SRC_VECTOR]: {
          type: "vector",
          tiles: ["https://example.invalid/{z}/{x}/{y}"],
        },
      },
      layers: vectorLayerSpecs().map((l) => ({ ...l, "source-layer": VECTOR_SOURCE_LAYER })),
    };
    expect(validateStyleMin(style as never).map((e) => `${e.message}`)).toEqual([]);
  });
});

describe("the feature-state / layout-property rule that caused this", () => {
  it("is still enforced by the validator we rely on", () => {
    // Guards the GUARD. The two suites above only catch a regression while the
    // validator keeps rejecting feature-state in a layout property. If a future
    // MapLibre relaxed that, those tests would keep passing while silently
    // checking nothing — so assert the rule itself still bites.
    const style = {
      version: 8 as const,
      sources: {
        [SRC_POINTS]: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
      layers: [
        {
          id: "probe",
          type: "symbol",
          source: SRC_POINTS,
          layout: {
            "icon-image": "x",
            "icon-size": ["case", ["boolean", ["feature-state", "hover"], false], 1.12, 1],
          },
        },
      ],
    };
    const messages = validateStyleMin(style as never).map((e) => `${e.message}`);
    expect(messages.some((m) => /feature-state/.test(m))).toBe(true);
  });
});
