import { describe, expect, it } from "vitest";
import { parseQuery } from "../travelParse";

const YEAR = new Date().getFullYear();

describe("parseQuery — the sidepanel NL hotel parser", () => {
  it("parses the canonical example end-to-end", () => {
    const q = parseQuery("Find me a hotel in Tokyo under $150/night for July 20-23");
    expect(q.city).toBe("Tokyo");
    expect(q.maxNightlyUsd).toBe(150);
    expect(q.checkIn).toBe(`${YEAR}-07-20`);
    expect(q.checkOut).toBe(`${YEAR}-07-23`);
  });

  it("extracts multi-word and accented cities", () => {
    expect(parseQuery("hotels in New York under 300").city).toBe("New York");
    expect(parseQuery("stay in São Paulo for August 1-4").city).toBe("São Paulo");
  });

  it("supports to/at prepositions and trailing punctuation", () => {
    expect(parseQuery("trip to Lisbon!").city).toBe("Lisbon");
    expect(parseQuery("book me something at Barcelona, please").city).toBe("Barcelona");
  });

  it("price caps accept under/below/max/less-than with or without $", () => {
    expect(parseQuery("in Rome under $90").maxNightlyUsd).toBe(90);
    expect(parseQuery("in Rome below 120").maxNightlyUsd).toBe(120);
    expect(parseQuery("in Rome max $2000").maxNightlyUsd).toBe(2000);
    expect(parseQuery("in Rome less than 75").maxNightlyUsd).toBe(75);
  });

  it("date ranges accept -, to, and – separators, zero-padded", () => {
    expect(parseQuery("in Kyoto for september 5-9").checkIn).toBe(`${YEAR}-09-05`);
    expect(parseQuery("in Kyoto for December 1 to 3").checkOut).toBe(`${YEAR}-12-03`);
    expect(parseQuery("in Kyoto for march 28–30").checkIn).toBe(`${YEAR}-03-28`);
  });

  // Documented limitations (the audit's G7): these SHOULD parse but do not —
  // pinned so anyone upgrading to backend-Gemini parsing knows the baseline.
  it("KNOWN LIMIT: lowercase city names are not recognized", () => {
    expect(parseQuery("hotels in tokyo under 150").city).toBeUndefined();
  });

  it("KNOWN LIMIT: relative dates are not recognized", () => {
    const q = parseQuery("hotels in Paris next week");
    expect(q.checkIn).toBeUndefined();
  });

  it("returns all-undefined on unrelated text (caller must prompt for city)", () => {
    const q = parseQuery("what is the weather like");
    expect(q.city).toBeUndefined();
    expect(q.maxNightlyUsd).toBeUndefined();
  });
});
