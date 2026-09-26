// Overture places → lodging seed normalization.
//
// This is where a harvest bug becomes a pin in the wrong place, so the cases
// that matter are the ones that would still produce a plausible-looking row:
// reversed coordinates, a hotel restaurant, a record with no country.

import { describe, it, expect } from "vitest";
import {
  buildOvertureQuery,
  coordsOf,
  normalizeBatch,
  normalizeOvertureRecord,
  propertyTypeFor,
  type OvertureRecord,
} from "@/lib/hotels/overture";

/** A well-formed Overture places row for Marina Bay Sands. */
function record(over: Partial<OvertureRecord> = {}): OvertureRecord {
  return {
    id: "08f65b1c2a3d4e5f",
    names: { primary: "Marina Bay Sands" },
    categories: { primary: "resort", alternate: [] },
    geometry: { type: "Point", coordinates: [103.8607, 1.2834] }, // [lng, lat]
    addresses: [{ freeform: "10 Bayfront Ave", locality: "Singapore", country: "SG" }],
    websites: ["https://www.marinabaysands.com"],
    confidence: 0.94,
    ...over,
  };
}

describe("coordsOf", () => {
  it("reads GeoJSON as [longitude, latitude], not the reverse", () => {
    // THE bug this guards. Reading [0] as latitude puts Singapore's hotels at
    // lat 103.86 — out of range, or silently clamped into the Arctic depending
    // on what downstream does. Every hotel in the harvest, wrong.
    const c = coordsOf(record());
    expect(c).toEqual({ lat: 1.2834, lng: 103.8607 });
  });

  it("falls back to flattened lat/lon columns", () => {
    expect(coordsOf({ lat: 1.2834, lon: 103.8607 })).toEqual({ lat: 1.2834, lng: 103.8607 });
    expect(coordsOf({ latitude: 48.8584, longitude: 2.2945 })).toEqual({ lat: 48.8584, lng: 2.2945 });
  });

  it("returns null rather than guessing when coordinates are absent", () => {
    expect(coordsOf({})).toBeNull();
    expect(coordsOf({ geometry: { coordinates: [] } })).toBeNull();
    expect(coordsOf({ geometry: { coordinates: ["a", "b"] } })).toBeNull();
  });
});

describe("propertyTypeFor", () => {
  it("maps Overture lodging categories onto our property types", () => {
    expect(propertyTypeFor(["hotel"])).toBe("hotel");
    expect(propertyTypeFor(["resort"])).toBe("resort");
    expect(propertyTypeFor(["bed_and_breakfast"])).toBe("bed_and_breakfast");
    expect(propertyTypeFor(["vacation_rental"])).toBe("villa");
    expect(propertyTypeFor(["apartment_hotel"])).toBe("extended_stay");
  });

  it("rejects a hotel RESTAURANT even though it is categorised alongside one", () => {
    // A restaurant inside a hotel is not a place to sleep, and it is the most
    // common false positive in the places theme.
    expect(propertyTypeFor(["restaurant", "hotel"])).toBeNull();
    expect(propertyTypeFor(["hotel", "bar"])).toBeNull();
    expect(propertyTypeFor(["spa"])).toBeNull();
    expect(propertyTypeFor(["casino"])).toBeNull();
  });

  it("returns null for anything not lodging", () => {
    expect(propertyTypeFor([])).toBeNull();
    expect(propertyTypeFor(["pharmacy"])).toBeNull();
  });
});

describe("normalizeOvertureRecord", () => {
  it("normalizes a complete record", () => {
    const res = normalizeOvertureRecord(record());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.seed).toMatchObject({
      name: "Marina Bay Sands",
      latitude: 1.2834,
      longitude: 103.8607,
      propertyType: "resort",
      city: "Singapore",
      countryCode: "SG",
      address: "10 Bayfront Ave",
      website: "https://www.marinabaysands.com",
      overtureId: "08f65b1c2a3d4e5f",
      confidence: 0.94,
    });
  });

  it("gives a TYPED reason for every rejection", () => {
    const cases: Array<[Partial<OvertureRecord>, string]> = [
      [{ id: undefined }, "no_gers_id"],
      [{ names: { primary: "" } }, "no_name"],
      [{ categories: { primary: "pharmacy" } }, "not_lodging"],
      [{ categories: { primary: "restaurant" } }, "excluded_category"],
      [{ geometry: undefined, lat: undefined, lon: undefined }, "no_coordinates"],
      [{ geometry: { coordinates: [999, 999] } }, "coordinates_out_of_range"],
      [{ geometry: { coordinates: [0, 0] } }, "null_island"],
      [{ addresses: [{ freeform: "x", locality: "y" }] }, "no_country"],
    ];
    for (const [over, reason] of cases) {
      const res = normalizeOvertureRecord(record(over));
      expect(res.ok, `expected rejection for ${reason}`).toBe(false);
      if (!res.ok) expect(res.reason).toBe(reason);
    }
  });

  it("rejects a record whose country is not ISO-3166 alpha-2", () => {
    // country_code is NOT NULL with a regex CHECK in migration 0015, so a bad
    // value here would fail an entire upsert batch rather than one row.
    for (const country of ["SGP", "s", "", "12"]) {
      const res = normalizeOvertureRecord(record({ addresses: [{ country }] }));
      expect(res.ok).toBe(false);
    }
  });

  it("uppercases the country and keeps the name within the column limit", () => {
    const res = normalizeOvertureRecord(
      record({
        names: { primary: "x".repeat(400) },
        addresses: [{ country: "sg", locality: "Singapore" }],
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.seed.countryCode).toBe("SG");
    expect(res.seed.name.length).toBe(300);
  });

  it("drops a non-http website rather than rendering it as a booking link", () => {
    for (const site of ["mailto:stay@hotel.com", "tel:+6561234567", "javascript:alert(1)"]) {
      const res = normalizeOvertureRecord(record({ websites: [site] }));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.seed.website).toBeUndefined();
    }
  });

  it("accepts a lodging category that appears only in `alternate`", () => {
    const res = normalizeOvertureRecord(
      record({ categories: { primary: "lodging", alternate: ["hotel"] } })
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.seed.propertyType).toBe("hotel");
  });
});

describe("normalizeBatch", () => {
  it("counts rejections per reason instead of silently dropping them", () => {
    // A harvest that drops 40% silently looks identical to one that worked.
    const batch = [
      record(),
      record({ id: "b", categories: { primary: "restaurant" } }),
      record({ id: "c", categories: { primary: "restaurant" } }),
      record({ id: "d", geometry: { coordinates: [0, 0] } }),
      record({ id: "e", addresses: [{ locality: "nowhere" }] }),
    ];
    const out = normalizeBatch(batch);
    expect(out.accepted).toBe(1);
    expect(out.seeds).toHaveLength(1);
    expect(out.rejected.excluded_category).toBe(2);
    expect(out.rejected.null_island).toBe(1);
    expect(out.rejected.no_country).toBe(1);
  });

  it("handles an empty batch", () => {
    const out = normalizeBatch([]);
    expect(out.accepted).toBe(0);
    expect(Object.values(out.rejected).every((n) => n === 0)).toBe(true);
  });

  it("never throws on malformed input", () => {
    // Release schemas change between Overture versions; a renamed field must
    // degrade to a rejection, not take down the harvest.
    const junk = [{}, { id: 1 }, { names: "string-not-object" }, { geometry: null }] as OvertureRecord[];
    expect(() => normalizeBatch(junk)).not.toThrow();
    expect(normalizeBatch(junk).accepted).toBe(0);
  });
});

describe("buildOvertureQuery", () => {
  it("filters to lodging categories and the requested country", () => {
    const sql = buildOvertureQuery({ release: "2026-08-20.0", country: "SG", limit: 500 });
    expect(sql).toContain("categories.primary IN (");
    expect(sql).toContain("'hotel'");
    expect(sql).toContain("'resort'");
    expect(sql).toContain("upper(addresses[1].country) = 'SG'");
    expect(sql).toContain("limit 500;");
    expect(sql).toContain("s3://overturemaps-us-west-2/release/2026-08-20.0/theme=places");
  });

  it("filters by bounding box when given one", () => {
    const sql = buildOvertureQuery({
      release: "2026-08-20.0",
      bbox: { minLng: 103.6, minLat: 1.2, maxLng: 104.0, maxLat: 1.5 },
      limit: 10,
    });
    expect(sql).toContain("bbox.xmin BETWEEN 103.6 AND 104");
    expect(sql).toContain("bbox.ymin BETWEEN 1.2 AND 1.5");
  });

  it("requests geometry as GeoJSON so coordsOf can read it", () => {
    const sql = buildOvertureQuery({ release: "2026-08-20.0", limit: 1 });
    expect(sql).toContain("ST_AsGeoJSON(geometry)");
  });
});
