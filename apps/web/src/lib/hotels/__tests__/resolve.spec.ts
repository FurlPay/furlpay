import { describe, expect, it } from "vitest";
import {
  assessCandidate,
  canonicalCountryCode,
  countryCodeFromName,
  distanceCeilingMeters,
  registrableDomain,
  resolveBestCandidate,
  roundingHalfSpanMeters,
  toleranceMeters,
  tokenContainment,
  type CuratedSubject,
  type PlaceCandidate,
} from "../resolve";

// ---------------------------------------------------------------------------
// Every case here was MEASURED against the live Places API while building the
// resolver, not invented to make the code look right. The comment on each says
// what the real response was, so a future change that breaks one has broken
// something that actually happens rather than a hypothetical.
// ---------------------------------------------------------------------------

const place = (over: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  placeId: "p1",
  name: "Test Hotel",
  latitude: 0,
  longitude: 0,
  countryCode: "FR",
  formattedAddress: "1 Rue de Test, Paris, France",
  types: ["hotel", "lodging"],
  primaryType: "hotel",
  businessStatus: "OPERATIONAL",
  ...over,
});

describe("coordinate precision", () => {
  it("reads precision from the decimals actually written", () => {
    // Trailing zeros are not precision: "-19.2000" claims one decimal, not four.
    expect(Math.round(roundingHalfSpanMeters("-19.2000", "22.8000"))).toBe(5566);
    // The COARSER of the pair governs: "45.4400" carries two decimals even
    // though "12.3290" carries three, so the pair is only good to ~557m.
    expect(Math.round(roundingHalfSpanMeters("45.4400", "12.3290"))).toBe(557);
    expect(Math.round(roundingHalfSpanMeters("31.2200", "-7.8500"))).toBe(557);
    expect(Math.round(roundingHalfSpanMeters("25.1412", "55.1853"))).toBe(6);
  });

  it("widens tolerance for a vaguer coordinate", () => {
    const vague = toleranceMeters("-19.2000", "22.8000");
    const precise = toleranceMeters("25.1412", "55.1853");
    expect(vague.accept).toBeGreaterThan(precise.accept);
    // A precise coordinate still gets a floor: these are compiled, not surveyed.
    expect(precise.accept).toBe(1200);
  });
});

describe("registrableDomain", () => {
  it("folds subdomains, tracking and language paths to one domain", () => {
    expect(registrableDomain("https://www.aman.com/hotels/aman-venice?utm_source=Google")).toBe("aman.com");
    expect(registrableDomain("https://booking.example.com/x")).toBe("example.com");
  });

  it("keeps three labels for a second-level suffix", () => {
    // Otherwise every co.uk site matches every other co.uk site.
    expect(registrableDomain("https://www.thegoring.co.uk/rooms")).toBe("thegoring.co.uk");
  });

  it("returns null rather than guessing", () => {
    expect(registrableDomain(undefined)).toBeNull();
    expect(registrableDomain("not a url at all ///")).toBeNull();
  });
});

describe("country codes", () => {
  it("canonicalises withdrawn codes to their successors", () => {
    // ICU still names VD (North Vietnam, withdrawn 1977); a name sweep hits it
    // before VN because it sorts first.
    expect(canonicalCountryCode("VD")).toBe("VN");
    expect(canonicalCountryCode("ZR")).toBe("CD");
    expect(canonicalCountryCode("US")).toBe("US");
  });

  it("resolves every spelling the curated CSV actually uses", () => {
    expect(countryCodeFromName("Vietnam")).toBe("VN");
    expect(countryCodeFromName("Czech Republic")).toBe("CZ");
    expect(countryCodeFromName("Turkey")).toBe("TR");
    expect(countryCodeFromName("Hong Kong")).toBe("HK");
    expect(countryCodeFromName("Macau")).toBe("MO");
    expect(countryCodeFromName("Saint Kitts and Nevis")).toBe("KN");
    expect(countryCodeFromName("Turks and Caicos Islands")).toBe("TC");
  });

  it("returns null for something that is not a country", () => {
    expect(countryCodeFromName("Okavango Delta")).toBeNull();
    expect(countryCodeFromName("")).toBeNull();
  });
});

describe("tokenContainment", () => {
  it("sees identity Jaro-Winkler misses", () => {
    // Google lists this hotel as "Old Cataract, Aswan". Jaro-Winkler scores the
    // pair 0.700 because the whole prefix is missing.
    expect(tokenContainment("Sofitel Legend Old Cataract Aswan", "Old Cataract, Aswan"))
      .toBeGreaterThan(0.7);
  });

  it("does not reward a single shared token", () => {
    // "Peninsula" is contained in every Peninsula on earth.
    expect(tokenContainment("The Peninsula", "The Peninsula Bangkok")).toBe(0);
  });
});

describe("hard gates", () => {
  const subject: CuratedSubject = {
    name: "Zzqx Grand Palace Hotel",
    latitudeText: "25.1000",
    longitudeText: "55.1000",
    country: "France",
  };

  it("rejects a candidate in the wrong country however plausible it looks", () => {
    // Text Search always answers. Asked for a hotel that does not exist it
    // returned Atlantis - The Palm, in the UAE.
    const verdict = assessCandidate(subject, place({
      name: "Atlantis - The Palm",
      countryCode: "AE",
      latitude: 25.1004,
      longitude: 55.1004,
    }));
    expect(verdict.verdict).toBe("rejected");
    expect(verdict.gateFailures.join(" ")).toContain("country");
  });

  it("treats CLOSED_TEMPORARILY as a trading fact, not a geographic one", () => {
    // Google reports the Burj Al Arab this way. The building has not moved.
    const open = assessCandidate(
      { ...subject, name: "Burj Al Arab Jumeirah", country: "United Arab Emirates",
        latitudeText: "25.1412", longitudeText: "55.1853", website: "https://www.jumeirah.com" },
      place({ name: "Jumeirah Burj Al Arab", countryCode: "AE", latitude: 25.14124,
        longitude: 55.18534, websiteUri: "https://www.jumeirah.com/en/stay/dubai/burj-al-arab",
        businessStatus: "CLOSED_TEMPORARILY" })
    );
    expect(open.gateFailures).toEqual([]);
    expect(open.verdict).toBe("confirmed");
  });

  it("still rejects a permanently closed listing", () => {
    const dead = assessCandidate(
      { ...subject, name: "Test Hotel", country: "France", latitudeText: "48.8", longitudeText: "2.3" },
      place({ latitude: 48.8, longitude: 2.3, businessStatus: "CLOSED_PERMANENTLY" })
    );
    expect(dead.verdict).toBe("rejected");
  });
});

describe("the type gate is evidence, not law", () => {
  it("accepts an exact name on a non-lodging type when it is close", () => {
    // Google types Necker Island as `island`. It is a resort.
    const necker = assessCandidate(
      { name: "Necker Island", latitudeText: "18.5100", longitudeText: "-64.3600",
        country: "British Virgin Islands" },
      place({ name: "Necker Island", countryCode: "VG", latitude: 18.5265,
        longitude: -64.3596, types: ["island"], primaryType: "island" })
    );
    expect(necker.verdict).toBe("confirmed");
  });

  it("rejects an exact name on a non-lodging type that is far away", () => {
    // "Viña VIK" is the winery, 21km from where the curated hotel row sits.
    const winery = assessCandidate(
      { name: "Vina Vik", latitudeText: "-34.3500", longitudeText: "-71.2000", country: "Chile" },
      place({ name: "Viña VIK", countryCode: "CL", latitude: -34.2, longitude: -71.35,
        types: ["winery"], primaryType: "winery" })
    );
    expect(winery.verdict).toBe("rejected");
    expect(winery.gateFailures.join(" ")).toContain("not lodging");
  });
});

describe("distance is bought with evidence", () => {
  it("opens the ceiling as identity strengthens", () => {
    expect(distanceCeilingMeters(0.7, 1200)).toBeLessThan(distanceCeilingMeters(1, 1200));
  });

  it("accepts a large correction when the evidence is conclusive", () => {
    // Amanpulo's curated coordinate is 76km from the island it stands on.
    const amanpulo = assessCandidate(
      { name: "Amanpulo", latitudeText: "11.9430", longitudeText: "120.3630",
        country: "Philippines", website: "https://www.aman.com" },
      place({ name: "Amanpulo", countryCode: "PH", latitude: 11.1667, longitude: 120.9333,
        websiteUri: "https://www.aman.com/resorts/amanpulo" })
    );
    expect(amanpulo.verdict).toBe("confirmed");
    expect(amanpulo.distanceMeters).toBeGreaterThan(70_000);
  });

  it("does not extend the same licence to a weak name", () => {
    const weak = assessCandidate(
      { name: "Grand Hotel", latitudeText: "48.8566", longitudeText: "2.3522", country: "France" },
      place({ name: "Hotel Splendide Royal", latitude: 48.2, longitude: 2.9 })
    );
    expect(weak.verdict).toBe("rejected");
  });
});

describe("shared operator domains", () => {
  const subject: CuratedSubject = {
    name: "Mombo Camp",
    latitudeText: "-19.2000",
    longitudeText: "22.8000",
    country: "Botswana",
    city: "Okavango Delta",
    website: "https://wildernessdestinations.com",
  };

  it("counts a domain used across the corpus as weak evidence", () => {
    const shared = assessCandidate(subject, place({
      name: "Little Mombo Camp", countryCode: "BW", latitude: -19.2283, longitude: 22.7793,
      primaryType: "lodging", types: ["lodging"],
      websiteUri: "https://www.wildernessdestinations.com/africa/botswana/little-mombo",
      formattedAddress: "Okavango Delta, Botswana",
    }), 34);
    expect(shared.domainMatch).toBe(true);
    expect(shared.domainExclusive).toBe(false);
  });
});

describe("ambiguity", () => {
  const mombo: CuratedSubject = {
    name: "Mombo Camp",
    latitudeText: "-19.2000",
    longitudeText: "22.8000",
    country: "Botswana",
    city: "Okavango Delta",
    website: "https://wildernessdestinations.com",
  };

  const little = place({
    placeId: "little", name: "Little Mombo Camp", countryCode: "BW",
    latitude: -19.2283271, longitude: 22.7793497, primaryType: "lodging", types: ["lodging"],
    websiteUri: "https://www.wildernessdestinations.com/africa/botswana/little-mombo",
    formattedAddress: "Okavango Delta, Botswana",
  });
  const wilderness = place({
    placeId: "wilderness", name: "Wilderness Mombo", countryCode: "BW",
    latitude: -19.2268588, longitude: 22.7772348, primaryType: "lodging", types: ["lodging"],
    websiteUri: "https://www.wildernessdestinations.com/africa/botswana/mombo-camp",
    formattedAddress: "Masarwa, Botswana",
  });

  it("refuses to move a pin between two properties of one operator", () => {
    // These are 250m apart, share a domain, and one of them is the curated camp
    // under a rename. Nothing in the data says which.
    const result = resolveBestCandidate(mombo, [little, wilderness], 34);
    expect(result.ambiguous).toBe(true);
    expect(result.best?.verdict).toBe("probable");
    expect(result.runnerUpName).toBeTruthy();
  });

  it("is not troubled by a near neighbour when the name is exact", () => {
    // "Mandarin Oriental, Hong Kong" 59m away, against "Mandarin Oriental The
    // Landmark, Hong Kong". Similar names, different hotels, and the curated
    // row names one of them exactly.
    const subject: CuratedSubject = {
      name: "Mandarin Oriental Hong Kong", latitudeText: "22.2820", longitudeText: "114.1600",
      country: "Hong Kong", city: "Hong Kong", website: "https://www.mandarinoriental.com",
    };
    const exact = place({
      placeId: "mo", name: "Mandarin Oriental, Hong Kong", countryCode: "HK",
      latitude: 22.2818, longitude: 114.1601,
      websiteUri: "https://www.mandarinoriental.com/hong-kong/victoria-harbour",
      formattedAddress: "5 Connaught Rd Central, Hong Kong",
    });
    const landmark = place({
      placeId: "landmark", name: "Mandarin Oriental The Landmark, Hong Kong", countryCode: "HK",
      latitude: 22.2803, longitude: 114.1578,
      websiteUri: "https://www.mandarinoriental.com/hong-kong/landmark",
      formattedAddress: "15 Queen's Rd Central, Hong Kong",
    });

    const result = resolveBestCandidate(subject, [exact, landmark], 12);
    expect(result.ambiguous).toBe(false);
    expect(result.best?.candidate.placeId).toBe("mo");
    expect(result.best?.verdict).toBe("confirmed");
  });

  it("reports no match rather than the least bad one", () => {
    const result = resolveBestCandidate(
      { name: "Zzqx Grand Palace", latitudeText: "48.8566", longitudeText: "2.3522", country: "France" },
      [place({ name: "Atlantis - The Palm", countryCode: "AE", latitude: 25.13, longitude: 55.11 })]
    );
    expect(result.best).toBeNull();
  });
});

describe("ranking beyond the first result", () => {
  it("picks the best candidate, not the one Google ranked first", () => {
    const subject: CuratedSubject = {
      name: "Angama Mara", latitudeText: "-1.2700", longitudeText: "35.0000",
      country: "Kenya", website: "https://angama.com",
    };
    const wrong = place({
      placeId: "wrong", name: "Mara Serena Safari Lodge", countryCode: "KE",
      latitude: -1.2801, longitude: 35.0102, primaryType: "lodging", types: ["lodging"],
      websiteUri: "https://www.serenahotels.com/mara",
    });
    const right = place({
      placeId: "right", name: "Angama Mara", countryCode: "KE",
      latitude: -1.2699, longitude: 35.0101, primaryType: "lodging", types: ["lodging"],
      websiteUri: "https://angama.com/angama-mara",
    });

    // Google returned the wrong one first.
    const result = resolveBestCandidate(subject, [wrong, right]);
    expect(result.best?.candidate.placeId).toBe("right");
    expect(result.best?.verdict).toBe("confirmed");
  });
});
