import { describe, expect, it } from "vitest";
import type { Flight } from "@/lib/travel/data";
import { highlights, layoverQuality, rankFlights, scoreFlights } from "@/lib/travel/flightRanking";

// Fixtures are hand-written offers for the ranking maths only.
function f(id: string, o: Partial<Flight> & { layovers?: number[]; departAt?: string } = {}): Flight {
  const stops = o.stops ?? (o.layovers?.length ?? 0);
  const departAt = o.departAt ?? "2026-11-10T09:00:00";
  return {
    id,
    carrier: "Test Air",
    carrierCode: "TA",
    from: "LHR",
    to: "JFK",
    date: departAt.slice(0, 10),
    departTime: departAt.slice(11, 16),
    arriveTime: "17:00",
    durationMin: o.durationMin ?? 480,
    stops,
    cabin: "Economy",
    priceUsd: o.priceUsd ?? 500,
    baggage: "",
    currency: o.currency ?? "USD",
    legs: [
      {
        from: "LHR",
        to: "JFK",
        departAt,
        arriveAt: "2026-11-10T17:00:00",
        durationMin: o.durationMin ?? 480,
        stops,
        segments: [],
        layovers: (o.layovers ?? []).map((m, i) => ({ airport: `X${i}`, minutes: m })),
      },
    ],
  };
}

describe("flight ranking", () => {
  it("does not let a slightly cheaper overnight connection beat the nonstop", () => {
    const nonstop = f("nonstop", { priceUsd: 510, durationMin: 480 });
    const overnight = f("overnight", { priceUsd: 500, durationMin: 480 + 840, layovers: [840] });
    expect(rankFlights([overnight, nonstop], "best")[0].id).toBe("nonstop");
    expect(rankFlights([overnight, nonstop], "cheapest")[0].id).toBe("overnight");
  });

  it("still picks a much cheaper one-stop over an expensive nonstop", () => {
    const nonstop = f("nonstop", { priceUsd: 1400, durationMin: 480 });
    const onestop = f("onestop", { priceUsd: 520, durationMin: 600, layovers: [110] });
    expect(rankFlights([nonstop, onestop], "best")[0].id).toBe("onestop");
  });

  it("penalises tight and long connections, not ideal ones", () => {
    expect(layoverQuality(30)).toBe(0.6);
    expect(layoverQuality(60)).toBe(0.9);
    expect(layoverQuality(120)).toBe(1);
    expect(layoverQuality(400)).toBeCloseTo(0.5, 5);
    expect(layoverQuality(2000)).toBe(0.5);
  });

  it("penalises red-eye departures", () => {
    const day = f("day", { departAt: "2026-11-10T10:00:00" });
    const redeye = f("redeye", { departAt: "2026-11-10T02:30:00" });
    const s = scoreFlights([day, redeye]);
    expect(s.get("redeye")!.schedule).toBe(0.85);
    expect(s.get("day")!.score).toBeGreaterThan(s.get("redeye")!.score);
  });

  it("never compares prices across currencies", () => {
    const usd = f("usd", { priceUsd: 500, currency: "USD" });
    const gbp = f("gbp", { priceUsd: 400, currency: "GBP" });
    const s = scoreFlights([usd, gbp]);
    expect(s.get("usd")!.price).toBe(1);
    expect(s.get("gbp")!.price).toBe(1);
  });

  it("fastest sorts by duration, breaking ties on price", () => {
    const a = f("a", { durationMin: 300, priceUsd: 600 });
    const b = f("b", { durationMin: 300, priceUsd: 550 });
    const c = f("c", { durationMin: 200, priceUsd: 900 });
    expect(rankFlights([a, b, c], "fastest").map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("ranks the full set (nothing truncated) and is stable", () => {
    const set = Array.from({ length: 40 }, (_, i) => f(`o${i}`, { priceUsd: 400 + i * 5, durationMin: 480 + (i % 7) * 30 }));
    const r1 = rankFlights(set).map((x) => x.id);
    const r2 = rankFlights([...set].reverse()).map((x) => x.id);
    expect(r1).toHaveLength(40);
    expect(r1).toEqual(r2);
  });

  it("scores lie in [0, 100] and an unpriced offer scores 0", () => {
    const s = scoreFlights([f("ok"), f("free", { priceUsd: 0 })]);
    expect(s.get("ok")!.score).toBeGreaterThan(0);
    expect(s.get("ok")!.score).toBeLessThanOrEqual(100);
    expect(s.get("free")!.score).toBe(0);
  });

  it("highlights name the best, cheapest and fastest offers", () => {
    const set = [f("cheap", { priceUsd: 300, durationMin: 900, layovers: [300] }), f("fast", { priceUsd: 900, durationMin: 420 }), f("bal", { priceUsd: 420, durationMin: 470 })];
    expect(highlights(set)).toEqual({ best: "bal", cheapest: "cheap", fastest: "fast" });
  });
});
