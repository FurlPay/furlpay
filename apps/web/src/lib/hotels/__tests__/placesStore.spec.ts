import { describe, it, expect } from "vitest";
import {
  CONTENT_TTL_DAYS,
  classifyPropertyType,
  extractAddress,
  isBookable,
  isServable,
  summarize,
  toRow,
  type AccommodationRow,
} from "../placesStore";

// These tests exist because every rule in placesStore is silent when it breaks:
// a misclassified property still renders, an expired row still has content in
// it, and a closed hotel still looks bookable. None of them throws.

describe("classification is driven by tags, never by the name", () => {
  it("prefers the specific type over the generic one it also carries", () => {
    // Real payload: FIVE Palm Jumeirah is tagged all four of these at once.
    expect(
      classifyPropertyType(["hotel", "bed_and_breakfast", "resort_hotel", "lodging"])
    ).toBe("resort");
  });

  it("does not let a hotel tag swallow the hostel it also carries", () => {
    expect(classifyPropertyType(["hostel", "hotel", "lodging"])).toBe("hostel");
  });

  it.each([
    [["resort_hotel"], "resort"],
    [["cottage"], "villa"],
    [["private_guest_room"], "villa"],
    [["farmstay"], "villa"],
    [["hostel"], "hostel"],
    [["motel"], "motel"],
    [["guest_house"], "guest_house"],
    [["bed_and_breakfast"], "guest_house"],
    [["extended_stay_hotel"], "extended_stay"],
    [["hotel"], "hotel"],
  ])("maps %j to %s", (types, expected) => {
    expect(classifyPropertyType(types)).toBe(expected);
  });

  it("falls back rather than guessing when nothing is recognised", () => {
    expect(classifyPropertyType(["point_of_interest", "establishment"])).toBe(
      "other_accommodation"
    );
    expect(classifyPropertyType([])).toBe("other_accommodation");
  });

  it("ignores the property's name entirely", () => {
    // "Villa Rotana" is a hotel. Classifying on the word "villa" would be wrong
    // and there is no code path that could do it — the name is not an input.
    expect(classifyPropertyType(["hotel"])).toBe("hotel");
  });
});

describe("address extraction", () => {
  const components = [
    { longText: "Dubai", shortText: "Dubai", types: ["locality"] },
    { longText: "Dubai", shortText: "DU", types: ["administrative_area_level_1"] },
    { longText: "United Arab Emirates", shortText: "AE", types: ["country"] },
    { longText: "00000", shortText: "00000", types: ["postal_code"] },
  ];

  it("pulls the structured parts out", () => {
    expect(extractAddress(components)).toEqual({
      city: "Dubai",
      region: "Dubai",
      country: "United Arab Emirates",
      countryCode: "AE",
      postalCode: "00000",
    });
  });

  it("falls back through postal_town then admin level 2 when there is no locality", () => {
    expect(
      extractAddress([{ longText: "Windsor", types: ["postal_town"] }]).city
    ).toBe("Windsor");
    expect(
      extractAddress([{ longText: "Fujairah", types: ["administrative_area_level_2"] }]).city
    ).toBe("Fujairah");
  });

  it("returns nulls rather than empty strings when nothing is present", () => {
    expect(extractAddress([])).toEqual({
      city: null, region: null, country: null, countryCode: null, postalCode: null,
    });
  });
});

describe("toRow rejects anything that would become a lying marker", () => {
  const good = {
    googlePlaceId: "ChIJ_-wTYzdrXz4RrrhErFCw21o",
    name: "FIVE Palm Jumeirah Hotel",
    latitude: 25.1043988,
    longitude: 55.1484354,
    googleTypes: ["hotel", "resort_hotel", "lodging"],
    countryCode: "ae",
    businessStatus: "OPERATIONAL",
  };

  it("accepts a well-formed place and normalizes it", () => {
    const r = toRow(good)!;
    expect(r.place_id).toBe(good.googlePlaceId);
    expect(r.property_type).toBe("resort");
    expect(r.country_code).toBe("AE"); // upper-cased for the column's check
  });

  it.each([
    ["no id", { googlePlaceId: "" }],
    ["an id too short to be a place ID", { googlePlaceId: "abc" }],
    ["no name", { name: "   " }],
    ["a missing coordinate", { latitude: undefined as unknown as number }],
    ["a NaN coordinate", { latitude: NaN }],
    ["an infinite coordinate", { longitude: Infinity }],
    ["latitude off the globe", { latitude: 91 }],
    ["longitude off the globe", { longitude: -181 }],
  ])("rejects %s", (_label, patch) => {
    expect(toRow({ ...good, ...patch })).toBeNull();
  });

  it("drops a country code that is not two letters instead of failing the batch", () => {
    expect(toRow({ ...good, countryCode: "UAE" })!.country_code).toBeNull();
  });

  it("stamps freshness so the row can expire", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    const r = toRow(good, now)!;
    expect(r.content_fetched_at).toBe(now.toISOString());
    const days = (Date.parse(r.content_expires_at) - now.getTime()) / 86_400_000;
    expect(days).toBe(CONTENT_TTL_DAYS);
  });

  it("has nowhere to put a rating, a photo or a phone number", () => {
    // The compliance boundary, asserted. If someone adds one of these columns,
    // this fails and they have to think about the policy first.
    const r = toRow(good)! as Record<string, unknown>;
    for (const forbidden of [
      "rating", "user_rating_count", "rating_count", "photos", "photo",
      "phone", "editorial_summary", "opening_hours", "reviews", "price_level",
    ]) {
      expect(r).not.toHaveProperty(forbidden);
    }
  });
});

describe("freshness gates what may be served", () => {
  const at = (iso: string): AccommodationRow =>
    ({ content_expires_at: iso } as AccommodationRow);
  const now = new Date("2026-09-01T00:00:00.000Z");

  it("serves a row inside its window", () => {
    expect(isServable(at("2026-09-20T00:00:00.000Z"), now)).toBe(true);
  });

  it("withholds a row past its window rather than serving it with a caveat", () => {
    expect(isServable(at("2026-08-31T23:59:59.000Z"), now)).toBe(false);
  });

  it("treats an unparseable expiry as expired", () => {
    expect(isServable(at("not-a-date"), now)).toBe(false);
    expect(isServable(at(""), now)).toBe(false);
  });
});

describe("closed properties are not inventory", () => {
  it.each([["CLOSED_PERMANENTLY"], ["CLOSED_TEMPORARILY"]])(
    "%s is not bookable",
    (s) => expect(isBookable({ business_status: s })).toBe(false)
  );

  it("OPERATIONAL is bookable", () => {
    expect(isBookable({ business_status: "OPERATIONAL" })).toBe(true);
  });

  it("a MISSING status is not treated as closed", () => {
    // Google omits the field on plenty of live properties. Treating absence as
    // closure would silently thin the map.
    expect(isBookable({ business_status: null })).toBe(true);
  });
});

describe("destination summary counts what is there", () => {
  const row = (property_type: string, business_status: string | null = "OPERATIONAL") =>
    ({ property_type, business_status } as AccommodationRow);

  it("counts by type and excludes closed properties from both totals", () => {
    const s = summarize([
      row("hotel"), row("hotel"), row("resort"),
      row("villa"), row("hostel"),
      row("hotel", "CLOSED_PERMANENTLY"),
    ]);
    expect(s.total).toBe(5);
    expect(s.byType.hotel).toBe(2);
    expect(s.byType.resort).toBe(1);
    expect(s.byType.villa).toBe(1);
  });

  it("returns zeroes rather than gaps for absent types", () => {
    const s = summarize([row("hotel")]);
    expect(s.byType.motel).toBe(0);
    expect(s.byType.extended_stay).toBe(0);
  });

  it("reports no price, because nothing in this layer holds one", () => {
    const s = summarize([row("hotel")]) as Record<string, unknown>;
    expect(s).not.toHaveProperty("averagePrice");
    expect(s).not.toHaveProperty("fromPrice");
  });
});
