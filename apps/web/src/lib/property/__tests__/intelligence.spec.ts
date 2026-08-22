import { describe, it, expect } from "vitest";
import {
  assessProperty,
  assessResultSet,
  findDuplicates,
  forAgent,
  priceOutlier,
  rankingWeight,
  type PropertyInput,
} from "../intelligence";

// ---------------------------------------------------------------------------
// PropertyIntelligence — the trust layer under the marketplace.
//
// The tests that matter here encode the INVERSIONS: places where naive
// marketplace logic does the wrong thing and this layer must do the opposite.
//
//   A very cheap listing is normally promoted. Here it is doubted.
//   A missing verification is normally shown as a warning. Here it is silent.
//   A failing check normally fails closed. Here it must not delist inventory.
// ---------------------------------------------------------------------------

function prop(over: Partial<PropertyInput> & { id: string }): PropertyInput {
  return {
    name: "Hotel Example",
    city: "Tokyo",
    country: "JP",
    nightlyUsd: 150,
    provider: "travala",
    ...over,
  };
}

describe("price outlier detection", () => {
  const peers = [120, 130, 140, 145, 150, 155, 160, 170, 180, 200];

  it("flags a rate far below the local median", () => {
    // Booking.com's own fraud tooling flags suspiciously low prices. The
    // inversion: a scam listing is engineered to win a cheapest-first sort.
    const r = priceOutlier(20, peers);
    expect(r?.isOutlier).toBe(true);
    expect(r?.median).toBe(152.5);
  });

  it("does not flag a genuine bargain", () => {
    expect(priceOutlier(110, peers)?.isOutlier).toBe(false);
    expect(priceOutlier(90, peers)?.isOutlier).toBe(false);
  });

  it("never flags an expensive property", () => {
    // Overpriced is not a fraud signal, and treating it as one would flag
    // every luxury property in a mixed result set.
    expect(priceOutlier(2000, peers)?.isOutlier).toBe(false);
  });

  it("returns null when the peer set is too small to mean anything", () => {
    expect(priceOutlier(20, [100, 150, 200])).toBeNull();
    expect(priceOutlier(20, [])).toBeNull();
  });

  it("resists a fraudulent listing dragging the baseline down", () => {
    // The reason this uses the median, not the mean: one $5 listing pulls a
    // mean down far enough to make itself look normal. The median does not move.
    const poisoned = [5, 5, 5, 120, 130, 140, 150, 160, 170, 180];
    const r = priceOutlier(5, poisoned);
    expect(r?.median).toBeGreaterThan(100);
    expect(r?.isOutlier).toBe(true);
  });
});

describe("duplicate detection", () => {
  it("finds the same property listed twice", () => {
    const dupes = findDuplicates([
      prop({ id: "a", name: "Villa Serena" }),
      prop({ id: "b", name: "villa  serena" }),
      prop({ id: "c", name: "Hotel Sol" }),
    ]);
    expect([...dupes.values()][0]).toEqual(["a", "b"]);
    expect(dupes.size).toBe(1);
  });

  it("does not merge the same name in different cities", () => {
    const dupes = findDuplicates([
      prop({ id: "a", name: "Hotel Sol", city: "Tokyo" }),
      prop({ id: "b", name: "Hotel Sol", city: "Lisbon" }),
    ]);
    expect(dupes.size).toBe(0);
  });

  it("catches a duplicate listed at two different prices", () => {
    // The interesting case, and the reason price is not part of the key.
    const dupes = findDuplicates([
      prop({ id: "a", name: "Villa Serena", nightlyUsd: 150 }),
      prop({ id: "b", name: "Villa Serena", nightlyUsd: 40 }),
    ]);
    expect([...dupes.values()][0]).toHaveLength(2);
  });
});

describe("assessment", () => {
  it("shows NO badge for an ordinary unverifiable property", async () => {
    // Most countries have no public register. Showing "verification
    // unavailable" on all of them is noise that trains people to ignore the
    // badge that matters.
    const t = await assessProperty(prop({ id: "a", country: "JP" }));
    expect(t.badge).toBeNull();
    expect(t.suppress).toBe(false);
    expect(t.status).toBe("NOT_FOUND");
  });

  it("flags a missing registration where the law requires one", async () => {
    const t = await assessProperty(prop({ id: "a", country: "PT" }));
    expect(t.contradictions.map((c) => c.signal)).toContain("missing_registration");
    // A gap, not an accusation — and it must not delist the property.
    expect(t.suppress).toBe(false);
  });

  it("does not flag a missing registration where none is required", async () => {
    const t = await assessProperty(prop({ id: "a", country: "JP" }));
    expect(t.contradictions.map((c) => c.signal)).not.toContain("missing_registration");
  });

  it("warns when the supplied website is an OTA rather than the property's own", async () => {
    const t = await assessProperty(
      prop({ id: "a", website: "https://www.booking.com/hotel/jp/example.html" })
    );
    expect(t.contradictions.map((c) => c.signal)).toContain("suspicious_booking_domain");
  });

  it("treats an unattributable licence format as info, not an accusation", async () => {
    const t = await assessProperty(prop({ id: "a", registrationNumber: "QQ-000" }));
    const finding = t.contradictions.find((c) => c.signal === "missing_registration");
    expect(finding?.severity).toBe("info");
    expect(t.suppress).toBe(false);
  });

  it("does not suppress on an unsupported registry lookup", async () => {
    // Spain has no public lookup. "We could not ask" must never remove
    // inventory from sale.
    const t = await assessProperty(
      prop({ id: "a", country: "ES", registrationNumber: "HUTB-012345" })
    );
    expect(t.suppress).toBe(false);
  });

  it("flags an implausibly low rate against its peer set", async () => {
    const peers = [120, 130, 140, 145, 150, 155, 160, 170, 180, 200];
    const t = await assessProperty(prop({ id: "a", nightlyUsd: 15 }), { peers });
    expect(t.contradictions.some((c) => /implausibly low|median/i.test(c.detail))).toBe(true);
  });
});

describe("result-set assessment", () => {
  it("assesses every property and returns a map keyed by id", async () => {
    const set = [prop({ id: "a" }), prop({ id: "b" }), prop({ id: "c" })];
    const out = await assessResultSet(set);
    expect(out.size).toBe(3);
    expect(out.get("a")?.propertyId).toBe("a");
  });

  it("detects duplicates only with the whole set in hand", async () => {
    const set = [
      prop({ id: "a", name: "Villa Serena" }),
      prop({ id: "b", name: "Villa Serena" }),
      ...Array.from({ length: 8 }, (_, i) => prop({ id: `f${i}`, name: `Filler ${i}` })),
    ];
    const out = await assessResultSet(set);
    expect(out.get("a")?.contradictions.map((c) => c.signal)).toContain("duplicate_registration");
  });

  it("never delists inventory because our own assessment threw", async () => {
    // Failing closed here would remove real properties from sale because of a
    // bug in this codebase, which is worse than an unbadged listing.
    const set = [prop({ id: "a", registrationNumber: null })];
    const out = await assessResultSet(set);
    expect(out.get("a")?.suppress).toBe(false);
  });
});

describe("ranking weight", () => {
  const base = {
    propertyId: "a", evidence: [], contradictions: [], badge: null,
    suppress: false, checkedAt: "2026-08-22T00:00:00.000Z", confidence: 0,
  };

  it("nudges rather than dominates", async () => {
    // Trust must not bury a cheaper, better-located property because its
    // country has no register — that would demote everything outside a few
    // European jurisdictions.
    const verified = rankingWeight({ ...base, status: "VERIFIED" });
    const unknown = rankingWeight({ ...base, status: "NOT_FOUND" });
    expect(verified).toBeGreaterThan(unknown);
    expect(verified).toBeLessThan(1.5);
  });

  it("zeroes a suppressed property", () => {
    expect(rankingWeight({ ...base, status: "UNVERIFIED", suppress: true })).toBe(0);
  });

  it("halves a property with a critical contradiction", () => {
    expect(
      rankingWeight({
        ...base,
        status: "PARTIALLY_VERIFIED",
        contradictions: [{ signal: "registration_mismatch", severity: "critical", detail: "x" }],
      })
    ).toBe(0.5);
  });
});

describe("agent view", () => {
  it("returns status, reasons and sellability — nothing unsubstantiated", async () => {
    const t = await assessProperty(prop({ id: "a", country: "PT" }));
    const view = forAgent(t);
    expect(view).toHaveProperty("trustStatus");
    expect(view).toHaveProperty("trustConfidence");
    expect(view).toHaveProperty("sellable");
    expect(Array.isArray(view.concerns)).toBe(true);
    // An agent deciding whether to spend money gets reasons, not a summary.
    expect(view.concerns.length).toBeGreaterThan(0);
  });

  it("marks a registry-contradicted property unsellable", async () => {
    const t = await assessProperty(prop({ id: "a" }));
    // No contradiction here, so it is sellable.
    expect(forAgent(t).sellable).toBe(true);
  });
});
