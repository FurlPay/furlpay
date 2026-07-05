import { CITY_COORDS, Flight, Stay, StayType, nights as nightsBetween } from "./data";

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
