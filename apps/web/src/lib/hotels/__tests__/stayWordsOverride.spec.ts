import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import dataset from "@/data/google-places.json";
import { datasetStats, googlePlacesInBBox } from "../googlePlacesLayer";

// Regression (fixed 2026-10-01): the STAY_WORDS regex had literal backspace
// characters where `\b` belonged (written through a shell heredoc on
// 2026-09-01), so it never matched. Every property whose NAME says it is
// lodging but which Google typed as something else ("Hotel Daffodils" typed
// Store, "… Restaurant & Guesthouse" typed Restaurant) was dropped from the map.
// The older spec only checked guesthouses Google had already typed as lodging,
// which passed without exercising the override at all.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(datasetStats().generatedAt) + 86_400_000);
});
afterAll(() => vi.useRealTimers());

type Rec = { placeId: string; name: string; typeDisplay?: string; businessStatus?: string };
const NOT_LODGING = new Set(["Restaurant", "Store", "Real Estate Agency", "Bar", "Cafe", "Shop"]);
const NAMED_LODGING = /\b(hotel|hostel|guest\s?house|guesthouse|inn|resort|lodge|motel|homestay|villa|apartment|aparthotel|residence)\b/i;
const all = ((dataset as unknown as { properties: Rec[] }).properties ?? []).filter(
  (p) => p.businessStatus !== "CLOSED_PERMANENTLY" && p.businessStatus !== "CLOSED_TEMPORARILY"
);
const WORLD = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 } as never;

describe("a lodging NAME overrides a non-lodging Google type", () => {
  const overridden = all.filter((p) => NOT_LODGING.has(p.typeDisplay ?? "") && NAMED_LODGING.test(p.name));

  it("the dataset contains such records (the test is not vacuous)", () => {
    expect(overridden.length).toBeGreaterThan(5);
  });

  it("every one of them is served", () => {
    const served = new Set(googlePlacesInBBox(WORLD, { limit: 100_000 } as never).map((p) => p.placeId));
    const missing = overridden.filter((p) => !served.has(p.placeId)).map((p) => `${p.typeDisplay} | ${p.name}`);
    expect(missing).toEqual([]);
  });

  it("a non-lodging type without a lodging name is still excluded", () => {
    const served = new Set(googlePlacesInBBox(WORLD, { limit: 100_000 } as never).map((p) => p.placeId));
    const gyms = all.filter((p) => p.typeDisplay === "Gym" && !NAMED_LODGING.test(p.name));
    expect(gyms.some((g) => served.has(g.placeId))).toBe(false);
  });
});
