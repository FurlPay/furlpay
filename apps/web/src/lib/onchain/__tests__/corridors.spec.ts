import { describe, it, expect } from "vitest";
import { arcPath, cleanCorridors, corridorShare, countryName, countryTotals, flag } from "../corridors";

const rows = [
  { from: "US", to: "BR", volumeUsd: 300 },
  { from: "US", to: "IN", volumeUsd: 100 },
  { from: "SG", to: "IN", volumeUsd: 100 },
  { from: "US", to: "BR", volumeUsd: 50 }, // duplicate row merges
  { from: "BR", to: "BR", volumeUsd: 20 }, // domestic
  { from: "us", to: "BR", volumeUsd: 999 }, // malformed code
  { from: "US", to: "MX", volumeUsd: 0 }, // zero
  { from: "US", to: "NG", volumeUsd: Number.NaN },
];

describe("cleanCorridors", () => {
  it("merges duplicates, drops malformed or empty rows, sorts by volume", () => {
    expect(cleanCorridors(rows)).toEqual([
      { from: "US", to: "BR", volumeUsd: 350 },
      { from: "SG", to: "IN", volumeUsd: 100 },
      { from: "US", to: "IN", volumeUsd: 100 },
      { from: "BR", to: "BR", volumeUsd: 20 },
    ]);
  });
});

describe("countryTotals", () => {
  const t = Object.fromEntries(countryTotals(rows).map((c) => [c.code, c]));
  it("splits inbound and outbound per country", () => {
    expect(t.US).toMatchObject({ outboundUsd: 450, inboundUsd: 0, touchedUsd: 450, corridors: 2 });
    expect(t.IN).toMatchObject({ inboundUsd: 200, outboundUsd: 0, corridors: 2 });
  });
  it("counts a domestic corridor once, not twice", () => {
    expect(t.BR).toMatchObject({ inboundUsd: 370, outboundUsd: 20, touchedUsd: 370, corridors: 2 });
  });
  it("never invents a country the rows do not name", () => {
    expect(Object.keys(t).sort()).toEqual(["BR", "IN", "SG", "US"]);
  });
});

describe("corridorShare", () => {
  it("is a share of the listed corridors and sums to one", () => {
    const list = cleanCorridors(rows);
    expect(list.reduce((n, c) => n + corridorShare(rows, c), 0)).toBeCloseTo(1, 10);
    expect(corridorShare(rows, list[0])).toBeCloseTo(350 / 570, 10);
    expect(corridorShare([], { from: "US", to: "BR", volumeUsd: 1 })).toBe(0);
  });
});

describe("presentation helpers", () => {
  it("names countries and builds flags from ISO codes only", () => {
    expect(countryName("BR")).toBe("Brazil");
    expect(flag("BR")).toBe("\u{1F1E7}\u{1F1F7}");
    expect(flag("br")).toBe("");
    expect(flag("BRA")).toBe("");
  });
  it("draws an arc that rises above both endpoints", () => {
    const d = arcPath([10, 50], [110, 60]);
    const qy = Number(d.split("Q")[1].split(" ")[0].split(",")[1]);
    expect(qy).toBeLessThan(50);
    expect(d.startsWith("M10,50")).toBe(true);
  });
});
