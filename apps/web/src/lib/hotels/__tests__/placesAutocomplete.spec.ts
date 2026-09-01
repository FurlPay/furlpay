import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  autocompletePlaces,
  autocompleteConfigured,
  isLodging,
  resolvePlace,
} from "../placesAutocomplete";

// The contract under test is mostly about what this module REFUSES to do:
// bill for a one-character query, trust a coordinate it was handed, leak the
// API key, or cache Places content. Each of those is a test rather than a
// comment, because every one of them is silent when it regresses.

const KEY = "AIza-test-key-not-a-real-credential";

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.GOOGLE_PLACES_API_KEY;
});

describe("configuration", () => {
  it("reports unconfigured when the key is absent", () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(autocompleteConfigured()).toBe(false);
  });

  it("returns null rather than calling out when unconfigured", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const fetchMock = mockFetch({});
    expect(await autocompletePlaces({ input: "dubai", sessionToken: "s-1" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cost control", () => {
  it("does not call Google for a query shorter than two characters", async () => {
    const fetchMock = mockFetch({ suggestions: [] });
    expect(await autocompletePlaces({ input: "d", sessionToken: "s-1" })).toEqual([]);
    expect(await autocompletePlaces({ input: "  ", sessionToken: "s-1" })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the session token, which is what makes a run bill once", async () => {
    const fetchMock = mockFetch({ suggestions: [] });
    await autocompletePlaces({ input: "dubai", sessionToken: "sess-abc" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sessionToken).toBe("sess-abc");
  });

  it("passes the same token through to resolution, closing the session", async () => {
    const fetchMock = mockFetch({
      id: "p1",
      location: { latitude: 25.1, longitude: 55.2 },
    });
    await resolvePlace({ placeId: "p1", sessionToken: "sess-abc" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("sessionToken=sess-abc");
  });

  it("asks only for Essentials-tier fields when resolving a position", async () => {
    const fetchMock = mockFetch({ id: "p1", location: { latitude: 1, longitude: 2 } });
    await resolvePlace({ placeId: "p1", sessionToken: "s" });
    const mask = fetchMock.mock.calls[0][1].headers["X-Goog-FieldMask"];
    // Asking for a rating here would move the whole session to a dearer SKU
    // for a number nothing renders.
    expect(mask).not.toMatch(/rating|userRatingCount|photos|review/);
    expect(mask).toContain("location");
  });
});

describe("compliance", () => {
  it("never caches Places content", async () => {
    const fetchMock = mockFetch({ suggestions: [] });
    await autocompletePlaces({ input: "dubai", sessionToken: "s" });
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("sends the key as a header, never in the URL", async () => {
    const fetchMock = mockFetch({ suggestions: [] });
    await autocompletePlaces({ input: "dubai", sessionToken: "s" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain(KEY);
    expect(init.headers["X-Goog-Api-Key"]).toBe(KEY);
  });
});

describe("biasing", () => {
  it("biases toward the map's position without restricting to it", async () => {
    const fetchMock = mockFetch({ suggestions: [] });
    await autocompletePlaces({
      input: "springfield",
      sessionToken: "s",
      near: { latitude: 25, longitude: 55 },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.locationBias).toBeDefined();
    // Restricting would stop someone in Kerala searching for Kyoto, which is
    // the whole failure this module exists to remove.
    expect(body.locationRestriction).toBeUndefined();
  });

  it("omits the bias entirely when the map has no position", async () => {
    const fetchMock = mockFetch({ suggestions: [] });
    await autocompletePlaces({ input: "kyoto", sessionToken: "s" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.locationBias).toBeUndefined();
  });
});

describe("parsing", () => {
  it("splits a prediction into the two lines the dropdown renders", async () => {
    mockFetch({
      suggestions: [
        {
          placePrediction: {
            placeId: "abc",
            text: { text: "Jumeirah Burj Al Arab, Dubai" },
            structuredFormat: {
              mainText: { text: "Jumeirah Burj Al Arab" },
              secondaryText: { text: "Dubai, United Arab Emirates" },
            },
            types: ["lodging", "hotel"],
          },
        },
      ],
    });
    const out = await autocompletePlaces({ input: "burj", sessionToken: "s" });
    expect(out).toEqual([
      {
        placeId: "abc",
        label: "Jumeirah Burj Al Arab",
        sublabel: "Dubai, United Arab Emirates",
        types: ["lodging", "hotel"],
      },
    ]);
  });

  it("drops a prediction with no place ID, which could never be resolved", async () => {
    mockFetch({
      suggestions: [
        { placePrediction: { text: { text: "Nowhere" }, types: [] } },
        { placePrediction: { placeId: "ok", text: { text: "Somewhere" }, types: [] } },
      ],
    });
    const out = await autocompletePlaces({ input: "where", sessionToken: "s" });
    expect(out).toHaveLength(1);
    expect(out![0].placeId).toBe("ok");
  });

  it("returns null on an upstream failure, distinct from an empty result", async () => {
    mockFetch({}, false, 429);
    expect(await autocompletePlaces({ input: "dubai", sessionToken: "s" })).toBeNull();
  });
});

describe("resolution guards a coordinate before the camera sees it", () => {
  it("accepts a valid position and its bounds", async () => {
    mockFetch({
      id: "p1",
      displayName: { text: "Paris" },
      location: { latitude: 48.8566, longitude: 2.3522 },
      viewport: {
        low: { latitude: 48.8, longitude: 2.2 },
        high: { latitude: 48.9, longitude: 2.4 },
      },
    });
    const p = await resolvePlace({ placeId: "p1", sessionToken: "s" });
    expect(p).toMatchObject({ name: "Paris", latitude: 48.8566 });
    expect(p!.bounds).toEqual({ minLat: 48.8, minLng: 2.2, maxLat: 48.9, maxLng: 2.4 });
  });

  it.each([
    ["missing", {}],
    ["non-numeric", { latitude: "x", longitude: 2 }],
    ["out of range", { latitude: 120, longitude: 2 }],
  ])("rejects a %s coordinate rather than flying the map to Null Island", async (_l, location) => {
    mockFetch({ id: "p1", location });
    expect(await resolvePlace({ placeId: "p1", sessionToken: "s" })).toBeNull();
  });

  it("drops an inverted viewport instead of passing it on", async () => {
    mockFetch({
      id: "p1",
      location: { latitude: 1, longitude: 2 },
      viewport: { low: { latitude: 9, longitude: 9 }, high: { latitude: 1, longitude: 1 } },
    });
    const p = await resolvePlace({ placeId: "p1", sessionToken: "s" });
    expect(p!.bounds).toBeUndefined();
  });
});

describe("lodging classification", () => {
  it.each([["lodging"], ["hotel"], ["resort_hotel"], ["guest_house"], ["hostel"]])(
    "treats %s as somewhere to stay",
    (t) => expect(isLodging([t])).toBe(true)
  );

  it.each([["locality"], ["country"], ["restaurant"], ["airport"]])(
    "treats %s as somewhere to go",
    (t) => expect(isLodging([t])).toBe(false)
  );

  it("classifies on any matching type, not just the first", () => {
    expect(isLodging(["point_of_interest", "establishment", "resort_hotel"])).toBe(true);
  });
});
