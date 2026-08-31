// ---------------------------------------------------------------------------
// The basemap palette, for the native map.
//
// A PORT OF apps/web/src/lib/hotels/mapStyle.ts, and the values are the reason
// this file exists rather than a platform default. Google Maps and Apple Maps
// look like Google Maps and Apple Maps; the point of using MapLibre here is
// that the phone shows the SAME warm ivory cartography as furlpay.com, drawn
// from the same OpenFreeMap tiles.
//
// WHY THE STYLE IS FETCHED AND REPAINTED rather than hand-authored: positron
// already separates terrain, water, roads and labels onto their own layers, so
// the palette is applied over it. Hand-authoring the whole style would mean
// maintaining it against upstream tile-schema changes forever.
//
// WHY THE RULES ARE PATTERNS AND NOT A LAYER LIST: hard-coding 55 layer ids
// means the first time OpenFreeMap renames one, that layer keeps its upstream
// colour and the map grows a stripe nobody can explain. An unrecognised layer
// keeps what it had, which is wrong-but-legible rather than invisible.
// ---------------------------------------------------------------------------

export const MAP_PALETTE = {
  land: "#F7F5EF",
  terrain: "#EEF2E7",
  water: "#DCECF2",
  ice: "#F4F7F8",
  residential: "#F2EFE6",
  building: "#EDE9DE",
  road: "#E8E5D9",
  roadCasing: "#E0DCCE",
  border: "#E4E0D4",
  /** Place names are the strongest text on the map. #5B564C clears 4.5:1 on
   *  every land colour here; the web shipped #A5A29A first and the labels were
   *  effectively invisible, which reads as "this map has no labels". */
  label: "#5B564C",
  labelSecondary: "#867F72",
  labelHalo: "#FFFFFF",
} as const;

export const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

type Rule = { test: RegExp; fill?: string; line?: string; opacity?: number };

/** First match wins, so specific patterns come before general ones. */
const RULES: Rule[] = [
  { test: /^background$/, fill: MAP_PALETTE.land },
  { test: /water|waterway|ocean|sea/, fill: MAP_PALETTE.water, line: MAP_PALETTE.water },
  { test: /ice_shelf|glacier/, fill: MAP_PALETTE.ice },
  { test: /park|wood|forest|grass|landcover/, fill: MAP_PALETTE.terrain },
  { test: /residential|landuse/, fill: MAP_PALETTE.residential },
  { test: /building/, fill: MAP_PALETTE.building, opacity: 0.5 },
  { test: /casing/, line: MAP_PALETTE.roadCasing },
  { test: /boundary|admin/, line: MAP_PALETTE.border },
  { test: /highway|road|aeroway|bridge|tunnel|pier|path/, line: MAP_PALETTE.road },
];

const PLACE_LABEL =
  /place|label_(country|state|city|town|village|other)|country|city|town/;

type StyleLayer = {
  id: string;
  type: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};
type StyleSpec = { layers: StyleLayer[]; [k: string]: unknown };

/** Apply the palette to a parsed style. Touches paint only — never layout, and
 *  never the sources. */
export function applyPalette(style: StyleSpec): StyleSpec {
  const next: StyleSpec = JSON.parse(JSON.stringify(style));

  for (const layer of next.layers) {
    const id = layer.id.toLowerCase();
    const paint = (layer.paint ??= {});

    if (layer.type === "symbol") {
      const isPlace = PLACE_LABEL.test(id);
      paint["text-color"] = isPlace ? MAP_PALETTE.label : MAP_PALETTE.labelSecondary;
      paint["text-halo-color"] = MAP_PALETTE.labelHalo;
      paint["text-halo-width"] = isPlace ? 1.9 : 1.3;
      paint["text-halo-blur"] = 0.4;
      // Route shields read as UI chrome at this size and compete with the
      // markers, which are the only things on this surface that should look
      // like controls. The TEXT stays; only the badge goes.
      if (/shield/.test(id)) paint["icon-opacity"] = 0;
      continue;
    }

    const rule = RULES.find((r) => r.test.test(id));
    if (!rule) continue;

    if (layer.type === "background" && rule.fill) {
      paint["background-color"] = rule.fill;
    } else if (layer.type === "fill" && rule.fill) {
      paint["fill-color"] = rule.fill;
      paint["fill-outline-color"] = rule.fill;
      if (rule.opacity !== undefined) paint["fill-opacity"] = rule.opacity;
    } else if (layer.type === "line" && rule.line) {
      paint["line-color"] = rule.line;
    }
  }

  return next;
}

/**
 * The recoloured style as a JSON string, or the plain URL when the fetch fails.
 *
 * MapLibre React Native's `mapStyle` takes either, so a network hiccup costs the
 * palette rather than the map — a grey basemap is a far better failure than a
 * blank one.
 */
export async function luxuryMapStyle(signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(BASE_STYLE_URL, { signal });
    if (!res.ok) return BASE_STYLE_URL;
    return JSON.stringify(applyPalette((await res.json()) as StyleSpec));
  } catch {
    return BASE_STYLE_URL;
  }
}
