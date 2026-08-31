import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MASK_ESSENTIALS,
  MASK_DETAIL,
  GOOGLE_ATTRIBUTION,
  NEARBY_MAX_RESULTS,
  NEARBY_MAX_RADIUS_M,
  photoProxyUrl,
  resolvePhotoUri,
  googlePlacesConfigured,
  findHotel,
} from "../googlePlaces";

const REAL_KEY_SHAPE = "AIza-test-key-not-a-real-credential";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_API_KEY;
});

/** The exact response shape a live call returned, trimmed. Using the real shape
 *  rather than an invented one is what makes these tests worth running. */
const LIVE_SHAPE = {
  places: [
    {
      id: "ChIJGdo6XIMWrjsR27K3QpD1ZXA",
      displayName: { text: "The Oberoi, Bengaluru", languageCode: "en" },
      formattedAddress: "37-39, Mahatma Gandhi Rd, Bengaluru, Karnataka 560001, India",
      location: { latitude: 12.9736048, longitude: 77.6184025 },
      rating: 4.7,
      userRatingCount: 10052,
      types: ["hotel", "banquet_hall", "bar", "spa"],
      primaryType: "hotel",
      websiteUri: "https://www.oberoihotels.com/hotels-in-bengaluru/",
      internationalPhoneNumber: "+91 80 2558 5858",
      businessStatus: "OPERATIONAL",
      editorialSummary: { text: "Grand hotel with private balconies & 24-hour butler service." },
      photos: [
        { name: "places/ChIJGdo6XIMWrjsR27K3QpD1ZXA/photos/AbC-123_x", widthPx: 4800, heightPx: 3200,
          authorAttributions: [{ displayName: "The Oberoi" }] },
      ],
    },
  ],
};

function stubFetch(json: unknown, ok = true, status = 200) {
  const spy = vi.fn(async () => ({
    ok,
    status,
    json: async () => json,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", spy);
  return spy as unknown as ReturnType<typeof vi.fn>;
}

describe("field masks", () => {
  it("keeps the cheap mask free of the fields that escalate the billing tier", () => {
    // rating / photos / editorialSummary are what push a call to the top SKU.
    for (const pricey of ["rating", "photos", "editorialSummary", "userRatingCount"]) {
      expect(MASK_ESSENTIALS).not.toContain(pricey);
    }
    expect(MASK_ESSENTIALS).toContain("places.id");
    expect(MASK_ESSENTIALS).toContain("places.location");
  });

  it("detail mask requests every field the UI renders", () => {
    for (const f of [
      "places.rating", "places.userRatingCount", "places.photos",
      "places.editorialSummary", "places.location", "places.id",
    ]) {
      expect(MASK_DETAIL).toContain(f);
    }
  });

  it("never asks for a price field, because none exists for hotels", () => {
    expect(MASK_DETAIL).not.toContain("priceLevel");
    expect(MASK_DETAIL).not.toContain("priceRange");
  });
});

describe("configuration", () => {
  it("reports unconfigured when the key is absent", () => {
    expect(googlePlacesConfigured()).toBe(false);
  });

  it("returns null instead of calling out when unconfigured", async () => {
    const spy = stubFetch(LIVE_SHAPE);
    expect(await findHotel({ query: "Aman Tokyo" })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("parsing a live-shaped response", () => {
  it("maps every field the real API returned", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    stubFetch(LIVE_SHAPE);

    const p = await findHotel({ query: "The Oberoi Bengaluru", detail: true });
    expect(p).not.toBeNull();
    expect(p!.placeId).toBe("ChIJGdo6XIMWrjsR27K3QpD1ZXA");
    expect(p!.name).toBe("The Oberoi, Bengaluru");
    expect(p!.rating).toBe(4.7);
    expect(p!.userRatingCount).toBe(10052);
    expect(p!.latitude).toBeCloseTo(12.9736048, 6);
    expect(p!.primaryType).toBe("hotel");
    expect(p!.editorialSummary).toContain("butler service");
    expect(p!.photos).toHaveLength(1);
  });

  it("sends the key as a header, never in the URL", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    const spy = stubFetch(LIVE_SHAPE);
    await findHotel({ query: "Aman Tokyo", detail: true });

    const [url, init] = (spy as any).mock.calls[0];
    expect(String(url)).not.toContain(REAL_KEY_SHAPE);
    expect(init.headers["X-Goog-Api-Key"]).toBe(REAL_KEY_SHAPE);
    expect(init.headers["X-Goog-FieldMask"]).toBe(MASK_DETAIL);
  });

  it("never stores Places content: every request is no-store", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    const spy = stubFetch(LIVE_SHAPE);
    await findHotel({ query: "Aman Tokyo" });
    expect((spy as any).mock.calls[0][1].cache).toBe("no-store");
  });

  it("biases to a coordinate when one is supplied", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    const spy = stubFetch(LIVE_SHAPE);
    await findHotel({ query: "The Oberoi", latitude: 12.97, longitude: 77.61, radiusM: 3000 });
    const body = JSON.parse((spy as any).mock.calls[0][1].body);
    expect(body.locationBias.circle.center.latitude).toBe(12.97);
    expect(body.locationBias.circle.radius).toBe(3000);
  });

  it("clamps the bias radius to Google's documented 50km ceiling", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    const spy = stubFetch(LIVE_SHAPE);
    await findHotel({ query: "x", latitude: 1, longitude: 1, radiusM: 999_999 });
    const body = JSON.parse((spy as any).mock.calls[0][1].body);
    expect(body.locationBias.circle.radius).toBe(50_000);
  });

  it("drops a record with no id or no name rather than emitting a blank", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    stubFetch({ places: [{ id: "", displayName: { text: "x" } }] });
    expect(await findHotel({ query: "x" })).toBeNull();
  });

  it("treats Null Island as unknown, not as a real position", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    stubFetch({
      places: [{ id: "p1", displayName: { text: "Ghost Hotel" }, location: { latitude: 0, longitude: 0 } }],
    });
    const p = await findHotel({ query: "x" });
    expect(p!.latitude).toBeUndefined();
    expect(p!.longitude).toBeUndefined();
  });

  it("returns null on an upstream error instead of throwing", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    stubFetch({}, false, 403);
    expect(await findHotel({ query: "x" })).toBeNull();
  });
});

describe("photo handling", () => {
  it("proxies through our own route and never exposes the key", () => {
    const url = photoProxyUrl("places/abc/photos/xyz", 800);
    expect(url.startsWith("/api/travel/hotels/photo?")).toBe(true);
    expect(url).not.toContain("key=");
    expect(url).toContain("w=800");
  });

  it("clamps width to Google's 1-4800 range", () => {
    expect(photoProxyUrl("places/a/photos/b", 99_999)).toContain("w=4800");
    expect(photoProxyUrl("places/a/photos/b", -5)).toContain("w=1");
  });

  it("rejects a malformed photo name before it can reach a URL", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    const spy = stubFetch({ photoUri: "https://example.test/x.jpg" });
    for (const bad of [
      "../../etc/passwd",
      "places/x/photos/../../y",
      "notaplace",
      "places/a/photos/b?key=leak",
    ]) {
      expect(await resolvePhotoUri(bad)).toBeNull();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts a well-formed name", async () => {
    process.env.GOOGLE_PLACES_API_KEY = REAL_KEY_SHAPE;
    stubFetch({ photoUri: "https://lh3.googleusercontent.com/place-photos/x" });
    const uri = await resolvePhotoUri("places/ChIJGdo6XIMWrjsR27K3QpD1ZXA/photos/AbC-123_x");
    expect(uri).toContain("googleusercontent.com");
  });
});

describe("documented ceilings", () => {
  it("encodes the limits that make bulk crawling impossible", () => {
    // These are not arbitrary: Nearby Search has no pagination, so 20 is the
    // hard ceiling on what any single call can ever see.
    expect(NEARBY_MAX_RESULTS).toBe(20);
    expect(NEARBY_MAX_RADIUS_M).toBe(50_000);
  });

  it("exports the attribution string a display surface must render", () => {
    expect(GOOGLE_ATTRIBUTION).toBe("Powered by Google");
  });
});
