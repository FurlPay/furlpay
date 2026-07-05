// Price alerts for FurlPay Travels — flights and hotel rates.
//
// Same demo persistence pattern as the trips store: module-level Map on
// globalThis so every API route bundle shares one instance per server process.
// A live build swaps this for the DB keyed per user, and the price feed for
// the Duffel / Travala rate stream.

import { DESTINATIONS, generateFlights } from "@/lib/travel/data";

export type AlertKind = "flight" | "hotel";
export type SuccessBand = "high" | "medium" | "low";

export interface PriceAlert {
  id: string;
  kind: AlertKind;
  /** IATA origin for flights (e.g. "DEL"); unused for hotels. */
  from?: string;
  /** IATA destination for flights, or city name for hotels. */
  to: string;
  date: string; // ISO travel date (flights) or check-in (hotels)
  targetUsd: number;
  currentUsd: number;
  /** Probability the target price is hit before the travel date. */
  successPct: number;
  band: SuccessBand;
  /** Auto-settle from USDC balance the moment the target price is hit. */
  autoBook: boolean;
  status: "watching" | "triggered";
  createdAt: string;
}

const alerts: Map<string, PriceAlert> = ((globalThis as any).__furlpayPriceAlerts ??= new Map<
  string,
  PriceAlert
>());

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic current lowest price for the route/city being watched. */
export function currentLowestUsd(kind: AlertKind, from: string | undefined, to: string, date: string): number {
  if (kind === "flight") {
    const flights = generateFlights(from || "DEL", to, date);
    return flights[0].priceUsd;
  }
  const dest = DESTINATIONS.find((d) => d.name.toLowerCase() === to.toLowerCase());
  if (dest) return dest.avgHotelUsd;
  return 90 + (hash(to.toLowerCase()) % 160);
}

/**
 * Success-rate model: how likely the target lands before the travel date.
 * The demo heuristic blends target-vs-current ratio with days of runway —
 * the live build replaces this with the historical fare-distribution model.
 */
export function scoreTarget(targetUsd: number, currentUsd: number, date: string): { successPct: number; band: SuccessBand } {
  const ratio = targetUsd / currentUsd;
  const daysOut = Math.max(0, Math.round((new Date(date).getTime() - Date.now()) / 86_400_000));
  const runway = Math.min(1, daysOut / 45); // more days watching → more dips to catch
  let pct: number;
  if (ratio >= 1) pct = 0.93;
  else if (ratio >= 0.9) pct = 0.55 + 0.3 * runway;
  else if (ratio >= 0.75) pct = 0.28 + 0.25 * runway;
  else pct = 0.06 + 0.12 * runway;
  const successPct = Math.round(pct * 100);
  const band: SuccessBand = successPct >= 70 ? "high" : successPct >= 40 ? "medium" : "low";
  return { successPct, band };
}

export function createAlert(input: {
  kind: AlertKind;
  from?: string;
  to: string;
  date: string;
  targetUsd: number;
  autoBook: boolean;
}): PriceAlert {
  const currentUsd = currentLowestUsd(input.kind, input.from, input.to, input.date);
  const { successPct, band } = scoreTarget(input.targetUsd, currentUsd, input.date);
  const alert: PriceAlert = {
    id: `alrt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind: input.kind,
    from: input.kind === "flight" ? (input.from || "DEL").toUpperCase().slice(0, 3) : undefined,
    to: input.kind === "flight" ? input.to.toUpperCase().slice(0, 3) : input.to,
    date: input.date,
    targetUsd: Math.round(input.targetUsd * 100) / 100,
    currentUsd,
    successPct,
    band,
    autoBook: input.autoBook,
    status: input.targetUsd >= currentUsd ? "triggered" : "watching",
    createdAt: new Date().toISOString(),
  };
  alerts.set(alert.id, alert);
  return alert;
}

export function listAlerts(): PriceAlert[] {
  return [...alerts.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function deleteAlert(id: string): boolean {
  return alerts.delete(id);
}
