import { describe, it, expect } from "vitest";
import type { GooglePlace } from "@/lib/hotels/googlePlaces";
import type { MapPoint } from "@/app/api/travel/hotels/map/route";
import {
  isValidViewport,
  viewportSpan,
  dedupeByPlaceId,
  MAX_DISCOVERY_SPAN,
  MASK_DISCOVERY,
} from "@/lib/places/viewportDiscovery";
import { toMapPoint, toMapPoints, mergeLivePoints, hotelTypeFromGoogle } from "@/lib/places/liveAugment";
import { COLLECTION_RULES, matchesCollections, ruleFor } from "@/lib/places/collections";
import { liveStatusLabel } from "@/lib/places/discoverClient";

// ---------------------------------------------------------------------------
// The live Google Places layer that augments /hotels/map.
//
// These are the invariants that, if they break, produce a map that LOOKS
// right and is wrong: a duplicated hotel, a fabricated star rating, a
// "Michelin" badge derived from guest reviews, or a snapshot quietly
// relabelled as live.
// ---------------------------------------------------------------------------

const place = (over: Partial<GooglePlace> = {}): GooglePlace => ({
  placeId: "ChIJtest",
  name: "Test Hotel",
  latitude: 25.2,
  longitude: 55.27,
  types: ["hotel"],
  photos: [],
  ...over,
});

const point = (over: Partial<MapPoint> = {}): MapPoint =>
  ({
    id: "curated:1",
    kind: "property",
    source: "curated",
    latitude: 25.2,
    longitude: 55.27,
    name: "Test Hotel",
    city: "Dubai",
    country: "AE",
    hotelType: "hotel",
    ...over,
  }) as MapPoint;

/* ------------------------------ field mask -------------------------------- */

describe("field mask", () => {
  it("never requests a wildcard — the mask decides the billing SKU", () => {
    expect(MASK_DISCOVERY).not.toContain("*");
  });

  it("requests the fields a marker and card actually render", () => {
    for (const f of ["places.id", "places.displayName", "places.location", "places.rating"]) {
      expect(MASK_DISCOVERY).toContain(f);
    }
  });

  it("does not request fields nothing draws", () => {
    // Reviews and opening hours are expensive SKU fields the map never shows.
    expect(MASK_DISCOVERY).not.toContain("places.reviews");
    expect(MASK_DISCOVERY).not.toContain("places.regularOpeningHours");
  });
});

/* ------------------------------- viewport --------------------------------- */

describe("viewport validation", () => {
  const ok = { north: 25.3, south: 25.1, east: 55.4, west: 55.1 };

  it("accepts a well-formed viewport", () => {
    expect(isValidViewport(ok)).toBe(true);
  });

  it("rejects inverted latitudes", () => {
    expect(isValidViewport({ ...ok, north: 25.0, south: 25.2 })).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isValidViewport({ ...ok, north: Number.NaN })).toBe(false);
    expect(isValidViewport({ ...ok, west: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("rejects out-of-range coordinates", () => {
    expect(isValidViewport({ ...ok, north: 91 })).toBe(false);
    expect(isValidViewport({ ...ok, west: -181 })).toBe(false);
  });

  it("measures span so a continental view can be refused", () => {
    expect(viewportSpan(ok)).toBeLessThan(MAX_DISCOVERY_SPAN);
    // A whole-hemisphere rectangle must exceed the cap — otherwise a user at
    // zoom 2 triggers a Places query whose 20 results are arbitrary.
    expect(viewportSpan({ north: 60, south: -60, east: 100, west: -100 })).toBeGreaterThan(MAX_DISCOVERY_SPAN);
  });

  it("handles the antimeridian without reporting a tiny span", () => {
    // west 170 -> east -170 is 20 degrees across the dateline, not -340.
    expect(viewportSpan({ north: 10, south: 0, east: -170, west: 170 })).toBeCloseTo(200, 0);
  });
});

/* ------------------------------ normalisation ----------------------------- */

describe("Google place -> map point", () => {
  it("keeps the place id as the identity", () => {
    const p = toMapPoint(place({ placeId: "ChIJabc" }));
    expect(p?.placeId).toBe("ChIJabc");
    expect(p?.id).toBe("google-live:ChIJabc");
  });

  it("labels the source google-live, distinct from the snapshot", () => {
    expect(toMapPoint(place())?.source).toBe("google-live");
  });

  it("NEVER sets stars from a Google rating", () => {
    // The one that matters: `stars` is an official classification and
    // `rating` is what guests thought. Blending them fabricates a star class.
    const p = toMapPoint(place({ rating: 5 }));
    expect(p?.rating).toBe(5);
    expect(p?.stars).toBeUndefined();
  });

  it("omits a rating Google did not supply rather than defaulting to zero", () => {
    const p = toMapPoint(place({ rating: undefined, userRatingCount: undefined }));
    expect(p?.rating).toBeUndefined();
    expect(p?.ratingCount).toBeUndefined();
  });

  it("drops a place with no coordinates instead of inventing one", () => {
    expect(toMapPoint(place({ latitude: undefined }))).toBeNull();
    expect(toMapPoint(place({ longitude: undefined }))).toBeNull();
  });

  it("drops a malformed place with no id or name", () => {
    expect(toMapPoint(place({ placeId: "" }))).toBeNull();
    expect(toMapPoint(place({ name: "" }))).toBeNull();
  });

  it("survives a malformed Google response without throwing", () => {
    expect(toMapPoints([])).toEqual([]);
    // Types missing entirely — the API contract says it is optional.
    expect(toMapPoints([place({ types: undefined as never })]).length).toBe(1);
  });

  it("NEVER claims a confirmed position", () => {
    // `precision: "exact"` means the curated resolver confirmed the building
    // against Google under its own gates. A Text Search hit has had no such
    // check, so claiming it would be a fabricated confidence — and the
    // "Confirmed positions only" filter would then hide the wrong pins.
    const p = toMapPoint(place({ rating: 5, userRatingCount: 50000 }));
    expect(p?.precision).toBeUndefined();
  });

  it("maps Google types to the map's own vocabulary", () => {
    expect(hotelTypeFromGoogle(place({ types: ["resort_hotel"] }))).toBe("resort");
    expect(hotelTypeFromGoogle(place({ types: ["motel"] }))).toBe("motel");
    expect(hotelTypeFromGoogle(place({ types: ["bed_and_breakfast"] }))).toBe("guest_house");
    expect(hotelTypeFromGoogle(place({ types: ["hotel"] }))).toBe("hotel");
  });
});

/* -------------------------------- dedupe ---------------------------------- */

describe("deduplication", () => {
  it("collapses repeated place ids from overlapping viewports", () => {
    const out = dedupeByPlaceId([place({ placeId: "A" }), place({ placeId: "A" }), place({ placeId: "B" })]);
    expect(out.map((p) => p.placeId)).toEqual(["A", "B"]);
  });

  it("does not duplicate a hotel the indexed sources already have (same place id)", () => {
    const existing = [point({ placeId: "ChIJsame", source: "curated" })];
    const live = toMapPoints([place({ placeId: "ChIJsame" })]);
    const { points, added, deduped } = mergeLivePoints(existing, live);
    expect(added).toBe(0);
    expect(deduped).toBe(1);
    expect(points).toHaveLength(1);
    // The curated record survives — it carries FurlPay's own metadata.
    expect(points[0].source).toBe("curated");
  });

  it("does not duplicate when the same name sits on the same spot without a place id", () => {
    const existing = [point({ name: "Burj Al Arab", placeId: undefined, latitude: 25.141, longitude: 55.185 })];
    const live = toMapPoints([
      place({ placeId: "ChIJburj", name: "Burj Al Arab", latitude: 25.1411, longitude: 55.1851 }),
    ]);
    expect(mergeLivePoints(existing, live).added).toBe(0);
  });

  it("keeps two same-named hotels that are genuinely far apart", () => {
    const existing = [point({ name: "Hilton", placeId: undefined, latitude: 25.2, longitude: 55.27 })];
    const live = toMapPoints([place({ placeId: "ChIJfar", name: "Hilton", latitude: 25.9, longitude: 55.9 })]);
    expect(mergeLivePoints(existing, live).added).toBe(1);
  });

  it("adds a genuinely new place", () => {
    const { points, added } = mergeLivePoints([point()], toMapPoints([place({ placeId: "ChIJnew", name: "New Hotel", latitude: 26, longitude: 56 })]));
    expect(added).toBe(1);
    expect(points).toHaveLength(2);
  });

  it("never reorders or removes existing points", () => {
    const existing = [point({ id: "a", name: "A" }), point({ id: "b", name: "B", latitude: 30, longitude: 60 })];
    const { points } = mergeLivePoints(existing, toMapPoints([place({ placeId: "ChIJz", name: "Z", latitude: 40, longitude: 70 })]));
    expect(points.slice(0, 2).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

/* ------------------------------ collections ------------------------------- */

describe("collection rules", () => {
  it("exposes all ten collections", () => {
    expect(COLLECTION_RULES).toHaveLength(10);
  });

  it("every collection declares its basis", () => {
    for (const r of COLLECTION_RULES) {
      expect(["observed", "editorial", "furlpay"]).toContain(r.basis);
    }
  });

  it("Michelin is UNAVAILABLE without a Michelin source — a Google rating is not one", () => {
    const rule = ruleFor("michelin_dining")!;
    expect(rule.evaluate(place({ rating: 4.9, userRatingCount: 9000, types: ["restaurant"] }), {})).toBe("unavailable");
  });

  it("Michelin answers only once a real source has resolved it", () => {
    const rule = ruleFor("michelin_dining")!;
    const p = place({ types: ["restaurant"] });
    expect(rule.evaluate(p, { michelinResolved: true, michelinStarred: true })).toBe("in");
    expect(rule.evaluate(p, { michelinResolved: true, michelinStarred: false })).toBe("out");
  });

  it("Pay with USDC is UNAVAILABLE until FurlPay has verified it", () => {
    const rule = ruleFor("crypto_escrow")!;
    expect(rule.evaluate(place(), {})).toBe("unavailable");
    expect(rule.basis).toBe("furlpay");
  });

  it("Google data can never make acceptsUsdc true", () => {
    const rule = ruleFor("crypto_escrow")!;
    // Every Google signal at maximum: still unavailable.
    const p = place({ rating: 5, userRatingCount: 99999, websiteUri: "https://x.test" });
    expect(rule.evaluate(p, {})).toBe("unavailable");
  });

  it("an unevaluable collection EXCLUDES rather than passing everything through", () => {
    // A "Michelin" filter that cannot be evaluated must not silently return an
    // unfiltered list labelled Michelin.
    expect(matchesCollections(place({ types: ["restaurant"] }), ["michelin_dining"], {})).toBe(false);
  });

  it("no collection selected matches everything", () => {
    expect(matchesCollections(place(), [], {})).toBe(true);
  });

  it("ultra luxury needs a substantial sample, not one glowing review", () => {
    const rule = ruleFor("ultra_luxury")!;
    expect(rule.evaluate(place({ rating: 5, userRatingCount: 3 }), {})).toBe("out");
    expect(rule.evaluate(place({ rating: 4.8, userRatingCount: 1200 }), {})).toBe("in");
  });
});

/* ------------------------------ status text ------------------------------- */

describe("live status reporting", () => {
  it("says nothing when the layer is healthy", () => {
    expect(liveStatusLabel("live")).toBeNull();
    expect(liveStatusLabel("empty")).toBeNull();
    expect(liveStatusLabel("idle")).toBeNull();
  });

  it("reports an unavailable layer without leaking internals", () => {
    for (const s of ["unavailable", "degraded", "zoom-in"] as const) {
      const label = liveStatusLabel(s)!;
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/AIza|project|\d{9,}|api key/i);
    }
  });
});
