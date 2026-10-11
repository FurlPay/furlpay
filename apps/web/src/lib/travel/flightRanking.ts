// ---------------------------------------------------------------------------
// Flight ranking: "Best", "Cheapest", "Fastest".
//
// The search used to sort by price and keep the first ten, so a fare $10
// cheaper with a 14-hour overnight connection outranked the nonstop, and any
// better trade-off past the tenth-cheapest offer was discarded before anyone
// saw it. Ranking now runs over the WHOLE offer set first.
//
// "Best" is a weighted geometric mean of utilities in [0, 1], each relative to
// the other offers in the same search (there is no external "route median"
// here, so nothing is compared against a number we did not observe):
//
//   price     cheapest / this                           (weight 0.50)
//   duration  exp(-0.8 · (this − fastest) / fastest)    (weight 0.25)
//   stops     per leg: 1.0 nonstop, 0.85 one stop,      (weight 0.15)
//             0.65 two or more, × layover quality
//   schedule  departures 00:00–05:59 score 0.85          (weight 0.10)
//
// Layover quality: under 45 min risks a missed connection (0.6); 45–74 min
// 0.9; 75–150 min ideal (1.0); longer decays 0.25%/min to a 0.5 floor.
//
// Deliberately NOT in the score: cashback. Travel rewards are not live, and a
// ranking must not be bent by a benefit nobody receives yet.
//
// Prices in different currencies are never compared with each other: price
// utility is computed within each currency group.
// ---------------------------------------------------------------------------

import type { Flight, FlightLeg } from "@/lib/travel/data";

export type FlightSort = "best" | "cheapest" | "fastest";

export const WEIGHTS = { price: 0.5, duration: 0.25, stops: 0.15, schedule: 0.1 } as const;

export function layoverQuality(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 1;
  if (minutes < 45) return 0.6;
  if (minutes < 75) return 0.9;
  if (minutes <= 150) return 1;
  return Math.max(0.5, 1 - 0.0025 * (minutes - 150));
}

function legStopsUtility(leg: Pick<FlightLeg, "stops" | "layovers">): number {
  const base = leg.stops <= 0 ? 1 : leg.stops === 1 ? 0.85 : 0.65;
  return leg.layovers.reduce((u, l) => u * layoverQuality(l.minutes), base);
}

/** Legs to score: the real ones, or a single leg reconstructed from the
 *  summary fields for offers that carry no detail. */
function legsOf(f: Flight): Array<Pick<FlightLeg, "stops" | "layovers" | "departAt">> {
  if (f.legs?.length) return f.legs;
  return [{ stops: f.stops, layovers: [], departAt: `${f.date}T${f.departTime}` }];
}

function departHour(departAt: string): number | null {
  const m = /T(\d{2}):/.exec(departAt);
  return m ? Number(m[1]) : null;
}

export function scheduleUtility(f: Flight): number {
  return legsOf(f).reduce((u, l) => {
    const h = departHour(l.departAt);
    return u * (h !== null && h < 6 ? 0.85 : 1);
  }, 1);
}

export interface ScoreBreakdown {
  price: number;
  duration: number;
  stops: number;
  schedule: number;
  score: number;
}

/** Score every offer against the others in its set. */
export function scoreFlights(flights: Flight[]): Map<string, ScoreBreakdown> {
  const out = new Map<string, ScoreBreakdown>();
  const priced = flights.filter((f) => f.priceUsd > 0);
  const minPrice = new Map<string, number>();
  for (const f of priced) {
    const c = f.currency ?? "";
    minPrice.set(c, Math.min(minPrice.get(c) ?? Infinity, f.priceUsd));
  }
  const durations = flights.map((f) => f.durationMin).filter((d) => d > 0);
  const fastest = durations.length ? Math.min(...durations) : 0;

  for (const f of flights) {
    const cheapest = minPrice.get(f.currency ?? "") ?? 0;
    const price = f.priceUsd > 0 && cheapest > 0 ? cheapest / f.priceUsd : 0;
    const duration = fastest > 0 && f.durationMin > 0 ? Math.exp((-0.8 * (f.durationMin - fastest)) / fastest) : 0;
    const stops = legsOf(f).reduce((u, l) => u * legStopsUtility(l), 1);
    const schedule = scheduleUtility(f);
    const score =
      price > 0 && duration > 0
        ? 100 *
          Math.pow(price, WEIGHTS.price) *
          Math.pow(duration, WEIGHTS.duration) *
          Math.pow(stops, WEIGHTS.stops) *
          Math.pow(schedule, WEIGHTS.schedule)
        : 0;
    out.set(f.id, { price, duration, stops, schedule, score: Math.round(score * 10) / 10 });
  }
  return out;
}

/** Ranked copy of the set, each flight carrying its `score`. Ties break on
 *  price, then duration, then id, so the order is stable across requests. */
export function rankFlights(flights: Flight[], sort: FlightSort = "best"): Flight[] {
  const scores = scoreFlights(flights);
  const withScore = flights.map((f) => ({ ...f, score: scores.get(f.id)?.score ?? 0 }));
  const tie = (a: Flight, b: Flight) => a.priceUsd - b.priceUsd || a.durationMin - b.durationMin || a.id.localeCompare(b.id);
  const cmp: Record<FlightSort, (a: Flight, b: Flight) => number> = {
    best: (a, b) => (b.score ?? 0) - (a.score ?? 0) || tie(a, b),
    cheapest: (a, b) => a.priceUsd - b.priceUsd || a.durationMin - b.durationMin || a.id.localeCompare(b.id),
    fastest: (a, b) => a.durationMin - b.durationMin || a.priceUsd - b.priceUsd || a.id.localeCompare(b.id),
  };
  return withScore.sort(cmp[sort]);
}

/** Ids of the best, cheapest and fastest offers, for badges. */
export function highlights(flights: Flight[]): { best?: string; cheapest?: string; fastest?: string } {
  if (!flights.length) return {};
  return {
    best: rankFlights(flights, "best")[0]?.id,
    cheapest: rankFlights(flights, "cheapest")[0]?.id,
    fastest: rankFlights(flights, "fastest")[0]?.id,
  };
}
