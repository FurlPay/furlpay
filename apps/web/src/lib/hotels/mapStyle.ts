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
  /** Railways. Positron draws them near-white (#ddd with #fafafa dashes),
   *  which on the dark palette was the brightest thing on the map. */
  rail: "#D6D1C3",
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
};

/**
 * The dark FurlPay palette — the hotel map's default since the Travels
 * redesign (near-black workspace, emerald accents).
 *
 * Same job as the ivory one: quiet enough that markers and prices are the
 * strongest things on the surface. Land sits a step above the page background
 * so the map reads as its own panel; roads are barely lighter than land;
 * labels are a muted grey-green with a dark halo, clearing 4.5:1 for place
 * names against land without competing with the white marker labels.
 */
export const DARK_MAP_PALETTE: typeof MAP_PALETTE = {
  land: "#0B1112",
  terrain: "#0E1715",
  water: "#071A22",
  ice: "#101819",
  residential: "#0D1415",
  building: "#141C1D",
  road: "#1A2324",
  roadCasing: "#121A1B",
  rail: "#26302F",
  border: "#2A3536",
  label: "#9AA6A3",
  labelSecondary: "#5F6B69",
  labelHalo: "#050909",
};

export type MapTheme = "light" | "dark";

/** Layer id patterns -> the paint they should take. First match wins, so the
 *  specific patterns are listed before the general ones. */
function rulesFor(p: typeof MAP_PALETTE): Array<{
  test: RegExp;
  fill?: string;
  line?: string;
  text?: string;
  opacity?: number;
}> {
  return [
    { test: /^background$/, fill: p.land },
    { test: /water|waterway|ocean|sea/, fill: p.water, line: p.water },
    { test: /ice_shelf|glacier/, fill: p.ice },
    { test: /park|wood|forest|grass|landcover/, fill: p.terrain },
    { test: /residential|landuse/, fill: p.residential },
    { test: /building/, fill: p.building, opacity: 0.5 },
    // Rail before roads: the dash overlay takes the LAND colour, so it cuts
    // the rail line into the familiar hatch instead of drawing white dashes.
    { test: /railway.*dashline/, line: p.land },
    { test: /railway/, line: p.rail },
    { test: /casing/, line: p.roadCasing },
    { test: /boundary|admin/, line: p.border },
    { test: /highway|road|aeroway|bridge|tunnel|pier|path/, line: p.road },
  ];
}

/**
 * Apply a palette to a fetched style.
 *
 * Mutates a parsed copy rather than the network response, and never touches
 * `layout` or the data sources — only paint. A layer whose id matches nothing
 * is left exactly as upstream drew it.
 */
export function applyPalette(style: StyleSpecification, palette: typeof MAP_PALETTE = MAP_PALETTE): StyleSpecification {
  const next: StyleSpecification = JSON.parse(JSON.stringify(style));
  const rules = rulesFor(palette);
  for (const layer of next.layers) {
    const paint = ((layer as { paint?: Record<string, unknown> }).paint ??= {});
    Object.assign(paint, palettePaintFor(layer.id, layer.type, palette, rules));
  }
  return next;
}

/** Prefix of every layer this app adds on top of the basemap. */
const APP_LAYER_PREFIX = /^(hm-|user-)/;

/**
 * Recolour a LIVE map's basemap in place — the light/dark switch.
 *
 * `setStyle` would rebuild the style and drop every source and layer the hotel
 * map added (markers, prices, user location), so the switch instead re-applies
 * the same per-layer paint as `applyPalette` through setPaintProperty. The
 * app's own layers are skipped: they are styled for both grounds already.
 */
export function applyPaletteToMap(
  m: { getStyle(): StyleSpecification; setPaintProperty(layer: string, name: string, value: unknown): void },
  theme: MapTheme
): void {
  const palette = theme === "dark" ? DARK_MAP_PALETTE : MAP_PALETTE;
  const rules = rulesFor(palette);
  for (const layer of m.getStyle().layers) {
    if (APP_LAYER_PREFIX.test(layer.id)) continue;
    for (const [name, value] of Object.entries(palettePaintFor(layer.id, layer.type, palette, rules))) {
      try {
        m.setPaintProperty(layer.id, name, value);
      } catch {
        // A property this layer type does not accept: leave it as it was.
      }
    }
  }
}

/** The paint one basemap layer takes under a palette. Shared by both paths so
 *  a fetched style and a live switch can never disagree. */
function palettePaintFor(
  layerId: string,
  type: string,
  palette: typeof MAP_PALETTE,
  rules: ReturnType<typeof rulesFor>
): Record<string, unknown> {
  const paint: Record<string, unknown> = {};
  {
    const id = layerId.toLowerCase();
    const layer = { type };

    if (layer.type === "symbol") {
      // PLACE NAMES ARE THE POINT OF A MAP. A country, a city or a town label
      // is how a user knows where they are looking before a single marker
      // means anything, so these are the strongest text on the surface.
      // Roads, water and minor features are the supporting tier.
      const isPlace = /place|label_(country|state|city|town|village|other)|country|city|town/.test(id);
      paint["text-color"] = isPlace ? palette.label : palette.labelSecondary;
      paint["text-halo-color"] = palette.labelHalo;
      // A wide halo is what lets a label stay readable over terrain and water
      // without the map needing more contrast of its own.
      paint["text-halo-width"] = isPlace ? 1.9 : 1.3;
      paint["text-halo-blur"] = 0.4;
      // Route shields and airport glyphs read as UI chrome at this weight and
      // compete with the markers, which are the only things that should look
      // like controls on this surface. The TEXT stays; only the badge goes.
      if (/shield/.test(id)) paint["icon-opacity"] = 0;
      return paint;
    }

    const rule = rules.find((r) => r.test.test(id));
    if (!rule) return paint;

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
  return paint;
}

/** Where the reader's map-theme choice is remembered (a per-viewer
 *  convenience, so localStorage is the right home for it). */
export const MAP_THEME_STORAGE_KEY = "furlpay.hotelMap.theme";

export function readStoredMapTheme(): MapTheme {
  try {
    return window.localStorage.getItem(MAP_THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function storeMapTheme(theme: MapTheme): void {
  try {
    window.localStorage.setItem(MAP_THEME_STORAGE_KEY, theme);
  } catch {
    // private mode or blocked storage: the choice just isn't remembered
  }
}

export const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/**
 * The recoloured style, or the plain URL when the fetch fails.
 *
 * Falling back to the URL means a network hiccup costs the palette, not the
 * map. A blank viewport would be a much worse failure than a grey one — even
 * in the dark theme, where the fallback is the light upstream style.
 */
export async function luxuryMapStyle(
  signal?: AbortSignal,
  theme: MapTheme = "dark"
): Promise<StyleSpecification | string> {
  try {
    const res = await fetch(BASE_STYLE_URL, { signal });
    if (!res.ok) return BASE_STYLE_URL;
    return applyPalette((await res.json()) as StyleSpecification, theme === "dark" ? DARK_MAP_PALETTE : MAP_PALETTE);
  } catch {
    return BASE_STYLE_URL;
  }
}
