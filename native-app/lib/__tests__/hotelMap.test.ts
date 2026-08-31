import {
  bandFor,
  categoryColor,
  categoryLabel,
  imageUriFor,
  LUXURY_CATEGORIES,
  FAMILIES,
} from "@/lib/hotelMap";
import { applyPalette, MAP_PALETTE } from "@/lib/hotelMapStyle";

// ---------------------------------------------------------------------------
// The parts of the map that are decidable without a device.
//
// The screen itself needs a real MapLibre surface, so it is verified by running
// the app. What CAN be pinned here is everything the phone and the browser have
// to agree on: the band table, the category colours, and the basemap palette.
// Those three are duplicated from apps/web rather than shared through a package,
// and a value that drifts is a map that no longer matches itself across
// platforms — a difference nobody notices until both are open side by side.
// ---------------------------------------------------------------------------

describe("count bands", () => {
  it("grows monotonically with the count", () => {
    const radii = [1, 5, 6, 15, 16, 50, 51, 100, 101, 5000].map((c) => bandFor(c).r);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThanOrEqual(radii[i - 1]);
    }
  });

  it("matches the web's band table exactly", () => {
    // These are the values in apps/web/src/components/travel/map/layers.ts.
    // If the web changes them, this fails and the phone gets updated too.
    expect(bandFor(3)).toEqual({ max: 5, r: 20, bg: "#8BCF4A", fg: "#FFFFFF" });
    expect(bandFor(12)).toEqual({ max: 15, r: 22, bg: "#8BCF4A", fg: "#FFFFFF" });
    expect(bandFor(40)).toEqual({ max: 50, r: 24, bg: "#F4C430", fg: "#1F2937" });
    expect(bandFor(75)).toEqual({ max: 100, r: 26, bg: "#F97316", fg: "#FFFFFF" });
    expect(bandFor(900).r).toBe(28);
  });

  it("never leaves a count unbanded", () => {
    for (const c of [1, 7, 42, 99, 500, 10_000]) {
      expect(bandFor(c).r).toBeGreaterThan(0);
      expect(bandFor(c).bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("keeps a readable label colour on every band", () => {
    // Amber takes dark text, everything else white. A band that got this wrong
    // renders an unreadable count.
    for (const c of [1, 20, 60, 200]) {
      const b = bandFor(c);
      expect(b.fg).toBe(b.bg === "#F4C430" ? "#1F2937" : "#FFFFFF");
    }
  });
});

describe("category colours", () => {
  it("uses the FIRST matching category, in pill order", () => {
    // Order is load-bearing: a property in several collections takes the colour
    // of the earliest one, so reordering the list silently recolours the map.
    expect(categoryColor(["boutique", "ultra_luxury"])).toBe("#B8860B");
    expect(categoryColor(["boutique"])).toBe("#8B5CF6");
  });

  it("matches the web's palette", () => {
    expect(categoryColor(["ultra_luxury"])).toBe("#B8860B");
    expect(categoryColor(["overwater_villas"])).toBe("#0E7490");
    expect(categoryColor(["heritage_castles"])).toBe("#9A3412");
    expect(categoryColor(["vineyard_wellness"])).toBe("#1B7A4E");
  });

  it("falls back rather than returning nothing", () => {
    expect(categoryColor(undefined)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(categoryColor([])).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(categoryColor(["not_a_category"])).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("carries all ten collections with a label each", () => {
    expect(LUXURY_CATEGORIES).toHaveLength(10);
    for (const c of LUXURY_CATEGORIES) {
      expect(categoryLabel(c.id)).toBe(c.label);
      expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("partitions properties into exactly three families", () => {
    expect(FAMILIES.map((f) => f.id)).toEqual(["hotels", "resorts", "villas"]);
  });
});

describe("imagery", () => {
  const ORIGIN = "https://furlpay.com";

  it("prefers the locally-hosted file, absolutised against the web origin", () => {
    // The dataset stores "/hotels/<category>/<slug>.jpg", which is relative to
    // the web app. A native client has no origin of its own to resolve it.
    expect(
      imageUriFor({ imageLocalPath: "/hotels/ultra_luxury/aman-venice.jpg" }, ORIGIN)
    ).toBe("https://furlpay.com/hotels/ultra_luxury/aman-venice.jpg");
  });

  it("falls back to the Commons thumbnail, then the full image", () => {
    expect(imageUriFor({ imageThumbUrl: "https://commons/thumb.jpg" }, ORIGIN)).toBe(
      "https://commons/thumb.jpg"
    );
    expect(imageUriFor({ imageUrl: "https://commons/full.jpg" }, ORIGIN)).toBe(
      "https://commons/full.jpg"
    );
  });

  it("returns nothing when a property has no photograph", () => {
    // 356 of the 507 curated properties have none, so this is the common case
    // and must not produce a broken <Image> source.
    expect(imageUriFor({}, ORIGIN)).toBeUndefined();
  });
});

describe("basemap palette", () => {
  const style = {
    layers: [
      { id: "background", type: "background" },
      { id: "water", type: "fill" },
      { id: "landcover_wood", type: "fill" },
      { id: "highway_minor", type: "line" },
      { id: "boundary_country", type: "line" },
      { id: "label_city", type: "symbol" },
      { id: "highway-name-minor", type: "symbol" },
      { id: "highway-shield-us-interstate", type: "symbol" },
      { id: "some_future_layer", type: "fill" },
    ],
  };

  it("paints land, water and terrain to the web's values", () => {
    const out = applyPalette(JSON.parse(JSON.stringify(style)));
    const byId = Object.fromEntries(out.layers.map((l) => [l.id, l.paint ?? {}]));
    expect(byId.background["background-color"]).toBe(MAP_PALETTE.land);
    expect(byId.water["fill-color"]).toBe(MAP_PALETTE.water);
    expect(byId.landcover_wood["fill-color"]).toBe(MAP_PALETTE.terrain);
    expect(byId.highway_minor["line-color"]).toBe(MAP_PALETTE.road);
    expect(byId.boundary_country["line-color"]).toBe(MAP_PALETTE.border);
  });

  it("gives place names the strong colour and everything else the quiet one", () => {
    // The web shipped a single faint grey first and the labels were effectively
    // invisible, which reads as "this map has no place names".
    const out = applyPalette(JSON.parse(JSON.stringify(style)));
    const byId = Object.fromEntries(out.layers.map((l) => [l.id, l.paint ?? {}]));
    expect(byId.label_city["text-color"]).toBe(MAP_PALETTE.label);
    expect(byId["highway-name-minor"]["text-color"]).toBe(MAP_PALETTE.labelSecondary);
  });

  it("hides route shields without hiding their text", () => {
    const out = applyPalette(JSON.parse(JSON.stringify(style)));
    const shield = out.layers.find((l) => l.id === "highway-shield-us-interstate")!;
    expect(shield.paint!["icon-opacity"]).toBe(0);
    expect(shield.paint!["text-color"]).toBeDefined();
  });

  it("leaves an unrecognised layer alone rather than blanking it", () => {
    // Degrading to the upstream colour is wrong-but-legible; painting it a
    // default would put an unexplained stripe on the map.
    const out = applyPalette(JSON.parse(JSON.stringify(style)));
    const future = out.layers.find((l) => l.id === "some_future_layer")!;
    expect(future.paint!["fill-color"]).toBeUndefined();
  });

  it("does not mutate the style it was given", () => {
    const input = JSON.parse(JSON.stringify(style));
    applyPalette(input);
    expect(input.layers[0].paint).toBeUndefined();
  });
});
