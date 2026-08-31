import { describe, it, expect } from "vitest";
import { haversineMeters, jaroWinkler, normalizeName, clusterByConsensus } from "../h3";
import { bestMatch, findDuffelMatch, mayPrice, type OsmSubject } from "../match";
import type { DuffelAccommodation } from "@/lib/travel/duffel";

const oberoi: OsmSubject = {
  id: "osm_n1",
  name: "The Oberoi Bengaluru",
  latitude: 12.9716,
  longitude: 77.5946,
  city: "Bengaluru",
  countryCode: "IN",
};

function acc(p: Partial<DuffelAccommodation> & { name: string }): DuffelAccommodation {
  return {
    id: p.id ?? "acc_x",
    name: p.name,
    latitude: p.latitude,
    longitude: p.longitude,
    city: p.city,
    countryCode: p.countryCode,
    stars: p.stars,
    chain: p.chain,
    brand: p.brand,
  };
}

/** Offset a coordinate by roughly `m` metres of latitude. */
function north(lat: number, m: number): number {
  return lat + m / 111_320;
}

describe("name normalisation", () => {
  it("folds diacritics and drops generic words", () => {
    expect(normalizeName("Hôtel Saint-Honoré")).toBe("saint honore");
    expect(normalizeName("THE OBEROI BENGALURU")).toBe("oberoi bengaluru");
  });

  it("does not collapse two names to the same string just by stripping", () => {
    expect(normalizeName("Hilton London Metropole")).not.toBe(
      normalizeName("Hilton London Bankside")
    );
  });
});

describe("haversine", () => {
  it("measures a known separation", () => {
    // Paris to London, ~343 km.
    const d = haversineMeters(48.8566, 2.3522, 51.5074, -0.1278);
    expect(d).toBeGreaterThan(340_000);
    expect(d).toBeLessThan(346_000);
  });

  it("is symmetric and zero on identity", () => {
    expect(haversineMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
    expect(haversineMeters(1, 2, 3, 4)).toBeCloseTo(haversineMeters(3, 4, 1, 2), 6);
  });
});

describe("OSM -> Duffel matching", () => {
  it("matches the same hotel across a spelling difference at close range", () => {
    const m = bestMatch(oberoi, [
      acc({
        id: "acc_ob",
        name: "The Oberoi Bangalore",
        latitude: north(12.9716, 42),
        longitude: 77.5946,
        city: "Bangalore",
        countryCode: "IN",
      }),
    ]);
    expect(m).not.toBeNull();
    expect(m!.duffelAccommodationId).toBe("acc_ob");
    expect(m!.distanceMeters).toBeLessThan(60);
    // Recorded so a threshold change has to face the real number.
    expect(m!.nameSimilarity).toBeGreaterThan(0.85);
  });

  it("REFUSES to price two different hotels of the same chain", () => {
    const metropole: OsmSubject = {
      id: "osm_metro",
      name: "Hilton London Metropole",
      latitude: 51.5203,
      longitude: -0.1636,
      countryCode: "GB",
    };
    // Bankside is ~4km away. Distance must veto the shared brand tokens.
    const m = bestMatch(metropole, [
      acc({
        id: "acc_bank",
        name: "Hilton London Bankside",
        latitude: 51.5055,
        longitude: -0.0977,
        countryCode: "GB",
      }),
    ]);
    expect(mayPrice(m)).toBe(false);
  });

  it("will not mark a same-chain neighbour HIGH even when it is close", () => {
    const metropole: OsmSubject = {
      id: "osm_metro",
      name: "Hilton London Metropole",
      latitude: 51.5203,
      longitude: -0.1636,
    };
    const m = bestMatch(metropole, [
      acc({
        id: "acc_bank",
        name: "Hilton London Bankside",
        latitude: north(51.5203, 90),
        longitude: -0.1636,
      }),
    ]);
    // Whatever it scores, it must not be allowed to drive a rate.
    expect(mayPrice(m)).toBe(false);
  });

  it("ignores candidates with no coordinates", () => {
    const m = bestMatch(oberoi, [acc({ id: "acc_nogeo", name: "The Oberoi Bengaluru" })]);
    expect(m).toBeNull();
  });

  it("picks the nearer of two plausible candidates", () => {
    const m = bestMatch(oberoi, [
      acc({ id: "far", name: "The Oberoi Bengaluru", latitude: north(12.9716, 900), longitude: 77.5946 }),
      acc({ id: "near", name: "The Oberoi Bengaluru", latitude: north(12.9716, 30), longitude: 77.5946 }),
    ]);
    expect(m!.duffelAccommodationId).toBe("near");
    expect(mayPrice(m)).toBe(true);
  });

  it("returns null when Duffel has nothing nearby", () => {
    expect(bestMatch(oberoi, [])).toBeNull();
  });
});

describe("radius escalation", () => {
  it("stops at the first radius that yields a HIGH match", async () => {
    const tried: number[] = [];
    const m = await findDuffelMatch(oberoi, async (r) => {
      tried.push(r);
      return [
        acc({
          id: "acc_ob",
          name: "The Oberoi Bengaluru",
          latitude: north(12.9716, 20),
          longitude: 77.5946,
        }),
      ];
    });
    expect(m!.confidence).toBe("HIGH");
    expect(tried).toEqual([1]); // never widened
  });

  it("widens only while inconclusive, and never past the last radius", async () => {
    const tried: number[] = [];
    const m = await findDuffelMatch(oberoi, async (r) => {
      tried.push(r);
      return null; // Duffel returns nothing at any radius
    });
    expect(m).toBeNull();
    expect(tried).toEqual([1, 2, 5]);
  });

  it("does not price a MEDIUM match no matter how many radii it took", async () => {
    const m = await findDuffelMatch(oberoi, async () => [
      acc({
        id: "acc_mid",
        name: "The Oberoi Bengaluru",
        latitude: north(12.9716, 300),
        longitude: 77.5946,
      }),
    ]);
    expect(m!.confidence).toBe("MEDIUM");
    expect(mayPrice(m)).toBe(false);
  });
});

describe("OSM self-deduplication", () => {
  it("merges one hotel mapped twice but keeps distinct neighbours apart", () => {
    const clusters = clusterByConsensus([
      { id: "a", name: "Aman Tokyo", latitude: 35.6855, longitude: 139.7655 },
      { id: "b", name: "Aman Tokyo Hotel", latitude: north(35.6855, 25), longitude: 139.7655 },
      { id: "c", name: "Shangri-La Tokyo", latitude: north(35.6855, 40), longitude: 139.7655 },
    ]);
    const sizes = clusters.map((c) => c.members.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it("keeps two genuinely different Hiltons separate", () => {
    const clusters = clusterByConsensus([
      { id: "m", name: "Hilton London Metropole", latitude: 51.5203, longitude: -0.1636 },
      { id: "b", name: "Hilton London Bankside", latitude: 51.5055, longitude: -0.0977 },
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe("jaro-winkler sanity", () => {
  it("scores identical strings 1 and unrelated strings low", () => {
    expect(jaroWinkler("aman tokyo", "aman tokyo")).toBe(1);
    expect(jaroWinkler("aman tokyo", "zzzzzzzz")).toBeLessThan(0.5);
  });
});
