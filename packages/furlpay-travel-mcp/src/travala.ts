import { Flight, Stay } from "./types";

/**
 * Thin client for the Travala Travel MCP (search side of the composition).
 *
 * Travala's Agentic AI Travel Protocol exposes 2.2M+ hotels (Marriott, Hilton,
 * IHG, …) — expanding to flights — to AI agents, settling in gasless USDC over
 * x402 on Base. This wrapper is search-only; payment/settlement is FurlPay's job.
 *
 * With no key set it returns deterministic demo inventory so the whole
 * search → pay → book loop runs offline.
 */

const DEFAULT_MCP = "https://travel-mcp.travala.com/mcp";
const round2 = (n: number) => Math.round(n * 100) / 100;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const HOTEL_BRANDS = ["Marriott", "Hilton", "IHG", "Accor", "Hyatt"];

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(checkIn);
  const b = Date.parse(checkOut);
  if (isNaN(a) || isNaN(b) || b <= a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

export class TravalaClient {
  constructor(
    private readonly url: string = process.env.TRAVALA_MCP_URL || DEFAULT_MCP,
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  get live(): boolean {
    return Boolean(this.apiKey);
  }

  async searchStays(params: {
    city: string;
    checkIn: string;
    checkOut: string;
    maxNightlyUsd?: number;
    guests?: number;
  }): Promise<Stay[]> {
    const nights = nightsBetween(params.checkIn, params.checkOut);
    if (!this.live) return this.demoStays(params, nights);
    try {
      const rows = await this.call("search_stays", { ...params });
      const stays = (rows as any[]).map((r) => normaliseStay(r, params, nights));
      return params.maxNightlyUsd ? stays.filter((s) => s.nightlyUsd <= params.maxNightlyUsd!) : stays;
    } catch {
      return this.demoStays(params, nights);
    }
  }

  async searchFlights(params: { from: string; to: string; date: string }): Promise<Flight[]> {
    if (!this.live) return this.demoFlights(params);
    try {
      const rows = await this.call("search_flights", { ...params });
      return (rows as any[]).map((r) => normaliseFlight(r, params));
    } catch {
      return this.demoFlights(params);
    }
  }

  // -- transport (Travala MCP is JSON-RPC over HTTP) ----------------------

  private async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    });
    if (!res.ok) throw new Error(`Travala MCP HTTP ${res.status}`);
    const json: any = await res.json();
    if (json.error) throw new Error(json.error.message || "Travala MCP error");
    const content = json.result?.content?.[0];
    const text = content?.text ?? "[]";
    return typeof text === "string" ? JSON.parse(text) : text;
  }

  // -- deterministic demo inventory ---------------------------------------

  private demoStays(
    params: { city: string; checkIn: string; checkOut: string; maxNightlyUsd?: number; guests?: number },
    nights: number,
  ): Stay[] {
    const seed = hash(params.city.toLowerCase());
    const stays: Stay[] = Array.from({ length: 5 }, (_, i) => {
      const brand = HOTEL_BRANDS[(seed + i) % HOTEL_BRANDS.length];
      const nightly = round2(80 + ((seed >> (i + 1)) % 260)); // ~$80–$340
      return {
        quoteId: `tvl_demo_${(seed % 0xffff).toString(16)}_${i}`,
        name: `${brand} ${titleCase(params.city)} ${["Central", "Riverside", "Airport", "Old Town", "Bay"][i]}`,
        brand,
        city: titleCase(params.city),
        stars: 3 + (i % 3),
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        nights,
        nightlyUsd: nightly,
        totalUsd: round2(nightly * nights),
        source: "demo" as const,
      };
    });
    return params.maxNightlyUsd ? stays.filter((s) => s.nightlyUsd <= params.maxNightlyUsd!) : stays;
  }

  private demoFlights(params: { from: string; to: string; date: string }): Flight[] {
    const seed = hash(params.from + params.to);
    const carriers = ["BA", "LH", "AF", "EK", "QR"];
    return Array.from({ length: 3 }, (_, i) => ({
      quoteId: `tvlf_demo_${(seed % 0xffff).toString(16)}_${i}`,
      carrier: carriers[(seed + i) % carriers.length],
      from: params.from.toUpperCase(),
      to: params.to.toUpperCase(),
      date: params.date,
      cabin: ["economy", "premium", "business"][i % 3],
      totalUsd: round2(180 + ((seed >> (i + 2)) % 900)),
      source: "demo" as const,
    }));
  }
}

function normaliseStay(r: any, p: { city: string; checkIn: string; checkOut: string }, nights: number): Stay {
  const nightly = Number(r.nightlyUsd ?? r.price ?? 0);
  return {
    quoteId: String(r.quoteId ?? r.id ?? ""),
    name: String(r.name ?? "Hotel"),
    brand: String(r.brand ?? "Independent"),
    city: String(r.city ?? p.city),
    stars: Number(r.stars ?? 3),
    checkIn: p.checkIn,
    checkOut: p.checkOut,
    nights,
    nightlyUsd: nightly,
    totalUsd: Number(r.totalUsd ?? nightly * nights),
    source: "travala",
  };
}

function normaliseFlight(r: any, p: { from: string; to: string; date: string }): Flight {
  return {
    quoteId: String(r.quoteId ?? r.id ?? ""),
    carrier: String(r.carrier ?? "XX"),
    from: p.from.toUpperCase(),
    to: p.to.toUpperCase(),
    date: p.date,
    cabin: String(r.cabin ?? "economy"),
    totalUsd: Number(r.totalUsd ?? r.price ?? 0),
    source: "travala",
  };
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}
