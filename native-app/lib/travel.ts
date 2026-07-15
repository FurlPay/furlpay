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

export interface BookResult {
  booking: {
    id: string;
    reference: string;
    status: string;
    amountUsd: number;
    source: "travala" | "legacy";
    authorization: BookingAuthorization;
    trip: Trip;
  };
}

// Display-only FX (mirrors RATES in apps/web/src/lib/travel/data.ts). The
// authoritative charge is always the USD total the server books.
export const TRAVEL_RATES = { USDC: 1, XSGD: 1 / 0.78, SOL: 1 / 175, BTC: 1 / 96000 } as const;
export const CASHBACK_RATE = 0.02;

/** Checkout price math — MUST stay identical to the web checkout
 *  (apps/web/src/app/travel/checkout/page.tsx), so a native booking and a web
 *  booking of the same room authorize the same amount. */
export function quoteStay(roomRateUsd: number): { taxes: number; cashback: number; totalUsd: number } {
  const taxes = Math.round(roomRateUsd * 0.1 * 100) / 100;
  const cashback = Math.round((roomRateUsd + taxes) * CASHBACK_RATE * 100) / 100;
  const totalUsd = Math.round((roomRateUsd + taxes - cashback) * 100) / 100;
  return { taxes, cashback, totalUsd };
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
  amountUsd: number;
  source: "travala" | "legacy";
  name: string;
  city: string;
  image?: string;
  nights: number;
  guests: number;
  method: string;
  reference?: string;
}

/** Authorize a booking and record it as a trip owned by the signed-in user. */
export function bookStay(input: BookInput): Promise<BookResult> {
  return api<BookResult>("/travel/book", { method: "POST", body: input });
}
