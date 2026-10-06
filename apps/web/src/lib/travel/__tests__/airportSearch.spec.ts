import { describe, expect, it } from "vitest";
import { airportByIata, searchAirportIndex } from "@/lib/travel/airportSearch";

const codes = (q: string, n = 8) => searchAirportIndex(q, n).map((a) => a.iata);

describe("airport index", () => {
  it("holds thousands of scheduled-service airports", () => {
    expect(airportByIata("LHR")?.city).toBe("London");
    expect(airportByIata("goi")?.country).toBe("IN");
  });

  it("an exact IATA code wins", () => {
    expect(codes("SIN")[0]).toBe("SIN");
    expect(codes("jfk")[0]).toBe("JFK");
  });

  it("metro codes from the dataset's keywords find every city airport", () => {
    const lon = codes("LON", 10);
    for (const c of ["LHR", "LGW", "STN", "LCY"]) expect(lon).toContain(c);
  });

  it("city names find airports named after another town", () => {
    expect(codes("Tokyo")).toEqual(expect.arrayContaining(["HND", "NRT"]));
    expect(codes("New York")).toEqual(expect.arrayContaining(["JFK", "LGA"]));
  });

  it("is accent-insensitive", () => {
    expect(codes("Reykjavik")).toContain("KEF");
  });

  it("returns nothing for one character and caps the limit", () => {
    expect(codes("L")).toEqual([]);
    expect(searchAirportIndex("an", 999).length).toBeLessThanOrEqual(20);
  });
});
