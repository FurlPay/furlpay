import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  boundsAround,
  getLocation,
  searchLocations,
  searchNearby,
  terraConfigured,
} from "../client";
import {
  dedupe,
  matchesName,
  normalizeLocation,
  normalizeUrl,
  toRatingInput,
  toVerificationEvidence,
} from "../normalize";
import { scoreConfidence } from "@/lib/property/confidence";
import { rankStays } from "@/lib/travel/ranking";
import type { TerraLocation } from "../types";

// ---------------------------------------------------------------------------
// Tripadvisor Terra integration.
//
// The properties worth testing here are the ones where the API's real
// behaviour differs from what its shape suggests, plus the two that would be
// genuinely damaging to get wrong: leaking the credential, and letting a
// third-party listing masquerade as registry-grade proof.
// ---------------------------------------------------------------------------

const ORIGINAL_KEY = process.env.TRIPADVISOR_API_KEY;

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.TRIPADVISOR_API_KEY;
  else process.env.TRIPADVISOR_API_KEY = ORIGINAL_KEY;
});

describe("credential handling", () => {
  it("fails closed with NO network call when the key is absent", async () => {
    delete process.env.TRIPADVISOR_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const r = await searchLocations("Tokyo");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe("not_configured");
    // The point of failing closed: an unauthenticated request never leaves.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports Terra as unconfigured so callers can skip the work", () => {
    delete process.env.TRIPADVISOR_API_KEY;
    expect(terraConfigured()).toBe(false);
    process.env.TRIPADVISOR_API_KEY = "test-key";
    expect(terraConfigured()).toBe(true);
  });

  it("sends the key ONLY as X-API-Key — never in the URL", async () => {
    // Measured: ?key=, ?api_key= and Bearer all 401. A key in the query string
    // would also land in access logs and Referer headers.
    process.env.TRIPADVISOR_API_KEY = "secret-value";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [], pagination: {} }), { status: 200 })
    );

    await searchLocations("Tokyo");

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("secret-value");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("secret-value");
  });

  it("never puts the credential in a failure detail", async () => {
    process.env.TRIPADVISOR_API_KEY = "secret-value";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      // Terra echoes the request in some errors; the request carries the key.
      new Response("upstream said secret-value was rejected", { status: 401 })
    );

    const r = await searchLocations("Tokyo");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r)).not.toContain("secret-value");
  });

  it("does not retry a rejected credential", async () => {
    // Retrying a bad key burns quota against a wall.
    process.env.TRIPADVISOR_API_KEY = "bad";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("nope", { status: 401 }));

    await searchLocations("Tokyo");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("endpoint shapes that differ from the docs", () => {
  beforeEach(() => {
    process.env.TRIPADVISOR_API_KEY = "test-key";
  });

  it("NEVER sends a radius param — Terra 400s on it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [], pagination: {} }), { status: 200 })
    );

    await searchNearby({ swLat: 35.65, swLon: 139.73, neLat: 35.71, neLon: 139.8 });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).not.toContain("radius");
    expect(url).toContain("sw_lat=35.65");
    expect(url).toContain("ne_lon=139.8");
  });

  it("NEVER sends location_type — Terra accepts and silently ignores it", async () => {
    // Measured: filtered and unfiltered responses were byte-identical, same
    // total_elements and same result ids. Sending it would imply a filter that
    // does nothing.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [], pagination: {} }), { status: 200 })
    );

    await searchLocations("Tokyo");
    expect(fetchSpy.mock.calls[0][0] as string).not.toContain("location_type");
  });

  it("rejects an inverted bounding box before spending a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await searchNearby({ swLat: 40, swLon: 10, neLat: 30, neLon: 20 });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("converts a radius to a box, widening longitude with latitude", () => {
    // Longitude degrees shrink toward the poles; a fixed degree box is correct
    // only at the equator.
    const equator = boundsAround(0, 0, 50);
    const arctic = boundsAround(70, 0, 50);
    const eqWidth = equator.neLon - equator.swLon;
    const arcticWidth = arctic.neLon - arctic.swLon;
    expect(arcticWidth).toBeGreaterThan(eqWidth);
    // Latitude spans stay equal — only longitude is distorted by projection.
    expect(equator.neLat - equator.swLat).toBeCloseTo(arctic.neLat - arctic.swLat, 6);
  });

  it("does not divide by zero at the pole", () => {
    const b = boundsAround(90, 0, 50);
    expect(Number.isFinite(b.swLon)).toBe(true);
    expect(Number.isFinite(b.neLon)).toBe(true);
  });

  it("rejects a non-integer location id without a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await getLocation(-1)).ok).toBe(false);
    expect((await getLocation(1.5)).ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

/** A real Terra row, trimmed. Field coverage matches what the API returns. */
function terraRow(over: Partial<TerraLocation> = {}): TerraLocation {
  return {
    id: 301911,
    geo_id: 14129528,
    geo: "Marunouchi",
    names: [
      { language: "en", value: "Four Seasons Hotel Tokyo At Marunouchi", primary: true },
      { language: "en", value: "four seasons chiyoda", primary: false },
      { language: "en", value: "4 seasons hotel tokyo at marunouchi", primary: false },
    ],
    descriptions: [{ language: "en", value: "Located just steps from Tokyo Station." }],
    addresses: [
      {
        street_address: "1-11-1 Pacific Century Place, Marunouchi",
        city: "Marunouchi",
        state: "Tokyo Prefecture",
        country_name: "Japan",
        country_code: "JP",
        postal_code: "100-6277",
        formatted: "1-11-1 Marunouchi, Tokyo 100-6277, Japan",
      },
    ],
    coordinates: { latitude: 35.6812, longitude: 139.7671 },
    overall_rating: { rating: 5, count: 3 },
    urls: {
      // An OBJECT, mirroring the live API. A string here is what the first
      // version of these types assumed, and a live call threw on it.
      tripadvisor: {
        main: "https://www.tripadvisor.com/Hotel_Review-g14129528-d301911-Reviews.html",
        photos: "https://www.tripadvisor.com/Hotel_Review-g14129528-d301911-Reviews.html#/media/",
      },
      official: "https://www.fourseasons.com/tokyo/",
    },
    ...over,
  };
}

describe("normalisation", () => {
  it("keeps the official URL and the Tripadvisor URL as separate fields", () => {
    // Collapsing them would send users to a listing page believing it was the
    // property's own site.
    const n = normalizeLocation(terraRow());
    expect(n.officialUrl).toBe("https://www.fourseasons.com/tokyo");
    expect(n.tripadvisorUrl).toContain("tripadvisor.com");
    expect(n.officialUrl).not.toBe(n.tripadvisorUrl);
  });

  it("survives every field Terra measurably omits", () => {
    // Real coverage: official 75%, coordinates 95%, descriptions 30%.
    const n = normalizeLocation({ id: 42 });
    expect(n.externalId).toBe("42");
    expect(n.officialUrl).toBeNull();
    expect(n.latitude).toBeNull();
    expect(n.description).toBeNull();
    expect(n.rating).toBeNull();
    expect(n.canonicalName).toContain("42");
  });

  it("refuses an OTA as an official site, whoever asserted it", () => {
    const n = normalizeLocation(
      terraRow({ urls: { official: "https://www.booking.com/hotel/jp/x.html" } })
    );
    expect(n.officialUrl).toBeNull();
  });

  it("returns null for an unparseable URL rather than storing a guess", () => {
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
  });

  it("separates the canonical name from aliases without losing either", () => {
    const n = normalizeLocation(terraRow());
    expect(n.canonicalName).toBe("Four Seasons Hotel Tokyo At Marunouchi");
    expect(n.aliases).toContain("four seasons chiyoda");
    expect(n.aliases).not.toContain(n.canonicalName);
  });

  it("resolves an alias to the canonical location", () => {
    // Terra supplies this exact alias; a canonical-only match would miss it.
    const n = normalizeLocation(terraRow());
    expect(matchesName(n, "four seasons chiyoda")).toBe(true);
    expect(matchesName(n, "4 seasons")).toBe(true);
    expect(matchesName(n, "Hilton")).toBe(false);
  });

  it("uppercases the country code that routes the registry lookup", () => {
    const n = normalizeLocation(terraRow());
    expect(n.countryCode).toBe("JP");
  });

  it("de-duplicates on (source, externalId)", () => {
    const a = normalizeLocation(terraRow());
    const b = normalizeLocation(terraRow({ overall_rating: { rating: 4, count: 900 } }));
    const out = dedupe([a, b]);
    expect(out).toHaveLength(1);
    // Later wins — it is the fresher fetch.
    expect(out[0].reviewCount).toBe(900);
  });
});

describe("verification evidence", () => {
  it("emits nothing when Terra named no official site", () => {
    // No URL means no evidence — not weak evidence, and not an inferred domain.
    const n = normalizeLocation(terraRow({ urls: { tripadvisor: { main: "https://t.com/x" } } }));
    expect(toVerificationEvidence(n)).toHaveLength(0);
  });

  it("emits one corroborating record when it did", () => {
    const ev = toVerificationEvidence(normalizeLocation(terraRow()));
    expect(ev).toHaveLength(1);
    expect(ev[0].source).toBe("Tripadvisor");
    expect(ev[0].supports).toBe(true);
    expect(ev[0].detail).toMatch(/corroboration, not proof/i);
  });

  it("CANNOT reach VERIFIED on a Tripadvisor assertion alone", () => {
    // The load-bearing test. VERIFIED is a structural claim about registry
    // evidence; a third-party listing must never be the thing that satisfies
    // it, however confident the listing looks.
    const ev = toVerificationEvidence(normalizeLocation(terraRow()));
    const scored = scoreConfidence(ev, []);
    expect(scored.status).not.toBe("VERIFIED");
  });

  it("still cannot reach VERIFIED alongside other corroboration", () => {
    const ev = toVerificationEvidence(normalizeLocation(terraRow()));
    const scored = scoreConfidence(
      [
        ...ev,
        { kind: "name_match_on_site", supports: true, source: "site", sourceUrl: null, retrievedAt: "", detail: "" },
        { kind: "address_match_on_site", supports: true, source: "site", sourceUrl: null, retrievedAt: "", detail: "" },
        { kind: "tls_valid", supports: true, source: "site", sourceUrl: null, retrievedAt: "", detail: "" },
        { kind: "structured_data", supports: true, source: "site", sourceUrl: null, retrievedAt: "", detail: "" },
      ],
      []
    );
    expect(scored.status).not.toBe("VERIFIED");
  });
});

describe("ranking input", () => {
  it("carries rating AND review count, never one alone", () => {
    expect(toRatingInput(normalizeLocation(terraRow()))).toEqual({ rating: 5, reviews: 3 });
  });

  it("returns null when the count is missing", () => {
    // A rating with no count cannot be shrunk. Treating it as one review would
    // penalise a property for a gap in Terra's data.
    const n = normalizeLocation(terraRow({ overall_rating: { rating: 5 } }));
    expect(toRatingInput(n)).toBeNull();
  });

  it("feeds the shrinkage so 5.0-from-3 does not beat 4.6-from-3000", () => {
    // These are the real numbers Terra returned for Tokyo: Four Seasons showed
    // 5.0 from 3 reviews next to a tour with 5.0 from 100. A raw sort treats
    // them as equal.
    const mk = (id: string, rating: number, reviews: number) => ({
      id, name: `Hotel ${id}`, brand: "x", city: "Tokyo", country: "Japan",
      type: "Hotel" as const, stars: 4, rating, reviews, nightlyUsd: 150,
      image: "grad-1", amenities: [], roomsLeft: 3, freeCancellation: true, eco: false,
    });
    const thin = mk("thin", 5.0, 3);
    const proven = mk("proven", 4.6, 3000);
    const filler = Array.from({ length: 8 }, (_, i) => mk(`f${i}`, 4.2, 400));

    const order = rankStays([thin, proven, ...filler]).map((r) => r.stay.id);
    expect(order.indexOf("proven")).toBeLessThan(order.indexOf("thin"));
  });
});
