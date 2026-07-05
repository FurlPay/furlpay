import crypto from "crypto";
import { NETWORK } from "@/lib/x402";

// ---------------------------------------------------------------------------
// x402 resource registry — the catalog of pay-per-call resources this
// facilitator prices. AI agents discover resources via GET /api/x402/resources,
// quote via GET /api/x402/price, and servers onboard new priced endpoints via
// POST /api/x402/register. In-memory (production: Postgres), seeded with the
// Furlpay resources that already speak x402.
// ---------------------------------------------------------------------------

export interface X402Resource {
  id: string;
  resource: string; // path or absolute URL the 402 protects
  method: string;
  priceUsd: number;
  description: string;
  network: string;
  category: "travel" | "market-data" | "compliance" | "custom";
  registeredAt: string;
  active: boolean;
}

const g = globalThis as unknown as { __x402registry?: Map<string, X402Resource> };
const registry = g.__x402registry ?? (g.__x402registry = seed());

function seed(): Map<string, X402Resource> {
  const m = new Map<string, X402Resource>();
  const seeds: Array<Omit<X402Resource, "id" | "registeredAt" | "active">> = [
    {
      resource: "/api/travel/search",
      method: "GET",
      priceUsd: 0.01,
      description: "Hotel + flight search across 2.2M properties (per query)",
      network: NETWORK,
      category: "travel",
    },
    {
      resource: "/api/travel/book",
      method: "POST",
      priceUsd: 0.25,
      description: "Agentic hotel/flight booking with escrowed USDC settlement",
      network: NETWORK,
      category: "travel",
    },
    {
      resource: "/api/markets/bars",
      method: "GET",
      priceUsd: 0.005,
      description: "OHLCV bars for stocks, ETFs and crypto (per symbol-range)",
      network: NETWORK,
      category: "market-data",
    },
    {
      resource: "/api/compliance/credential",
      method: "POST",
      priceUsd: 0.05,
      description: "Reusable KYC credential verification for agent operators",
      network: NETWORK,
      category: "compliance",
    },
  ];
  for (const s of seeds) {
    const r: X402Resource = {
      ...s,
      id: `res_${crypto.createHash("sha256").update(`${s.method} ${s.resource}`).digest("hex").slice(0, 16)}`,
      registeredAt: new Date().toISOString(),
      active: true,
    };
    m.set(r.id, r);
  }
  return m;
}

export function listResources(): X402Resource[] {
  return [...registry.values()].filter((r) => r.active);
}

export function findResource(resource: string, method = "GET"): X402Resource | undefined {
  const target = resource.replace(/\/+$/, "");
  return listResources().find(
    (r) => r.resource === target && r.method.toUpperCase() === method.toUpperCase()
  );
}

export function registerResource(params: {
  resource: string;
  method: string;
  priceUsd: number;
  description: string;
  category?: X402Resource["category"];
}): { ok: true; resource: X402Resource } | { ok: false; error: string } {
  if (findResource(params.resource, params.method)) {
    return { ok: false, error: "resource_already_registered" };
  }
  const r: X402Resource = {
    id: `res_${crypto.randomBytes(8).toString("hex")}`,
    resource: params.resource.replace(/\/+$/, ""),
    method: params.method.toUpperCase(),
    priceUsd: params.priceUsd,
    description: params.description,
    network: NETWORK,
    category: params.category ?? "custom",
    registeredAt: new Date().toISOString(),
    active: true,
  };
  registry.set(r.id, r);
  return { ok: true, resource: r };
}
