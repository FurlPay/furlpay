import { describe, expect, it } from "vitest";
import { curatedInBBox } from "../curated";

// ---------------------------------------------------------------------------
// Viewport parsing, as a behaviour rather than an implementation.
//
// parseBbox lives inside the route module, which pulls in NextRequest and the
// rate limiter, so these exercise the SHAPES it has to survive through the
// query layer it feeds. The route-level contract each one encodes is named in
// the test, so a future refactor knows what it may not break.
// ---------------------------------------------------------------------------

describe("viewport shapes the map actually produces", () => {
  it("answers a whole-world box, which is what a dateline viewport folds to", () => {
    // A map centred on Fiji reports west=+177, east=-179 — the viewport crosses
    // 180 and the western number is LARGER. The route widens that to the world
    // rather than rejecting it; before the fix it answered 400, which the client
    // rendered as "Could not reach the hotel service" over most of the Pacific.
    const world = curatedInBBox({ minLat: -19, minLng: -180, maxLat: -16, maxLng: 180 });
    expect(world.length).toBeGreaterThan(0);
  });

  it("returns Pacific properties for a band that spans the dateline", () => {
    const band = curatedInBBox({ minLat: -45, minLng: -180, maxLat: 0, maxLng: 180 });
    // Fiji, French Polynesia, New Zealand and Australia all sit in this band.
    expect(band.length).toBeGreaterThan(10);
  });

  it("treats a degenerate box as empty rather than as everything", () => {
    // A zero-area viewport must not fall through to "no constraint".
    expect(curatedInBBox({ minLat: 10, minLng: 10, maxLat: 10, maxLng: 10 })).toEqual([]);
  });
});
