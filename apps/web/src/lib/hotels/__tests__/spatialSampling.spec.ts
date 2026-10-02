import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { datasetStats } from "../googlePlacesLayer";
import { googlePlacesInBBox, prominence, selectSpatially } from "../googlePlacesLayer";


// The Google Places layer may only be served inside its cache window
// (datasetFresh; Google Places terms). These tests exercise the FRESH path, so
// the clock is pinned inside that window: they began failing on 2026-10-01 when
// the checked-in dataset expired, testing the calendar instead of the code.
// Only Date is faked; timers and promises run normally.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(datasetStats().generatedAt) + 86_400_000);
});
afterAll(() => vi.useRealTimers());

describe("spatial sampling vs pure ranking", () => {
  it("recovers the neighbourhoods pure ranking loses", () => {
    const boxes: [string, any][] = [
      ["Paris",  { minLat:48.80, maxLat:48.92, minLng:2.24,  maxLng:2.42 }],
      ["Tokyo",  { minLat:35.60, maxLat:35.76, minLng:139.66,maxLng:139.82 }],
      ["London", { minLat:51.44, maxLat:51.58, minLng:-0.24, maxLng:-0.02 }],
      ["Dubai",  { minLat:25.05, maxLat:25.30, minLng:55.10, maxLng:55.35 }],
    ];
    const N = 8;
    console.log("\n  city      cells  ranked  sampled  recovered");
    for (const [name, b] of boxes) {
      const all = googlePlacesInBBox(b);
      const cellOf = (p:any) => {
        const i = Math.min(N-1, Math.floor((p.latitude-b.minLat)/(b.maxLat-b.minLat)*N));
        const j = Math.min(N-1, Math.floor((p.longitude-b.minLng)/(b.maxLng-b.minLng)*N));
        return i*N+j;
      };
      const cellsAll = new Set(all.map(cellOf)).size;
      const ranked = new Set([...all].sort((x,y)=>prominence(y)-prominence(x)).slice(0,300).map(cellOf)).size;
      const sampled = new Set(selectSpatially(all, b, 300).map(cellOf)).size;
      console.log(`  ${name.padEnd(9)} ${String(cellsAll).padStart(5)}  ${String(ranked).padStart(6)}  ${String(sampled).padStart(7)}  +${sampled-ranked}`);
      expect(sampled).toBeGreaterThanOrEqual(ranked);
      expect(sampled).toBe(cellsAll); // every occupied cell represented
    }
    console.log("");
  });

  it("returns everything when under budget", () => {
    const b = { minLat:48.80, maxLat:48.92, minLng:2.24, maxLng:2.42 };
    const few = googlePlacesInBBox(b).slice(0, 10);
    expect(selectSpatially(few, b, 300)).toHaveLength(10);
  });

  it("respects the budget exactly", () => {
    const b = { minLat:48.80, maxLat:48.92, minLng:2.24, maxLng:2.42 };
    expect(selectSpatially(googlePlacesInBBox(b), b, 300)).toHaveLength(300);
    expect(selectSpatially(googlePlacesInBBox(b), b, 50)).toHaveLength(50);
  });

  it("still picks each cell's strongest property first", () => {
    const b = { minLat:0, maxLat:8, minLng:0, maxLng:8 };
    const mk = (lat:number,lng:number,rc:number,name:string) =>
      ({ placeId:name, name, latitude:lat, longitude:lng, ratingCount:rc, rating:4,
         propertyType:"hotel", typeDisplay:null, city:null, country:null, countryCode:null,
         address:null, priceLevel:null, businessStatus:"OPERATIONAL", website:null,
         googleMapsUrl:null, summary:null, photoCount:0, enrichedAt:null }) as any;
    // Two cells, one weak property in the far cell. Budget 2 must take the best
    // of each cell, not the two best overall.
    const items = [mk(1,1,100,"strong"), mk(1,1,90,"second"), mk(7,7,5,"far-weak")];
    const out = selectSpatially(items, b, 2).map(p=>p.name);
    expect(out).toContain("strong");
    expect(out).toContain("far-weak");
    expect(out).not.toContain("second");
  });

  it("falls back to ranking on a degenerate viewport", () => {
    const flat = { minLat:5, maxLat:5, minLng:5, maxLng:5 };
    const b = { minLat:48.80, maxLat:48.92, minLng:2.24, maxLng:2.42 };
    const all = googlePlacesInBBox(b);
    expect(selectSpatially(all, flat, 10)).toHaveLength(10);
  });
});

describe("the map only pins places you can sleep in", () => {
  // The enrichment pass fetched typeDisplay for the first time, and it showed
  // 254 records that are not accommodation at all — a gym, a bar, a museum, a
  // church, a car park — every one of which was being drawn as somewhere to
  // stay. Before that field existed the dataset had no category to filter on.
  it("excludes gyms, bars and other non-accommodation from the viewport", () => {
    // Amsterdam, where Vondelgym and Ziggy's Bar both sat in the dataset.
    const box = { minLat: 52.3, maxLat: 52.42, minLng: 4.8, maxLng: 4.95 };
    const names = googlePlacesInBBox(box).map((p) => p.name.toLowerCase());
    expect(names.some((n) => n.includes("vondelgym"))).toBe(false);
    expect(names.some((n) => n.includes("ziggy's bar"))).toBe(false);
    // And the filter has not emptied the city.
    expect(googlePlacesInBBox(box).length).toBeGreaterThan(50);
  });

  it("keeps a property whose NAME says it is lodging, whatever Google typed it", () => {
    // "Baan Glang Soi Restaurant & Guesthouse" is typed Restaurant and is
    // demonstrably a guesthouse. Removing a real property is the worse error:
    // a reader can ignore a pin they can see and cannot find one that is gone.
    const world = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };
    const kept = googlePlacesInBBox(world).filter((p) =>
      /guesthouse|guest house/i.test(p.name)
    );
    expect(kept.length).toBeGreaterThan(0);
  });
});
