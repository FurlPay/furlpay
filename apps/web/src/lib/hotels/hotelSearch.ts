// ---------------------------------------------------------------------------
// The hotel search a reader is composing, and the rules it has to satisfy.
//
// Pure: no React, no DOM, no clock read at module scope. That is what lets the
// bounds below be tested directly rather than through a rendered component.
//
// ── THE BOUNDS ARE THE SERVER'S, NOT INVENTED ──────────────────────────────
// Every limit here is copied from what /api/travel/hotels/price actually
// enforces (see ContextSchema and the date-sanity block in that route):
//
//     adults        1-9          rooms      1-9
//     children      up to 9, each aged 0-17
//     stay          1-99 nights
//     check-in      within 330 days
//     dates         YYYY-MM-DD
//
// They are restated rather than imported because that route is server-only.
// Duplication across a trust boundary is the point: the client refuses early so
// the reader gets a sentence instead of a 400, and the server refuses again
// because a client check is not a control. If the route's limits move, these
// have to move with them — src/components/travel/__tests__ asserts the edges.
// ---------------------------------------------------------------------------

export const MAX_STAY_NIGHTS = 99;
export const MAX_CHECKIN_DAYS_AHEAD = 330;
export const MAX_ADULTS = 9;
export const MAX_ROOMS = 9;
export const MAX_CHILDREN = 9;
export const MAX_CHILD_AGE = 17;

const DAY_MS = 86_400_000;

/**
 * What the bar produces. The date/guest half is exactly `HotelSearchContext`
 * from lib/hotels/pricing, so the value can be handed to the price endpoint
 * without reshaping.
 */
export interface HotelSearch {
  destination: string;
  /** `YYYY-MM-DD`. */
  checkIn: string;
  /** `YYYY-MM-DD`. */
  checkOut: string;
  adults: number;
  /** One age per child, each 0–17 — the shape Duffel wants. */
  children: number[];
  rooms: number;
}

// ── date helpers ───────────────────────────────────────────────────────────
// Date-only values, handled as date-only values. Arithmetic runs in UTC so a
// DST boundary cannot shift a calendar day, while "today" is read from LOCAL
// time because a traveller means their own Tuesday, not UTC's.

export function isoToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function nightsBetween(a: string, b: string): number {
  const from = Date.parse(`${a}T00:00:00Z`);
  const to = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  return Math.round((to - from) / DAY_MS);
}

/**
 * A starting value: tonight through tomorrow, one adult, one room.
 *
 * MUST be called from an effect or an event handler, never during render — it
 * reads the clock, and a server render and a client render can straddle
 * midnight and disagree. Seeding state with it directly is a hydration bug.
 */
export function defaultHotelSearch(destination = ""): HotelSearch {
  const checkIn = addDays(isoToday(), 1);
  return {
    destination,
    checkIn,
    checkOut: addDays(checkIn, 1),
    adults: 2,
    children: [],
    rooms: 1,
  };
}

/**
 * The same checks the price route runs, in the same order.
 *
 * `today` is passed in rather than read here so the caller controls when the
 * clock is consulted; pass `null` before mount to skip only the check that
 * needs it. Returns the message to show, or `null` when the search is valid.
 */
export function validateHotelSearch(v: HotelSearch, today: string | null): string | null {
  if (!v.destination.trim()) return "Choose a destination";

  const nights = nightsBetween(v.checkIn, v.checkOut);
  if (!Number.isFinite(nights)) return "Choose your dates";
  if (nights < 1) return "Check-out must be after check-in";
  if (nights > MAX_STAY_NIGHTS) return `Stay must be ${MAX_STAY_NIGHTS} nights or fewer`;

  if (today) {
    const ahead = nightsBetween(today, v.checkIn);
    if (ahead < 0) return "Check-in cannot be in the past";
    if (ahead > MAX_CHECKIN_DAYS_AHEAD) {
      return `Check-in must be within ${MAX_CHECKIN_DAYS_AHEAD} days`;
    }
  }

  if (v.rooms < 1 || v.rooms > MAX_ROOMS) return `Up to ${MAX_ROOMS} rooms`;
  if (v.adults < 1 || v.adults > MAX_ADULTS) return `Up to ${MAX_ADULTS} adults`;
  if (v.children.length > MAX_CHILDREN) return `Up to ${MAX_CHILDREN} children`;
  if (v.children.some((a) => a < 0 || a > MAX_CHILD_AGE)) return "Check the children's ages";
  // A room with no adult in it cannot be booked.
  if (v.rooms > v.adults) return "Each room needs at least one adult";

  return null;
}
