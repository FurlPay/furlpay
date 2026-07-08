import { CITY_COORDS, Flight, Stay, StayType, CarRental, CarCategory, carModelPhoto, nights as nightsBetween } from "./data";

// Live flight search via Duffel (mid-2026 the one self-serve top-tier supplier:
// Amadeus Self-Service sunsets 2026-07-17, Kiwi Tequila is closed to new
// partners). Free duffel_test_ tokens return sandbox offers with the exact
// production schema, so the UI renders real API data end-to-end.
// Returns null when no key is set or the request fails — callers fall back to
// the deterministic demo generator so search never breaks.

const BASE = process.env.DUFFEL_API_BASE || "https://api.duffel.com";

const CABIN_MAP: Record<Flight["cabin"], string> = {
  Economy: "economy",
  Premium: "premium_economy",
  Business: "business",
  First: "first",
};

function hhmm(iso?: string): string {
  const m = String(iso ?? "").match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "—";
}

function minutesBetween(a?: string, b?: string): number {
  const start = Date.parse(a ?? "");
  const end = Date.parse(b ?? "");
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

// Duffel durations are ISO 8601 (e.g. "PT8H10M"). Departure/arrival timestamps
// are local wall-clock times, so subtracting them silently drops the timezone
// shift (LHR→JFK would show ~3h instead of ~8h) — always prefer the duration
// field and only fall back to timestamp math when it's absent.
function iso8601Minutes(duration?: string): number {
  const m = String(duration ?? "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

export async function searchDuffelFlights(
  from: string,
  to: string,
  date: string,
  cabin: Flight["cabin"] = "Economy",
): Promise<Flight[] | null> {
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey || !from || !to || !date) return null;
  try {
    const res = await fetch(`${BASE}/air/offer_requests?return_offers=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          slices: [{ origin: from.toUpperCase(), destination: to.toUpperCase(), departure_date: date }],
          passengers: [{ type: "adult" }],
          cabin_class: CABIN_MAP[cabin] ?? "economy",
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const offers: any[] = json?.data?.offers ?? [];
    if (!offers.length) return null;
    return offers
      .map((o): Flight => {
        const slice = o?.slices?.[0] ?? {};
        const segments: any[] = slice.segments ?? [];
        const first = segments[0] ?? {};
        const last = segments[segments.length - 1] ?? {};
        const stops = Math.max(0, segments.length - 1);
        const durationMin =
          iso8601Minutes(slice.duration) ||
          segments.reduce((sum, s) => sum + iso8601Minutes(s?.duration), 0) ||
          minutesBetween(first.departing_at, last.arriving_at);
        return {
          id: String(o.id ?? ""),
          carrier: String(o.owner?.name ?? "Airline"),
          carrierCode: String(o.owner?.iata_code ?? "XX"),
          from: from.toUpperCase().slice(0, 3),
          to: to.toUpperCase().slice(0, 3),
          date: String(first.departing_at ?? date).slice(0, 10),
          departTime: hhmm(first.departing_at),
          arriveTime: hhmm(last.arriving_at),
          durationMin,
          stops,
          cabin,
          logoUrl: o.owner?.logo_symbol_url ?? undefined,
          // Duffel prices in the offer currency; test mode may not be USD —
          // we surface the numeric amount as-is (display layer owns FX).
          priceUsd: Math.round(Number(o.total_amount ?? 0) * 100) / 100,
          baggage: stops === 0 ? "1 carry-on + 1 checked" : "1 carry-on",
        };
      })
      .sort((a, b) => a.priceUsd - b.priceUsd)
      .slice(0, 10);
  } catch {
    return null;
  }
}

// ── Duffel Stays: live hotels with real property photos ─────────────────────

const GRADIENT_FALLBACK = [
  "from-sky-500/40 to-indigo-600/40",
  "from-fuchsia-500/40 to-purple-700/40",
  "from-emerald-500/40 to-teal-700/40",
  "from-amber-500/40 to-orange-700/40",
  "from-rose-500/40 to-pink-700/40",
];

function toStayType(raw?: string): StayType {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("resort")) return "Resort";
  if (t.includes("villa")) return "Villa";
  if (t.includes("apart")) return "Apartment";
  if (t.includes("hostel")) return "Hostel";
  return "Hotel";
}

/**
 * Live accommodation search via Duffel Stays (same token as flights).
 * Returns null when no key, unknown city, or any failure — callers fall back
 * to the demo generator. Each result carries a real property photo.
 */
export async function searchDuffelStays(
  city: string,
  checkIn?: string,
  checkOut?: string,
  guests = 2,
): Promise<Stay[] | null> {
  const apiKey = process.env.DUFFEL_API_KEY;
  const coords = CITY_COORDS[city];
  if (!apiKey || !coords) return null;
  const inDate = checkIn || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const outDate = checkOut || new Date(Date.now() + 33 * 86_400_000).toISOString().slice(0, 10);
  const n = nightsBetween(inDate, outDate);
  try {
    const res = await fetch(`${BASE}/stays/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          check_in_date: inDate,
          check_out_date: outDate,
          rooms: 1,
          guests: Array.from({ length: Math.max(1, Math.min(guests, 4)) }, () => ({ type: "adult" })),
          location: {
            radius: 15,
            geographic_coordinates: { latitude: coords.lat, longitude: coords.lng },
          },
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const results: any[] = json?.data?.results ?? [];
    if (!results.length) return null;
    return results
      .map((r, i): Stay => {
        const a = r?.accommodation ?? r ?? {};
        const total = Number(r?.cheapest_rate_total_amount ?? a?.cheapest_rate_total_amount ?? 0);
        const stars = Math.max(1, Math.min(5, Math.round(Number(a.rating ?? 4)))); // Duffel rating = star class
        const review = Number(a.review_score); // /10 → /5
        return {
          id: String(a.id ?? `duffel_${i}`),
          name: String(a.name ?? "Hotel"),
          brand: String(a.chain?.name ?? "Independent"),
          city,
          country: String(a.location?.address?.country_code ?? "—"),
          type: toStayType(a.type ?? a.name),
          stars,
          rating: isFinite(review) && review > 0 ? Math.round((review / 2) * 10) / 10 : 4.5,
          reviews: Number(a.review_count ?? 0),
          nightlyUsd: Math.round((total / Math.max(1, n)) * 100) / 100,
          image: GRADIENT_FALLBACK[i % GRADIENT_FALLBACK.length],
          photo: a.photos?.[0]?.url ?? undefined,
          amenities: (a.amenities ?? []).slice(0, 5).map((x: any) => String(x?.description ?? x?.type ?? "")).filter(Boolean),
          roomsLeft: 5,
          freeCancellation: false,
          eco: false,
        };
      })
      .filter((s) => s.nightlyUsd > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 16);
  } catch {
    return null;
  }
}

// ── Duffel Cars: live rentals across 40+ brands (launched April 2026) ───────
//
// Same token and conventions as flights/stays: null on missing key, unknown
// city or any failure — callers fall back to the demo generator. Duffel does
// not document the full rate schema publicly, so the mapper reads every field
// defensively and drops rates it can't price.

// Quotes move with supplier inventory; cache briefly so paging/filtering the
// same search doesn't burn through the API quota. 60s TTL per (city, dates).
const CARS_CACHE_TTL_MS = 60_000;
const g = globalThis as unknown as { __duffelCarsCache?: Map<string, { at: number; cars: CarRental[] }> };
const carsCache = (): Map<string, { at: number; cars: CarRental[] }> => (g.__duffelCarsCache ??= new Map());

function toCarCategory(raw?: string): CarCategory {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("suv") || t.includes("crossover")) return "SUV";
  if (t.includes("lux") || t.includes("premium") || t.includes("executive")) return "Luxury";
  if (t.includes("van") || t.includes("mini") && t.includes("bus") || t.includes("people")) return "Van";
  if (t.includes("econ") || t.includes("mini") || t.includes("small")) return "Economy";
  return "Compact";
}

function toFuel(raw?: string): CarRental["fuel"] {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("elect") || t === "ev") return "Electric";
  if (t.includes("hybrid")) return "Hybrid";
  if (t.includes("diesel")) return "Diesel";
  return "Petrol";
}

export async function searchDuffelCars(
  city: string,
  pickUp?: string,
  dropOff?: string,
): Promise<CarRental[] | null> {
  const apiKey = process.env.DUFFEL_API_KEY;
  const coords = CITY_COORDS[city];
  if (!apiKey || !coords) return null;
  const pickDate = pickUp || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const dropDate = dropOff || new Date(Date.parse(pickDate) + 3 * 86_400_000).toISOString().slice(0, 10);
  const days = Math.max(1, nightsBetween(pickDate, dropDate));

  const cacheKey = `${city}:${pickDate}:${dropDate}`;
  const hit = carsCache().get(cacheKey);
  if (hit && Date.now() - hit.at < CARS_CACHE_TTL_MS) return hit.cars;

  try {
    const res = await fetch(`${BASE}/cars/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          pickup_date: pickDate,
          pickup_time: "10:00",
          dropoff_date: dropDate,
          dropoff_time: "10:00",
          pickup_location: {
            radius: 10,
            geographic_coordinates: { latitude: coords.lat, longitude: coords.lng },
          },
          dropoff_location: {
            radius: 10,
            geographic_coordinates: { latitude: coords.lat, longitude: coords.lng },
          },
          driver: { age: 30, residence_country_code: "US" },
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const rates: any[] = json?.data?.results ?? json?.data?.rates ?? json?.data ?? [];
    if (!Array.isArray(rates) || !rates.length) return null;

    const cars = rates
      .map((r, i): CarRental => {
        const v = r?.vehicle ?? r?.car ?? {};
        const name = String(v.name ?? v.model ?? "Rental car");
        // "Toyota RAV4 or similar" → make "Toyota", model "RAV4 or similar"-trimmed
        const cleaned = name.replace(/\s+or similar.*$/i, "").trim();
        const [make, ...rest] = cleaned.split(" ");
        const total = Number(r?.total_amount ?? r?.price?.amount ?? 0);
        const transmission = String(v.transmission ?? "").toLowerCase().includes("man") ? "Manual" : "Automatic";
        return {
          id: String(r.id ?? `duffel_car_${i}`),
          make: make || "Rental",
          model: rest.join(" ") || "car",
          category: toCarCategory(v.category ?? v.class ?? v.acriss_code),
          seats: Number(v.seats ?? 5) || 5,
          doors: Number(v.doors ?? 4) || 4,
          transmission,
          fuel: toFuel(v.fuel_type ?? v.fuel),
          dailyUsd: Math.round((total / days) * 100) / 100,
          supplier: String(r?.supplier?.name ?? r?.vendor?.name ?? "Rental partner"),
          supplierRating: Number(r?.supplier?.rating ?? 8.5) || 8.5,
          freeCancellation: String(r?.payment_type ?? "").toLowerCase() !== "prepaid",
          unlimitedMileage: Boolean(r?.unlimited_mileage ?? String(r?.mileage?.type ?? "").includes("unlimited")),
          insurance: r?.insurance_included ? "Full cover" : "Basic",
          image: GRADIENT_FALLBACK[i % GRADIENT_FALLBACK.length],
          // Supplier photo when present; else our hand-verified model photo.
          photo: v.photo_url ?? v.image_url ?? carModelPhoto(cleaned),
        };
      })
      .filter((c) => c.dailyUsd > 0)
      .sort((a, b) => a.dailyUsd - b.dailyUsd)
      .slice(0, 18);

    if (!cars.length) return null;
    carsCache().set(cacheKey, { at: Date.now(), cars });
    return cars;
  } catch {
    return null;
  }
}
