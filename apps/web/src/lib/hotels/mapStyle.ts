import type { StyleSpecification } from "maplibre-gl";

// ---------------------------------------------------------------------------
// The basemap palette.
//
// WHY RECOLOUR RATHER THAN PICK A STYLE. OpenFreeMap ships positron (grey),
// liberty (saturated) and bright. None of them is the warm ivory cartography
// this surface wants, and none is quiet enough: the map is the BACKGROUND for a
// floating header and a hover card, so anything with strong road colour or
// confident label contrast fights the UI sitting on top of it.
//
// positron is the closest starting point — it already has the right structure,
// with terrain, water, roads and labels on separate layers — so the palette is
// applied over it rather than a whole style being hand-authored and then having
// to be maintained against upstream tile schema changes.
//
// WHY THE RULES ARE PATTERNS AND NOT A LAYER LIST. Hard-coding 55 layer ids
// means the first time OpenFreeMap renames or splits one, that layer silently
// keeps its old colour and the map develops a stripe nobody can explain.
// Matching on id patterns degrades the right way: an unrecognised layer keeps
// its upstream colour, which is wrong-but-legible rather than invisible.
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
  /**
   * Labels.
   *
   * WAS #A5A29A, WHICH WAS TOO QUIET TO READ. On ivory that is roughly a 2:1
   * contrast ratio — the place names were being drawn, and were effectively
   * invisible, which reads as "the map has no labels" rather than as restraint.
   * #5B564C clears 4.5:1 against every land colour in this palette while still
   * sitting well below the markers in the visual hierarchy.
   */
  label: "#5B564C",
  labelSecondary: "#867F72",
  labelHalo: "#FFFFFF",
} as const;

/** Layer id patterns -> the paint they should take. First match wins, so the
 *  specific patterns are listed before the general ones. */
const RULES: Array<{
  test: RegExp;
  fill?: string;
  line?: string;
  text?: string;
  opacity?: number;
}> = [
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

/**
 * Apply the palette to a fetched style.
 *
 * Mutates a parsed copy rather than the network response, and never touches
 * `layout` or the data sources — only paint. A layer whose id matches nothing
 * is left exactly as upstream drew it.
 */
export function applyPalette(style: StyleSpecification): StyleSpecification {
  const next: StyleSpecification = JSON.parse(JSON.stringify(style));

  for (const layer of next.layers) {
    const id = layer.id.toLowerCase();
    const paint = ((layer as { paint?: Record<string, unknown> }).paint ??= {});

    if (layer.type === "symbol") {
      // PLACE NAMES ARE THE POINT OF A MAP. A country, a city or a town label
      // is how a user knows where they are looking before a single marker
      // means anything, so these are the strongest text on the surface.
      // Roads, water and minor features are the supporting tier.
      const isPlace = /place|label_(country|state|city|town|village|other)|country|city|town/.test(id);
      paint["text-color"] = isPlace ? MAP_PALETTE.label : MAP_PALETTE.labelSecondary;
      paint["text-halo-color"] = MAP_PALETTE.labelHalo;
      // A wide halo is what lets a dark label stay readable over terrain and
      // water without the map needing more contrast of its own.
      paint["text-halo-width"] = isPlace ? 1.9 : 1.3;
      paint["text-halo-blur"] = 0.4;
      // Route shields and airport glyphs read as UI chrome at this weight and
      // compete with the markers, which are the only things that should look
      // like controls on this surface. The TEXT stays; only the badge goes.
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

export const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/**
 * The recoloured style, or the plain URL when the fetch fails.
 *
 * Falling back to the URL means a network hiccup costs the palette, not the
 * map. A blank viewport would be a much worse failure than a grey one.
 */
export async function luxuryMapStyle(
  signal?: AbortSignal
): Promise<StyleSpecification | string> {
  try {
    const res = await fetch(BASE_STYLE_URL, { signal });
    if (!res.ok) return BASE_STYLE_URL;
    return applyPalette((await res.json()) as StyleSpecification);
  } catch {
    return BASE_STYLE_URL;
  }
}
