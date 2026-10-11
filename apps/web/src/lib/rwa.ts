import { z } from "zod";
import { SupabaseFunctionMissing, sbRpc, supabaseBackend } from "@/lib/supabase";
import { log } from "@/lib/log";
import { alliumKeyConfigured } from "@/lib/onchain/allium";
import { DAY, classify, type SectionFreshness } from "@/lib/onchain/freshness";

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
  imported_at: z.string().nullish(),
  sources: z.array(z.string()).nullish(),
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
export type RwaSummary = z.infer<typeof summarySchema> & { freshness?: SectionFreshness };

/**
 * Freshness of the tokenized-assets view. Without a refresh source it is a
 * point-in-time SNAPSHOT and says so (never "live"); with ALLIUM_RWA_QUERY_ID
 * it is a daily-refreshed source, judged by when today's snapshot was written.
 */
export function rwaFreshness(s: { snapshot_date: string | null; imported_at?: string | null; sources?: string[] | null }, now = Date.now()): SectionFreshness {
  const refresh = alliumKeyConfigured() && Boolean((process.env.ALLIUM_RWA_QUERY_ID ?? "").trim());
  const fromRefresh = (s.sources ?? []).includes("allium_query");
  if (!refresh || !fromRefresh) {
    return {
      state: refresh ? "stale" : "not_connected",
      source: (s.sources ?? []).join(", ") || "snapshot",
      asOf: s.snapshot_date,
      cadence: refresh ? "daily refresh" : "snapshot",
      reason: refresh ? `Daily refresh configured but has not written a snapshot yet; showing ${s.snapshot_date}.` : `Showing the ${s.snapshot_date} snapshot. Set ALLIUM_RWA_QUERY_ID for daily refresh.`,
    };
  }
  return classify({ kind: "polled", cadenceMs: DAY, source: "Allium Explorer (tokenized assets)", cadence: "daily refresh", configured: true, ok: true, asOf: s.imported_at ?? null, now });
}

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

/** A real calendar date (YYYY-MM-DD), or absent for the latest snapshot. */
export const SnapshotDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "invalid date");

export const RwaQuery = z.object({
  q: z.string().trim().max(80).optional(),
  assetClass: z.string().regex(/^[a-z_]{2,40}$/).optional(),
  chain: z.string().regex(/^[a-z0-9_-]{2,32}$/).optional(),
  issuer: z.string().trim().min(1).max(200).optional(),
  minUsd: z.coerce.number().min(0).max(1e13).optional(),
  sort: z.enum(["market_cap", "name"]).default("market_cap"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  snapshot: SnapshotDate.optional(),
});
export type RwaQuery = z.infer<typeof RwaQuery>;

/** not_loaded: migration or snapshot absent (actionable). error: the store failed. */
export type RwaResult<T> = { ok: true; data: T } | { ok: false; kind: "not_loaded" | "error"; reason: string };

/**
 * What the admin sees when the store fails. A missing migration is actionable
 * and says so; anything else is logged server-side and reported generically,
 * so hostnames, SQL and driver messages never reach the browser.
 */
function why(e: unknown): { ok: false; kind: "not_loaded" | "error"; reason: string } {
  if (e instanceof SupabaseFunctionMissing) return { ok: false, kind: "not_loaded", reason: "Migration 0033_rwa_asset_snapshots.sql is not applied." };
  log.error("rwa index query failed", { error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
  return { ok: false, kind: "error", reason: "The tokenized-assets store is temporarily unavailable." };
}

export async function rwaSummary(snapshot?: string): Promise<RwaResult<RwaSummary>> {
  if (supabaseBackend !== "supabase") return { ok: false, kind: "error", reason: "No durable store configured." };
  try {
    const s = summarySchema.parse(await sbRpc<unknown>("rwa_summary", snapshot ? { p_snapshot: snapshot } : {}));
    if (!s.snapshot_date) {
      return { ok: false, kind: "not_loaded", reason: snapshot ? `No snapshot for ${snapshot}.` : "No snapshot imported yet (scripts/data/import-rwa-snapshot.mjs)." };
    }
    return { ok: true, data: { ...s, freshness: rwaFreshness(s) } };
  } catch (e) {
    return why(e);
  }
}

export async function rwaSearch(q: RwaQuery): Promise<RwaResult<RwaSearch>> {
  if (supabaseBackend !== "supabase") return { ok: false, kind: "error", reason: "No durable store configured." };
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
      p_snapshot: q.snapshot ?? null,
    });
    return { ok: true, data: searchSchema.parse(r) };
  } catch (e) {
    return why(e);
  }
}
