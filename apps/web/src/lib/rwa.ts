import { z } from "zod";
import { SupabaseFunctionMissing, sbRpc, supabaseBackend } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Tokenized real-world-asset index (admin). Reads rwa_asset_snapshots through
// the SQL functions in migration 0033 (aggregation happens in Postgres).
//
// Source: Allium's tokenized-assets dataset, imported from an export by
// scripts/data/import-rwa-snapshot.mjs. Allium's Terms of Service §1.3(iii)
// and §1.11 restrict distributing its datasets/Output beyond what the order
// authorizes, so this index is served to the admin only — never to anonymous
// or ordinary signed-in users.
// ---------------------------------------------------------------------------

export const RWA_SOURCE = "Allium tokenized-assets dataset (export), via rwa_asset_snapshots";

const num = z.union([z.number(), z.string()]).transform((v) => Number(v));
const summarySchema = z.object({
  snapshot_date: z.string().nullable(),
  snapshots: z.array(z.string()),
  total_usd: num,
  deployments: num,
  live_deployments: num,
  products: num,
  issuers: num,
  chains: num,
  by_class: z.array(z.object({ asset_class: z.string(), market_cap_usd: num, deployments: num, products: num })),
  by_type: z.array(z.object({ asset_class: z.string(), asset_type: z.string(), market_cap_usd: num, deployments: num })),
  by_chain: z.array(z.object({ chain: z.string(), market_cap_usd: num, deployments: num, live: num })),
  by_issuer: z.array(z.object({ issuer_name: z.string(), market_cap_usd: num, products: num })),
  top_products: z.array(
    z.object({
      product_name: z.string(),
      issuer_name: z.string(),
      asset_class: z.string(),
      asset_type: z.string(),
      market_cap_usd: num,
      deployments: num,
      live_deployments: num,
      chains: z.array(z.string()).nullable(),
      top_symbol: z.string().nullable(),
    })
  ),
});
export type RwaSummary = z.infer<typeof summarySchema>;

const rowSchema = z.object({
  product_name: z.string(),
  token_symbol: z.string(),
  chain: z.string(),
  issuer_name: z.string(),
  asset_class: z.string(),
  asset_type: z.string(),
  market_cap_usd: num,
});
const searchSchema = z.object({ total: num, total_usd: num, rows: z.array(rowSchema) });
export type RwaSearch = z.infer<typeof searchSchema>;

export const RwaQuery = z.object({
  q: z.string().trim().max(80).optional(),
  assetClass: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  chain: z.string().regex(/^[a-z0-9_-]{2,32}$/).optional(),
  issuer: z.string().trim().min(1).max(200).optional(),
  minUsd: z.coerce.number().min(0).max(1e13).optional(),
  sort: z.enum(["market_cap", "name"]).default("market_cap"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type RwaQuery = z.infer<typeof RwaQuery>;

export type RwaResult<T> = { ok: true; data: T } | { ok: false; reason: string };

function why(e: unknown): string {
  if (e instanceof SupabaseFunctionMissing) return "Migration 0033_rwa_asset_snapshots.sql is not applied.";
  return e instanceof Error ? e.message.slice(0, 160) : "store failed";
}

export async function rwaSummary(): Promise<RwaResult<RwaSummary>> {
  if (supabaseBackend !== "supabase") return { ok: false, reason: "No durable store configured (SUPABASE_URL)." };
  try {
    const s = summarySchema.parse(await sbRpc<unknown>("rwa_summary", {}));
    if (!s.snapshot_date) return { ok: false, reason: "No snapshot imported yet (scripts/data/import-rwa-snapshot.mjs)." };
    return { ok: true, data: s };
  } catch (e) {
    return { ok: false, reason: why(e) };
  }
}

export async function rwaSearch(q: RwaQuery): Promise<RwaResult<RwaSearch>> {
  if (supabaseBackend !== "supabase") return { ok: false, reason: "No durable store configured (SUPABASE_URL)." };
  try {
    const r = await sbRpc<unknown>("rwa_search", {
      p_q: q.q || null,
      p_asset_class: q.assetClass ?? null,
      p_chain: q.chain ?? null,
      p_issuer: q.issuer ?? null,
      p_min_usd: q.minUsd ?? 0,
      p_sort: q.sort,
      p_limit: q.limit,
      p_offset: q.offset,
    });
    return { ok: true, data: searchSchema.parse(r) };
  } catch (e) {
    return { ok: false, reason: why(e) };
  }
}
