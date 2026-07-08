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
  host: string; // registrant host (Sybil/diversity key); "self" for own resources
}

// ── Attack IV: discovery-layer defenses ("Five Attacks on x402" §3.4, M6) ──
// The Bazaar discovery layer steers which server an agent pays. Two cheap
// attacks bias it: E1 crafts listing metadata (prompt-injection-style relevance
// gaming) and E2 floods Sybil listings to crowd out honest providers. We defend
// with metadata validation, a per-host registration cap, and per-host diversity
// in the ranked shortlist so no single registrant can dominate discovery.
const MAX_RESOURCES_PER_HOST = 5; // Sybil cap: active listings one host may hold
const MAX_PER_HOST_IN_SHORTLIST = 2; // diversity cap: listings one host in a page

// Listing text that tries to manipulate an LLM agent's selection rather than
// describe a resource. Rejected at registration (E1 metadata manipulation).
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)/i,
  /disregard\s+(the\s+)?(previous|instructions|rules)/i,
  /system\s+prompt|<\/?\s*(system|assistant|user)\s*>/i,
  /you\s+(are|must|should|will|need to)\b/i,
  /\balways\s+(choose|select|prefer|pick|use)\b/i,
  /\b(highest|top)\s+priority\b|prioriti[sz]e\s+this/i,
  /do\s+not\s+(choose|select|use|consider)\s+(other|another|any other)/i,
  /\b(best|cheapest|fastest|only|official|guaranteed|#1)\b.*\b(choice|option|provider|server)\b/i,
];

function hostOf(resource: string): string {
  try {
    return new URL(resource).hostname.toLowerCase();
  } catch {
    return "self"; // relative path → the facilitator's own (trusted) resources
  }
}

/** Reject listing metadata that manipulates agent selection rather than
 *  describing the resource. Returns an error string, or null when clean. */
export function validateMetadata(description: string): string | null {
  for (let i = 0; i < description.length; i++) {
    const c = description.charCodeAt(i);
    // Control chars (except \t \n \r) have no place in a human-readable listing
    // and are a vector for hiding manipulative content from a reviewer.
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) {
      return "description_control_characters";
    }
  }
  for (const re of INJECTION_PATTERNS) {
    if (re.test(description)) return "description_manipulative_content";
  }
  return null;
}

const g = globalThis as unknown as { __x402registry?: Map<string, X402Resource> };
const registry = g.__x402registry ?? (g.__x402registry = seed());

function seed(): Map<string, X402Resource> {
  const m = new Map<string, X402Resource>();
  const seeds: Array<Omit<X402Resource, "id" | "registeredAt" | "active" | "host">> = [
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
      host: hostOf(s.resource),
    };
    m.set(r.id, r);
  }
  return m;
}

export function listResources(): X402Resource[] {
  return [...registry.values()].filter((r) => r.active);
}

/**
 * Discovery shortlist with per-host diversity (Attack IV E2). Preserves the
 * underlying order but caps how many listings any single host may occupy, so a
 * Sybil registrant that slipped past the registration cap still cannot crowd
 * honest providers out of the page an agent actually sees. Overflow from a host
 * is appended after the diversified head only if the page is not yet full.
 */
export function listResourcesRanked(): X402Resource[] {
  const all = listResources();
  const perHost = new Map<string, number>();
  const head: X402Resource[] = [];
  const overflow: X402Resource[] = [];
  for (const r of all) {
    const n = perHost.get(r.host) ?? 0;
    // "self" resources are first-party and exempt from the diversity cap.
    if (r.host === "self" || n < MAX_PER_HOST_IN_SHORTLIST) {
      head.push(r);
      perHost.set(r.host, n + 1);
    } else {
      overflow.push(r);
    }
  }
  return [...head, ...overflow];
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

  // E1: reject metadata that manipulates agent selection.
  const metaError = validateMetadata(params.description);
  if (metaError) return { ok: false, error: metaError };

  // E2: cap active listings per registrant host so one Sybil cannot flood the
  // catalog. First-party ("self") resources are exempt.
  const host = hostOf(params.resource);
  if (host !== "self") {
    const activeForHost = listResources().filter((r) => r.host === host).length;
    if (activeForHost >= MAX_RESOURCES_PER_HOST) {
      return { ok: false, error: "host_registration_limit" };
    }
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
    host,
  };
  registry.set(r.id, r);
  return { ok: true, resource: r };
}
