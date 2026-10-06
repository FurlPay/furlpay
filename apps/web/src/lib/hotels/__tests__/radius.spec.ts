import { describe, expect, it } from "vitest";
import { destination } from "@/lib/geo/geodesy";
import { isRadiusKm, parseRadius, withinRadius } from "../radius";

describe("parseRadius", () => {
  it("accepts a valid centre and an offered radius", () => {
    expect(parseRadius("35.6812,139.7671", "5")).toEqual({ center: { latitude: 35.6812, longitude: 139.7671 }, km: 5 });
  });
  it("rejects radii outside the offered set and malformed centres", () => {
    expect(parseRadius("35.68,139.76", "3")).toBeNull();
    expect(parseRadius("35.68,139.76", "500")).toBeNull();
    expect(parseRadius("35.68,139.76", "-1")).toBeNull();
    expect(parseRadius("35.68", "5")).toBeNull();
    expect(parseRadius("95,139.76", "5")).toBeNull();
    expect(parseRadius("abc,def", "5")).toBeNull();
    expect(parseRadius(null, "5")).toBeNull();
    expect(isRadiusKm(25)).toBe(true);
    expect(isRadiusKm(26)).toBe(false);
  });
});

describe("withinRadius", () => {
  const c = { latitude: 35.6812, longitude: 139.7671 };
  const r = { center: c, km: 5 as const };
  it("includes the centre and points just inside, excludes points just outside", () => {
    expect(withinRadius(c, r)).toBe(true);
    expect(withinRadius(destination(c, 4.99, 45), r)).toBe(true);
    expect(withinRadius(destination(c, 5.01, 200), r)).toBe(false);
  });
  it("never counts an invalid coordinate as inside", () => {
    expect(withinRadius({ latitude: NaN, longitude: 0 }, r)).toBe(false);
  });
});
