import { describe, it, expect } from "vitest";

// The ranking + quota rule, extracted so it can be tested without the route's
// upstream calls. It mirrors the branch in api/travel/hotels/map/route.ts.
//
// Two regressions this pins:
//   1. Paris drew 391 Google, 9 curated, 0 OSM — one source ate the budget.
//   2. Overpass was awaited (10-50s) for points that were then discarded.

type Source = "curated" | "google" | "osm";
const RANK: Record<Source, number> = { curated: 0, google: 1, osm: 2 };

function select(all: { source: Source; score: number }[], budget = 400) {
  const quota: Record<Source, number> = { curated: Infinity, google: 300, osm: 60 };
  const taken: Record<Source, number> = { curated: 0, google: 0, osm: 0 };
  const sorted = [...all].sort((a, b) =>
    a.source !== b.source ? RANK[a.source] - RANK[b.source] : b.score - a.score);
  const out: typeof all = [];
  for (const p of sorted) {
    if (out.length >= budget) break;
    if (taken[p.source] >= quota[p.source]) continue;
    taken[p.source]++;
    out.push(p);
  }
  return out;
}

const many = (source: Source, n: number) =>
  Array.from({ length: n }, (_, i) => ({ source, score: n - i }));

describe("source quotas keep the map representative", () => {
  it("does not let Google consume the whole budget", () => {
    // The Paris shape: Google far outnumbers everything else.
    const out = select([...many("google", 2000), ...many("curated", 9), ...many("osm", 200)]);
    const n = (s: Source) => out.filter((p) => p.source === s).length;
    expect(n("google")).toBe(300);   // capped, not 391+
    expect(n("curated")).toBe(9);    // uncapped, all kept
    expect(n("osm")).toBe(60);       // floor honoured, not 0
    expect(out.length).toBe(369);
  });

  it("still fills the budget from one source when others are absent", () => {
    // A viewport with nothing but Google must not be artificially thinned
    // below its own quota.
    const out = select(many("google", 1000));
    expect(out.length).toBe(300);
  });

  it("keeps curated first, then Google, then OSM", () => {
    const out = select([...many("osm", 5), ...many("google", 5), ...many("curated", 2)]);
    expect(out.slice(0, 2).every((p) => p.source === "curated")).toBe(true);
    expect(out.slice(2, 7).every((p) => p.source === "google")).toBe(true);
  });

  it("ranks by score within a source", () => {
    const out = select([
      { source: "google", score: 1 },
      { source: "google", score: 99 },
      { source: "google", score: 50 },
    ]);
    expect(out.map((p) => p.score)).toEqual([99, 50, 1]);
  });
});

describe("Overpass is only awaited where it can help", () => {
  const GOOGLE_DENSE_ENOUGH = 120;
  const shouldFetchOsm = (googleCount: number, zoomOk: boolean, filtered: boolean) =>
    zoomOk && !filtered && googleCount < GOOGLE_DENSE_ENOUGH;

  it("skips the call in a viewport Google already covers", () => {
    // Paris z13 returns ~390 Google properties and used to wait 10-50s for OSM
    // points that were then dropped by the budget.
    expect(shouldFetchOsm(390, true, false)).toBe(false);
  });

  it("still calls it where Google coverage is thin", () => {
    // The case OSM exists for: somewhere the discovery grid never ran.
    expect(shouldFetchOsm(3, true, false)).toBe(true);
  });

  it("never calls it at a zoom Overpass would refuse", () => {
    expect(shouldFetchOsm(0, false, false)).toBe(false);
  });

  it("never calls it when a curated-only filter is active", () => {
    expect(shouldFetchOsm(0, true, true)).toBe(false);
  });
});
