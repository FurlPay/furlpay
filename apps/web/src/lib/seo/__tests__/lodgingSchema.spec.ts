import { describe, it, expect } from "vitest";
import { lodgingBusiness, touristDestination } from "../schema";

// Structured data is a machine-readable assertion to a search engine about a
// real business. A guessed value here is worse than anywhere else in the
// product: it is a false statement, at scale, in a format built to be trusted
// and hard for a person to notice. These tests are almost entirely about what
// the builders REFUSE to emit.

const REAL = {
  name: "Rove Downtown",
  url: "https://furlpay.com/hotels/dubai",
  latitude: 25.1899,
  longitude: 55.2721,
};

describe("a rating is only emitted with a real review count", () => {
  it("emits aggregateRating when both are present", () => {
    const s = lodgingBusiness({ ...REAL, rating: 4.9, reviewCount: 27190 }) as Record<string, {
      ratingValue: number;
      reviewCount: number;
    }>;
    expect(s.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.9,
      reviewCount: 27190,
    });
  });

  it("omits it entirely when the review count is missing", () => {
    // Schema.org requires reviewCount or ratingCount on AggregateRating, and
    // Google treats a rating without one as invalid — so inventing a count
    // would be both a lie and a markup error.
    expect(lodgingBusiness({ ...REAL, rating: 4.9 })).not.toHaveProperty("aggregateRating");
    expect(lodgingBusiness({ ...REAL, rating: 4.9, reviewCount: null })).not.toHaveProperty(
      "aggregateRating"
    );
  });

  it("omits it when the count is zero rather than claiming a 0-review average", () => {
    expect(
      lodgingBusiness({ ...REAL, rating: 4.9, reviewCount: 0 })
    ).not.toHaveProperty("aggregateRating");
  });

  it("omits it when there is a count but no rating", () => {
    expect(lodgingBusiness({ ...REAL, reviewCount: 500 })).not.toHaveProperty("aggregateRating");
  });
});

describe("absent fields stay absent", () => {
  it("emits only what it was given", () => {
    // 80% of the dataset has a rating, 59% a website, 33% a summary. A builder
    // that filled the gaps would be inventing on two thirds of properties.
    const s = lodgingBusiness(REAL);
    expect(Object.keys(s).sort()).toEqual(["@context", "@type", "geo", "name", "url"]);
  });

  it("never emits priceRange", () => {
    // Google's priceLevel is populated on 29 of 16,014 records and is a 1-4
    // bucket, not a currency range. Mapping it to "$$" would be a guess in the
    // shape of a fact.
    const full = lodgingBusiness({
      ...REAL,
      rating: 4.7,
      reviewCount: 100,
      address: "Downtown",
      city: "Dubai",
      country: "United Arab Emirates",
      description: "A hotel",
      starRating: 5,
    });
    expect(full).not.toHaveProperty("priceRange");
  });

  it("builds an address from whichever parts exist", () => {
    const s = lodgingBusiness({ ...REAL, city: "Dubai" }) as Record<string, object>;
    expect(s.address).toEqual({ "@type": "PostalAddress", addressLocality: "Dubai" });
  });

  it("omits address entirely when no part is known", () => {
    expect(lodgingBusiness(REAL)).not.toHaveProperty("address");
  });
});

describe("coordinates are required, because a lodging with no place is not one", () => {
  it("always emits geo", () => {
    const s = lodgingBusiness(REAL) as Record<string, object>;
    expect(s.geo).toEqual({
      "@type": "GeoCoordinates",
      latitude: 25.1899,
      longitude: 55.2721,
    });
  });
});

describe("touristDestination", () => {
  it("omits geo when the coordinate is unknown", () => {
    const s = touristDestination({
      name: "Patagonia",
      url: "https://furlpay.com/travel/destinations/patagonia",
      description: "A region we do not yet index.",
    });
    expect(s).not.toHaveProperty("geo");
  });

  it("emits geo when it is known", () => {
    const s = touristDestination({
      name: "Dubai",
      url: "https://furlpay.com/travel/destinations/dubai",
      description: "Indexed.",
      latitude: 25.2048,
      longitude: 55.2708,
    }) as Record<string, object>;
    expect(s.geo).toEqual({
      "@type": "GeoCoordinates",
      latitude: 25.2048,
      longitude: 55.2708,
    });
  });
});
