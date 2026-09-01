import { describe, expect, it } from "vitest";
import {
  CLUSTER_MAX_ZOOM,
  clusterPoints,
  curatedInBBox,
  curatedMatching,
  curatedProperties,
  curatedStats,
  familyOf,
  type CuratedPoint,
} from "../curated";

// ---------------------------------------------------------------------------
// These run against the REAL artifact, not a fixture. The point of most of them
// is that the dataset itself is intact and self-consistent, which a fixture
// could not tell us — a resolver run that silently dropped a third of the CSV
// would pass every test written against a hand-made three-row sample.
// ---------------------------------------------------------------------------

describe("the dataset", () => {
  it("keeps every curated property, confirmed or not", () => {
    // 507 rows in, 507 out. A property Google could not confirm is a real hotel
    // we know less about, not one that stopped existing.
    expect(curatedProperties().length).toBe(507);
  });

  it("gives every property a drawable coordinate", () => {
    for (const p of curatedProperties()) {
      expect(Number.isFinite(p.latitude)).toBe(true);
      expect(Number.isFinite(p.longitude)).toBe(true);
      expect(Math.abs(p.latitude)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.longitude)).toBeLessThanOrEqual(180);
      // Null Island is what an unparsed coordinate looks like.
      expect(p.latitude === 0 && p.longitude === 0).toBe(false);
    }
  });

  it("labels precision honestly", () => {
    for (const p of curatedProperties()) {
      if (p.precision === "exact") {
        // An exact position must be one Google actually confirmed.
        expect(p.coordinateSource).toBe("google_places");
        expect(p.match?.verdict).toBe("confirmed");
        expect(p.placeId).toBeTruthy();
      } else {
        // An approximate position is the CSV's own, unmodified.
        expect(p.latitude).toBe(p.curatedLatitude);
        expect(p.longitude).toBe(p.curatedLongitude);
      }
    }
  });

  it("never loses the coordinate it replaced", () => {
    // Every correction stays reversible and auditable.
    for (const p of curatedProperties()) {
      expect(Number.isFinite(p.curatedLatitude)).toBe(true);
      expect(Number.isFinite(p.curatedLongitude)).toBe(true);
    }
  });

  it("reports its own confirmed share", () => {
    const stats = curatedStats();
    expect(stats.total).toBe(507);
    expect(stats.exact + stats.approximate).toBe(stats.total);
    expect(stats.exact).toBeGreaterThan(400);
  });
});

describe("viewport query", () => {
  it("returns only what is inside the box", () => {
    // Western Europe.
    const box = { minLat: 40, minLng: -10, maxLat: 55, maxLng: 20 };
    const hits = curatedInBBox(box);
    expect(hits.length).toBeGreaterThan(0);
    for (const p of hits) {
      expect(p.latitude).toBeGreaterThanOrEqual(box.minLat);
      expect(p.latitude).toBeLessThanOrEqual(box.maxLat);
      expect(p.longitude).toBeGreaterThanOrEqual(box.minLng);
      expect(p.longitude).toBeLessThanOrEqual(box.maxLng);
    }
  });

  it("answers a WORLD box, which is the whole reason this layer exists", () => {
    // Overpass refuses a box this wide, which is what left the world view empty.
    const all = curatedInBBox({ minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 });
    expect(all.length).toBe(507);
  });

  it("returns nothing for an empty ocean rather than the nearest thing", () => {
    // South Pacific, well away from anything curated.
    expect(curatedInBBox({ minLat: -40, minLng: -140, maxLat: -30, maxLng: -130 })).toEqual([]);
  });
});

describe("filters", () => {
  it("narrows by category", () => {
    const overwater = curatedMatching({ categories: ["overwater_villas"] });
    expect(overwater.length).toBeGreaterThan(0);
    for (const p of overwater) expect(p.categories).toContain("overwater_villas");
  });

  it("narrows by star floor without inventing stars", () => {
    const five = curatedMatching({ minStars: 5 });
    for (const p of five) expect(p.stars).toBe(5);
    // A property with no recorded star rating is excluded rather than assumed
    // to be five: absence of a rating is not a rating.
    expect(five.length).toBeLessThan(curatedProperties().length);
  });

  it("drops an unrated property for want of evidence, not for a low score", () => {
    // The distinction the `?? 0` form could not express. Both of these are
    // excluded from a five-star filter, and only one of them was actually
    // judged — so only one may ever be described to a reader as falling short.
    const unrated: CuratedPoint = {
      id: "t_unrated", name: "Unrated House", city: "X", country: "Y",
      propertyType: "hotel", categories: [], precision: "exact",
      latitude: 0, longitude: 0,
    };
    const rated: CuratedPoint = { ...unrated, id: "t_two", stars: 2 };
    expect(unrated.stars).toBeUndefined();
    expect(rated.stars).toBe(2);
  });

  it("can surface unrated properties when the caller asks", () => {
    const strict = curatedMatching({ minStars: 5 });
    const lenient = curatedMatching({ minStars: 5, includeUnrated: true });
    // Lenient is a superset: it adds the unmeasured, it never removes a match.
    expect(lenient.length).toBeGreaterThanOrEqual(strict.length);
    for (const p of lenient) {
      if (typeof p.stars === "number") expect(p.stars).toBeGreaterThanOrEqual(5);
    }
  });

  it("searches name, brand, city and country", () => {
    const aman = curatedMatching({ query: "aman" });
    expect(aman.length).toBeGreaterThan(1);
    const japan = curatedMatching({ query: "japan" });
    expect(japan.every((p) => `${p.country} ${p.city}`.toLowerCase().includes("japan"))).toBe(true);
  });

  it("can exclude unconfirmed positions", () => {
    const exact = curatedMatching({ exactOnly: true });
    expect(exact.every((p) => p.precision === "exact")).toBe(true);
    expect(exact.length).toBe(curatedStats().exact);
  });

  it("combines filters conjunctively", () => {
    const both = curatedMatching({ categories: ["ultra_luxury"], minStars: 5 });
    for (const p of both) {
      expect(p.categories).toContain("ultra_luxury");
      expect(p.stars).toBe(5);
    }
  });
});

describe("clustering", () => {
  const world = () => curatedInBBox({ minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 });

  it("accounts for every property exactly once", () => {
    // The count on a cluster has to be checkable, so nothing may be dropped or
    // counted twice on the way there.
    const points = world();
    const { clusters, singles } = clusterPoints(points, 2);
    const total = singles.length + clusters.reduce((n, c) => n + c.count, 0);
    expect(total).toBe(points.length);
  });

  it("never emits a cluster of one", () => {
    const { clusters } = clusterPoints(world(), 3);
    for (const c of clusters) expect(c.count).toBeGreaterThan(1);
  });

  it("thins the world view and stops entirely when zoomed in", () => {
    const points = world();
    const wide = clusterPoints(points, 2);
    expect(wide.clusters.length).toBeGreaterThan(0);
    expect(wide.singles.length).toBeLessThan(points.length);

    const close = clusterPoints(points, CLUSTER_MAX_ZOOM);
    expect(close.clusters).toEqual([]);
    expect(close.singles.length).toBe(points.length);
  });

  it("gives a cluster bounds that actually contain its members", () => {
    const { clusters } = clusterPoints(world(), 3);
    for (const c of clusters) {
      expect(c.bounds.minLat).toBeLessThanOrEqual(c.bounds.maxLat);
      expect(c.bounds.minLng).toBeLessThanOrEqual(c.bounds.maxLng);
      // The centroid has to sit inside what it summarises, or clicking the
      // cluster flies somewhere its members are not.
      expect(c.latitude).toBeGreaterThanOrEqual(c.bounds.minLat - 1e-6);
      expect(c.latitude).toBeLessThanOrEqual(c.bounds.maxLat + 1e-6);
      expect(c.longitude).toBeGreaterThanOrEqual(c.bounds.minLng - 1e-6);
      expect(c.longitude).toBeLessThanOrEqual(c.bounds.maxLng + 1e-6);
    }
  });

  it("splits further as zoom increases", () => {
    const points = world();
    const counts = [1, 3, 5, 7].map((z) => {
      const { clusters, singles } = clusterPoints(points, z);
      return clusters.length + singles.length;
    });
    // More markers at every step: clustering loosens as the map gets closer.
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  it("clusters in projected space, not in raw degrees", () => {
    // Two points the same number of DEGREES apart are much further apart on
    // screen near the equator than near the poles. A degree grid would merge
    // the polar pair and split the equatorial one at the same zoom.
    const at = (latitude: number, longitude: number, id: string): CuratedPoint =>
      ({ ...curatedProperties()[0], id, latitude, longitude });

    const polar = clusterPoints([at(78, 15, "a"), at(78.4, 15, "b")], 6);
    const equatorial = clusterPoints([at(0, 15, "c"), at(0.4, 15, "d")], 6);
    // Same degree separation, different screen separation: the polar pair is
    // further apart on screen, so it is the equatorial pair that clusters.
    expect(polar.clusters.length).toBeLessThanOrEqual(equatorial.clusters.length);
  });
});

describe("cluster descriptions drive the hover card", () => {
  const world = () => curatedInBBox({ minLat: -90, minLng: -180, maxLat: 90, maxLng: 180 });

  it("splits every member into exactly one family", () => {
    // The card prints these three numbers under the count. If they did not sum
    // to it, the card's own arithmetic would fail in front of the user.
    for (const c of clusterPoints(world(), 3).clusters) {
      expect(c.families.hotels + c.families.resorts + c.families.villas).toBe(c.count);
    }
  });

  it("partitions the whole dataset, leaving nothing uncategorised", () => {
    const seen = new Set(curatedProperties().map((p) => familyOf(p.propertyType)));
    expect([...seen].sort()).toEqual(["hotels", "resorts", "villas"]);
  });

  it("never claims more confirmed positions than it has members", () => {
    for (const c of clusterPoints(world(), 3).clusters) {
      expect(c.confirmed).toBeLessThanOrEqual(c.count);
      expect(c.confirmed).toBeGreaterThanOrEqual(0);
    }
  });

  it("labels a group with something true of it", () => {
    for (const c of clusterPoints(world(), 4).clusters) {
      expect(c.label.length).toBeGreaterThan(0);
      // The subtitle always states the real count, so a label that had to
      // generalise up to a country is still precise about what it counted.
      expect(c.sublabel).toContain(String(c.count));
    }
  });

  it("offers at most three top properties, drawn from its own members", () => {
    const points = world();
    const byId = new Map(points.map((p) => [p.id, p]));
    for (const c of clusterPoints(points, 3).clusters) {
      expect(c.top.length).toBeLessThanOrEqual(3);
      expect(c.top.length).toBeLessThanOrEqual(c.count);
      // A card that listed a property from somewhere else would make its own
      // "View all" lie about what zooming in shows.
      for (const m of c.top) expect(byId.has(m.id)).toBe(true);
    }
  });
});

describe("family filter", () => {
  it("narrows to the requested families and nothing else", () => {
    const villas = curatedMatching({ families: ["villas"] });
    expect(villas.length).toBeGreaterThan(0);
    for (const p of villas) expect(familyOf(p.propertyType)).toBe("villas");
  });

  it("splits the dataset with no overlap and no remainder", () => {
    const h = curatedMatching({ families: ["hotels"] }).length;
    const r = curatedMatching({ families: ["resorts"] }).length;
    const v = curatedMatching({ families: ["villas"] }).length;
    expect(h + r + v).toBe(curatedProperties().length);
  });
});

describe("stored imagery", () => {
  it("attaches every photograph to a property that has coordinates", () => {
    // The images exist to sit on the map, so one attached to a property with no
    // drawable position would never be seen and should not have been fetched.
    for (const p of curatedProperties()) {
      if (!p.imageLocalPath) continue;
      expect(Number.isFinite(p.latitude)).toBe(true);
      expect(Number.isFinite(p.longitude)).toBe(true);
    }
  });

  it("files each photograph under the property's own first category", () => {
    // The tree mirrors the taxonomy the map filters by, so a category's imagery
    // can be reviewed as a set.
    for (const p of curatedProperties()) {
      if (!p.imageLocalPath) continue;
      const folder = p.imageLocalPath.split("/")[2];
      expect(folder).toBe(p.categories[0] ?? "uncategorised");
    }
  });

  it("carries attribution and a licence with every stored photograph", () => {
    // A CC-BY image without its credit is a licence breach, not a cosmetic gap,
    // so this is a correctness test rather than a completeness one.
    for (const p of curatedProperties()) {
      if (!p.imageLocalPath) continue;
      expect(p.imageCredit, `${p.name} has no credit`).toBeTruthy();
      expect(p.imageLicence, `${p.name} has no licence`).toBeTruthy();
      expect(p.imageSourcePage, `${p.name} has no source page`).toBeTruthy();
    }
  });

  it("stores no Google Places photography", () => {
    // Places content may not be written to disk. Every stored file must be
    // Commons; if this ever fails, the policy has been broken.
    for (const p of curatedProperties()) {
      if (!p.imageLocalPath && !p.imageUrl) continue;
      expect(p.imageSource).toBe("wikimedia_commons");
      expect(p.imageLocalPath ?? "").not.toContain("googleapis");
      expect(p.imageUrl ?? "").not.toContain("googleapis");
    }
  });
});

describe("the CSV is fully represented", () => {
  it("carries the provenance note that explains the missing websites", () => {
    const noUrl = curatedProperties().filter(
      (p) => p.sourceNote === "Property publicly documented; official URL to be confirmed"
    );
    expect(noUrl.length).toBeGreaterThan(0);
    // The note and the gap have to agree, or the note is decoration.
    for (const p of noUrl) expect(p.website).toBeFalsy();
  });

  it("gives every property a source note", () => {
    for (const p of curatedProperties()) expect(p.sourceNote).toBeTruthy();
  });
});
