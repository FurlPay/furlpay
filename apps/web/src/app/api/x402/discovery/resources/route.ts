import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { listResourcesRanked } from "@/lib/x402Registry";
import { PAY_TO, USDC_ASSET, X402_VERSION } from "@/lib/x402";
import { SITE } from "@/lib/seo/schema";

export const dynamic = "force-dynamic";

// GET /api/x402/discovery/resources — x402 "Bazaar" discovery layer.
//
// The Bazaar (https://docs.cdp.coinbase.com/x402/bazaar) is the standard
// machine-readable catalog x402 agents and facilitators crawl to find payable
// APIs. Exposing it here — over the same resources served at
// /api/x402/resources — lets real x402 clients auto-discover what Furlpay sells
// and how to pay for it, without any Furlpay-specific integration. Shape follows
// the Bazaar /discovery/resources contract: { x402Version, items[], pagination }.
//
// Networks are advertised as CAIP-2 identifiers (x402 v2), falling back to the
// raw network name for chains without a known mapping.
const CAIP2: Record<string, string> = {
  arbitrum: "eip155:42161",
  "arbitrum-sepolia": "eip155:421614",
  base: "eip155:8453",
  // Solana mainnet-beta genesis hash per CAIP-2.
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const QUOTE_TIMEOUT_SECONDS = 300;

function clampInt(v: string | null, def: number, min: number, max: number): number {
  // An absent param must fall back to the default. Number(null)/Number("") are
  // 0 (finite), so guard the empty case explicitly before the finite check.
  if (v === null || v.trim() === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.discovery.resources", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  // Per-host-diversified order (Attack IV E2) so no single registrant can
  // dominate the shortlist an agent sees.
  const all = listResourcesRanked();
  const limit = clampInt(req.nextUrl.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInt(req.nextUrl.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  const items = all.slice(offset, offset + limit).map((r) => {
    const absolute = r.resource.startsWith("http") ? r.resource : `${SITE}${r.resource}`;
    const amountAtomic = String(Math.round(r.priceUsd * 1e6)); // USDC has 6 decimals
    const network = CAIP2[r.network] ?? r.network;
    return {
      resource: absolute,
      type: "http",
      x402Version: X402_VERSION,
      // Full x402 PaymentRequirements-shaped entries. `amount` is included
      // alongside `maxAmountRequired` for readers that use the simplified Bazaar
      // field name (spec/impl still diverge on this, per coinbase/x402#1176).
      accepts: [
        {
          scheme: "exact",
          network,
          maxAmountRequired: amountAtomic,
          amount: amountAtomic,
          resource: absolute,
          description: r.description,
          mimeType: "application/json",
          payTo: PAY_TO,
          maxTimeoutSeconds: QUOTE_TIMEOUT_SECONDS,
          asset: USDC_ASSET,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
      lastUpdated: r.registeredAt,
      metadata: {
        description: r.description,
        method: r.method,
        category: r.category,
      },
    };
  });

  return NextResponse.json(
    {
      x402Version: X402_VERSION,
      items,
      pagination: { limit, offset, total: all.length },
    },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
