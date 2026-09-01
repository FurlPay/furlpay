import { describe, it, expect } from "vitest";
import { googlePlacesInBBox, prominence, selectSpatially } from "../googlePlacesLayer";

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
