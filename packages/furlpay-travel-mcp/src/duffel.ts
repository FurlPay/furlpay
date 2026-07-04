import { Flight } from "./types";

/**
 * Duffel flight search client (live real-time inventory).
 *
 * Why Duffel, mid-2026: Amadeus Self-Service shuts down 2026-07-17, Kiwi's
 * Tequila is closed to new partners, and the GDS/bedbank giants gate access
 * behind case-by-case commercial review. Duffel is the one top-tier supplier
 * that is genuinely self-serve: a free-forever test mode (Duffel Airways
 * sandbox inventory), transparent pay-as-you-go production pricing
 * (~$3/order), and NDC + GDS + LCC content from 300+ airlines in one
 * JSON API.
 *
 * This client covers the search side only — one-way offer requests mapped to
 * FurlPay Flight quotes. Booking/payment stays on FurlPay rails (x402 or
 * single-use VCN); a later iteration can pass the offer id to Duffel order
 * creation for full ticketing.
 */

const DEFAULT_BASE = "https://api.duffel.com";
const DUFFEL_VERSION = "v2";
const MAX_OFFERS = 10;

export class DuffelClient {
  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl: string = process.env.DUFFEL_API_BASE || DEFAULT_BASE,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  get live(): boolean {
    return Boolean(this.apiKey);
  }

  /** Real-time one-way offers for a route + date, cheapest first. */
  async searchFlights(params: { from: string; to: string; date: string; cabin?: string }): Promise<Flight[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/air/offer_requests?return_offers=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Duffel-Version": DUFFEL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          slices: [
            {
              origin: params.from.toUpperCase(),
              destination: params.to.toUpperCase(),
              departure_date: params.date,
            },
          ],
          passengers: [{ type: "adult" }],
          cabin_class: normalizeCabin(params.cabin),
        },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = json?.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new Error(`Duffel offer request failed: ${detail}`);
    }
    const offers: any[] = json?.data?.offers ?? [];
    return offers
      .map((o) => this.toFlight(o, params))
      .sort((a, b) => a.totalUsd - b.totalUsd)
      .slice(0, MAX_OFFERS);
  }

  private toFlight(offer: any, p: { from: string; to: string; date: string; cabin?: string }): Flight {
    const segment = offer?.slices?.[0]?.segments?.[0];
    return {
      quoteId: String(offer.id ?? ""),
      carrier: String(offer.owner?.iata_code ?? offer.owner?.name ?? "XX"),
      from: p.from.toUpperCase(),
      to: p.to.toUpperCase(),
      date: String(segment?.departing_at ?? p.date).slice(0, 10),
      cabin: String(segment?.passengers?.[0]?.cabin_class ?? normalizeCabin(p.cabin)),
      // NOTE: Duffel prices in the offer's total_currency (test mode may not
      // be USD). We surface the numeric amount; production conversion belongs
      // in the FurlPay pricing layer, not here.
      totalUsd: Number(offer.total_amount ?? 0),
      source: "duffel",
    };
  }
}

function normalizeCabin(cabin?: string): string {
  const c = (cabin ?? "economy").toLowerCase();
  return ["economy", "premium_economy", "business", "first"].includes(c) ? c : "economy";
}
