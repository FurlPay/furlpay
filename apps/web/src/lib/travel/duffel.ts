import { Flight } from "./data";

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
        return {
          id: String(o.id ?? ""),
          carrier: String(o.owner?.name ?? "Airline"),
          carrierCode: String(o.owner?.iata_code ?? "XX"),
          from: from.toUpperCase().slice(0, 3),
          to: to.toUpperCase().slice(0, 3),
          date: String(first.departing_at ?? date).slice(0, 10),
          departTime: hhmm(first.departing_at),
          arriveTime: hhmm(last.arriving_at),
          durationMin: minutesBetween(first.departing_at, last.arriving_at),
          stops,
          cabin,
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
