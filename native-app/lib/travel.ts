import { api } from "./api";

// ---------------------------------------------------------------------------
// Travel — FULLY NATIVE. The hotel funnel (deals → city results → property
// detail → checkout → confirmation) runs as native Expo Router screens against
// the same furlpay.com/api the web app uses. No browser hand-off, no session
// code in a URL: the native app is already authenticated (Bearer from the
// Keystore), so every /api/travel call carries the user's session and a
// completed booking lands in their My Trips.
//
// Types mirror apps/web/src/lib/travel/data.ts so the native cards render the
// exact same inventory the web funnel does.
// ---------------------------------------------------------------------------

export type StayType = "Hotel" | "Resort" | "Villa" | "Apartment" | "Hostel";

export interface Stay {
  id: string;
  name: string;
  brand: string;
  city: string;
  country: string;
  type: StayType;
  stars: number;
  rating: number; // /5
  reviews: number;
  nightlyUsd: number;
  image: string; // gradient token (fallback)
  photo?: string; // real property/city photo
  amenities: string[];
  roomsLeft: number;
  freeCancellation: boolean;
  eco: boolean;
}

export interface Deal {
  id: string;
  city: string;
  country: string;
  name: string;
  stars: number;
  nightlyUsd: number;
  discountPct: number;
  payToken: "USDC" | "SOL" | "BTC";
  photo: string;
}

export interface HotelCollection {
  city: string;
  country: string;
  hotels: Stay[];
}

export interface HotelsResponse {
  city?: string;
  count: number;
  hotels?: Stay[];
  collections?: HotelCollection[];
  source: string;
}

export interface Room {
  name: string;
  multiplier: number;
  cancellable: boolean;
  nightlyUsd: number;
  nightlyUsdc: number;
  nightlySol: number;
}

export interface PropertyDetail {
  property: Stay;
  rooms: Room[];
  cashbackPct: number;
  rateLockMinutes: number;
  source: string;
}

export type TripStatus = "confirmed" | "pending" | "cancelled";

export interface Trip {
  id: string;
  name: string;
  city: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  amountUsd: number;
  method: string;
  status: TripStatus;
  cashbackUsd: number;
}

export interface TripsResponse {
  upcoming: Trip[];
  past: Trip[];
  cancelled: Trip[];
}

export interface BookingAuthorization {
  route: "travala" | "legacy";
  amountUsd: number;
  x402?: { proof: string; network: string; token: string };
  card?: { last4: string; mcc: string[]; singleUse: boolean; limitUsd: number };
  cashbackUsd: number;
  rebate?: { totalUsd: number; developerUsd: number; treasuryUsd: number };
  simulated: boolean;
}

/** The server's authoritative price breakdown (mirrors quoteStay on the server).
 *  When present, the client DISPLAYS these figures — it never recomputes the
 *  charge. */
export interface StayQuote {
  subtotalUsd: number;
  taxesUsd: number;
  cashbackUsd: number;
  totalUsd: number;
}

export interface BookResult {
  booking: {
    id: string;
    reference: string;
    status: string;
    amountUsd: number; // server-decided; the amount actually booked
    quote: StayQuote | null;
    source: "travala" | "legacy";
    authorization: BookingAuthorization;
    trip: Trip;
  };
}

// Display-only FX (mirrors RATES in apps/web/src/lib/travel/data.ts). The
// authoritative charge is always the USD total the server books.
export const TRAVEL_RATES = { USDC: 1, XSGD: 1 / 0.78, SOL: 1 / 175, BTC: 1 / 96000 } as const;
export const CASHBACK_RATE = 0.02;

/** Checkout price ESTIMATE. Mirrors the server's quoteStay
 *  (apps/web/src/lib/travel/data.ts) field-for-field so the pre-payment display
 *  matches the amount the server will actually charge — but this is only a
 *  display estimate; booking.amountUsd / booking.quote from the server are
 *  authoritative. A parity test guards both sides. Shape matches StayQuote. */
export function quoteStay(subtotalUsd: number): StayQuote {
  const subtotal = Math.round(subtotalUsd * 100) / 100;
  const taxesUsd = Math.round(subtotal * 0.1 * 100) / 100;
  const cashbackUsd = Math.round((subtotal + taxesUsd) * CASHBACK_RATE * 100) / 100;
  const totalUsd = Math.round((subtotal + taxesUsd - cashbackUsd) * 100) / 100;
  return { subtotalUsd: subtotal, taxesUsd, cashbackUsd, totalUsd };
}

export const CASHBACK_PCT = 2;
export const RATE_LOCK_MINUTES = 15;

/**
 * Room options for a stay, derived from its base nightly rate. Mirrors the
 * server's deriveRooms (apps/web/src/lib/travel/data.ts) EXACTLY — same names,
 * multipliers and rounding — so the room the user picks here is the same room
 * (and rate) the server re-derives at book time from propertyId + roomIndex.
 * A parity test guards both sides. This lets the property screen render from
 * the stay it already has (the hotels list), with no extra round-trip and no
 * dependence on the server being able to re-resolve the id.
 */
export function deriveRooms(stay: Stay): Room[] {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return [
    { name: "Standard Room", multiplier: 1, cancellable: stay.freeCancellation },
    { name: "Deluxe King Room", multiplier: 1.25, cancellable: true },
    { name: `${stay.type === "Resort" ? "Ocean" : "City"} View Suite`, multiplier: 1.7, cancellable: true },
  ].map((r) => {
    const nightlyUsd = round2(stay.nightlyUsd * r.multiplier);
    return { ...r, nightlyUsd, nightlyUsdc: nightlyUsd, nightlySol: round2(nightlyUsd * TRAVEL_RATES.SOL) };
  });
}

export function fetchDeals(): Promise<{ deals: Deal[] }> {
  return api<{ deals: Deal[] }>("/travel/deals");
}

export function fetchTrips(): Promise<TripsResponse> {
  return api<TripsResponse>("/travel/trips");
}

/** Top-rated 4–5★ stays for a city (live Duffel Stays when the key is set,
 *  deterministic demo inventory otherwise). */
export function fetchHotels(city: string): Promise<HotelsResponse> {
  return api<HotelsResponse>(`/travel/hotels?city=${encodeURIComponent(city)}`);
}

/** Full property detail + room options. The city that produced the id must be
 *  supplied so the server can re-derive the same deterministic property. */
export function fetchProperty(id: string, city: string): Promise<PropertyDetail> {
  return api<PropertyDetail>(`/travel/property/${encodeURIComponent(id)}?city=${encodeURIComponent(city)}`);
}

export interface BookInput {
  source: "travala" | "legacy";
  name: string;
  city: string;
  image?: string;
  nights: number;
  guests: number;
  method: string;
  reference?: string;
  /** Server re-derives the price from these — the authoritative path. */
  propertyId?: string;
  roomIndex?: number;
  /** Fallback subtotal when there's no propertyId; the server still owns the
   *  total (taxes/cashback) computed from it. Never a client-decided total. */
  subtotalUsd?: number;
  /** Stable per-attempt id: the server dedupes retries/double-taps/timeouts on
   *  this so a booking is created at most once. */
  idempotencyKey: string;
}

/** Authorize a booking and record it as a trip owned by the signed-in user.
 *  The amount charged is decided and returned by the SERVER (booking.amountUsd
 *  / booking.quote); this client submits identifiers, not a total. */
export function bookStay(input: BookInput): Promise<BookResult> {
  return api<BookResult>("/travel/book", { method: "POST", body: input });
}
