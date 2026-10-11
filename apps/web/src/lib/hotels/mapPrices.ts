// Prices on the hotel map: the pure parts.
//
// A RATE IS ONLY EVER SHOWN FOR A STAY. Duffel prices a hotel for dates and a
// party; without them there is no price, only a guess. So the map asks for
// rates only once the reader has picked dates, and every label below is the
// per-night figure Duffel quoted for exactly those dates.
//
// WHAT IS NEVER A PRICE ON THE MAP:
//   - sandbox rates (a test token's inventory is not bookable),
//   - an expired quote (Duffel quotes carry their own expiry),
//   - "unavailable" / "error" / "not checked" — each is a different fact, and
//     the card says which; the marker simply carries no price.

import type { MapPoint } from "@/app/api/travel/hotels/map/route";

export interface StayContext {
  checkIn: string;
  checkOut: string;
  adults: number;
}

/** What the map keeps per hotel. Mirrors the stream-rates `rate` event. */
export interface MapRate {
  state: "available" | "sandbox" | "unavailable" | "error" | "not_checked" | "loading";
  perNightAmount?: number;
  totalAmount?: number;
  currency?: string;
  nights?: number;
  fetchedAt?: string;
  expiresAt?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** Same bounds as the rate routes, so the map never asks for a stay they reject. */
export const MAX_STAY_NIGHTS = 99;
export const MAX_CHECKIN_DAYS_AHEAD = 330;

function dayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * The stay in the URL (`?in=2026-11-12&out=2026-11-15&adults=2`), or null.
 *
 * Validated against the same rules the server enforces: check-in today or
 * later, 1-99 nights, within 330 days. Anything else is dropped rather than
 * corrected — silently moving a reader's dates would price a stay they did not
 * ask for.
 */
export function stayFromParams(q: URLSearchParams, todayIso: string): StayContext | null {
  const checkIn = q.get("in") ?? "";
  const checkOut = q.get("out") ?? "";
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) return null;
  return validStay({ checkIn, checkOut, adults: Number(q.get("adults") ?? 2) }, todayIso);
}

export function validStay(s: StayContext, todayIso: string): StayContext | null {
  const inMs = dayMs(s.checkIn);
  const outMs = dayMs(s.checkOut);
  const today = dayMs(todayIso);
  if (![inMs, outMs, today].every(Number.isFinite)) return null;
  const nights = Math.round((outMs - inMs) / DAY_MS);
  if (inMs < today || nights < 1 || nights > MAX_STAY_NIGHTS) return null;
  if (inMs - today > MAX_CHECKIN_DAYS_AHEAD * DAY_MS) return null;
  const adults = Number.isInteger(s.adults) && s.adults >= 1 && s.adults <= 9 ? s.adults : 2;
  return { checkIn: s.checkIn, checkOut: s.checkOut, adults };
}

export function stayKey(s: StayContext | null): string {
  return s ? `${s.checkIn}|${s.checkOut}|${s.adults}` : "";
}

export function nightsOf(s: StayContext): number {
  return Math.round((dayMs(s.checkOut) - dayMs(s.checkIn)) / DAY_MS);
}

/** True once the quote's own expiry has passed. No expiry → not expired. */
export function isExpired(r: MapRate, nowMs: number): boolean {
  if (!r.expiresAt) return false;
  const t = Date.parse(r.expiresAt);
  return Number.isFinite(t) && t <= nowMs;
}

/** A rate that may be drawn as a price: live, numeric, currencied, unexpired. */
export function isShowablePrice(r: MapRate | undefined, nowMs: number): r is MapRate & { perNightAmount: number; currency: string } {
  return (
    !!r &&
    r.state === "available" &&
    typeof r.perNightAmount === "number" &&
    Number.isFinite(r.perNightAmount) &&
    r.perNightAmount > 0 &&
    typeof r.currency === "string" &&
    /^[A-Z]{3}$/.test(r.currency) &&
    !isExpired(r, nowMs)
  );
}

/** "$142", "€1,204", "¥18,400" — whole units, in the quote's own currency. */
export function formatMoney(amount: number, currency: string, locale = "en-US"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    // An ISO code Intl does not know still has to read as money, not vanish.
    return `${currency} ${Math.round(amount).toLocaleString(locale)}`;
  }
}

/** The marker label for a rate, or "" when it must not show a price. */
export function priceLabel(r: MapRate | undefined, nowMs: number, locale = "en-US"): string {
  return isShowablePrice(r, nowMs) ? formatMoney(r.perNightAmount, r.currency, locale) : "";
}

/** The stream route's ceiling — pricing the whole viewport would be thousands
 *  of supplier calls for pins nobody looked at. */
export const MAX_PRICED_PER_VIEW = 30;

/**
 * Which drawn hotels to price: nearest the map centre first, skipping any
 * already holding an unexpired answer for this stay.
 */
export function pricingSubjects(
  points: readonly MapPoint[],
  center: { latitude: number; longitude: number } | null,
  known: ReadonlyMap<string, MapRate>,
  nowMs: number,
  max = MAX_PRICED_PER_VIEW
): MapPoint[] {
  const fresh = (p: MapPoint) => {
    const r = known.get(p.id);
    return r && r.state !== "loading" && !isExpired(r, nowMs);
  };
  const candidates = points.filter((p) => !fresh(p));
  if (!center) return candidates.slice(0, max);
  const d = (p: MapPoint) => {
    const dLat = p.latitude - center.latitude;
    const dLng = (p.longitude - center.longitude) * Math.cos((center.latitude * Math.PI) / 180);
    return dLat * dLat + dLng * dLng;
  };
  return [...candidates].sort((a, b) => d(a) - d(b)).slice(0, max);
}

/**
 * Split a Server-Sent Events buffer into complete events and the unfinished
 * tail. Comments (`: ping`) are dropped; a `data:` line that is not JSON is
 * dropped too — one malformed event must not end the stream.
 */
export function parseSseEvents(buffer: string): { events: Array<{ event: string; data: unknown }>; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: Array<{ event: string; data: unknown }> = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join("\n")) });
    } catch {
      // skip the malformed event, keep the stream
    }
  }
  return { events, rest };
}

/** Normalise one `rate` event into a MapRate, or null if it is not one. */
export function rateFromEvent(data: unknown): { hotelId: string; rate: MapRate } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.hotelId !== "string") return null;
  const states: MapRate["state"][] = ["available", "sandbox", "unavailable", "error", "not_checked"];
  const state = states.includes(d.state as MapRate["state"]) ? (d.state as MapRate["state"]) : "error";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    hotelId: d.hotelId,
    rate: {
      state,
      perNightAmount: num(d.perNightAmount),
      totalAmount: num(d.totalAmount),
      currency: str(d.currency),
      nights: num(d.nights),
      fetchedAt: str(d.fetchedAt),
      expiresAt: str(d.expiresAt),
    },
  };
}
