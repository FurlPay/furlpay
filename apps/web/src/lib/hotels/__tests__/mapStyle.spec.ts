import { describe, expect, it } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import { applyPalette, applyPaletteToMap, DARK_MAP_PALETTE, MAP_PALETTE } from "../mapStyle";

const style = (): StyleSpecification =>
  ({
    version: 8,
    sources: {},
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#fff" } },
      { id: "water", type: "fill", source: "x", paint: {} },
      { id: "highway_major", type: "line", source: "x", paint: {} },
      { id: "label_city", type: "symbol", source: "x", paint: {} },
      { id: "railway_transit", type: "line", source: "x", paint: { "line-color": "#dddddd" } },
      { id: "railway_transit_dashline", type: "line", source: "x", paint: { "line-color": "#fafafa" } },
      { id: "hm-price", type: "symbol", source: "x", paint: { "text-color": "#030505" } },
      { id: "mystery_layer", type: "fill", source: "x", paint: { "fill-color": "#123456" } },
    ],
  }) as unknown as StyleSpecification;

describe("applyPalette (fetched style)", () => {
  it("recolours land, water, roads and place labels for each theme", () => {
    for (const p of [MAP_PALETTE, DARK_MAP_PALETTE]) {
      const out = applyPalette(style(), p);
      const paint = (id: string) => (out.layers.find((l) => l.id === id) as { paint: Record<string, unknown> }).paint;
      expect(paint("background")["background-color"]).toBe(p.land);
      expect(paint("water")["fill-color"]).toBe(p.water);
      expect(paint("highway_major")["line-color"]).toBe(p.road);
      expect(paint("label_city")["text-color"]).toBe(p.label);
      expect(paint("label_city")["text-halo-color"]).toBe(p.labelHalo);
      expect(paint("mystery_layer")["fill-color"]).toBe("#123456"); // unknown layers untouched
      // Railways were left near-white — the brightest thing on the dark map.
      expect(paint("railway_transit")["line-color"]).toBe(p.rail);
      expect(paint("railway_transit_dashline")["line-color"]).toBe(p.land);
    }
  });
});

describe("applyPaletteToMap (live light/dark switch)", () => {
  function fakeMap() {
    const calls: Array<[string, string, unknown]> = [];
    return {
      calls,
      getStyle: () => style(),
      setPaintProperty: (layer: string, name: string, value: unknown) => {
        calls.push([layer, name, value]);
      },
    };
  }

  it("applies the same paint as the fetched-style path", () => {
    const m = fakeMap();
    applyPaletteToMap(m, "light");
    expect(m.calls).toContainEqual(["background", "background-color", MAP_PALETTE.land]);
    expect(m.calls).toContainEqual(["water", "fill-color", MAP_PALETTE.water]);
    const dark = fakeMap();
    applyPaletteToMap(dark, "dark");
    expect(dark.calls).toContainEqual(["label_city", "text-halo-color", DARK_MAP_PALETTE.labelHalo]);
  });

  it("never repaints the app's own layers or unknown ones", () => {
    const m = fakeMap();
    applyPaletteToMap(m, "light");
    expect(m.calls.some(([id]) => id === "hm-price")).toBe(false);
    expect(m.calls.some(([id]) => id === "mystery_layer")).toBe(false);
  });

  it("survives a property the layer rejects", () => {
    const m = { getStyle: () => style(), setPaintProperty: () => { throw new Error("nope"); } };
    expect(() => applyPaletteToMap(m, "dark")).not.toThrow();
  });
});
