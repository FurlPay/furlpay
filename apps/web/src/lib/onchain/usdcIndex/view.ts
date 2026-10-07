import { SupabaseFunctionMissing, sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { retentionDays, STREAM } from "./indexer";

// Read model for the dashboard and the public API: ONE state row (heads,
// cursor, supply, materialised windows, provider health) plus small reads of
// retained events. Nothing here scans the event table beyond a short window.

export interface UsdcIndexView {
  available: boolean;
  reason: string | null;
  chain: "ethereum";
  contract: string;
  state: string | null;
  head: { block: number | null; time: string | null };
  finalized: { block: number | null; time: string | null };
  indexed: { block: number | null; time: string | null };
  lagBlocks: number | null;
  history: { complete: boolean; deployBlock: number | null; backfillThrough: number | null; liveFrom: number | null; liveFromTime: string | null };
  supply: { raw: string | null; atBlock: number | null };
  windows: Record<string, unknown>;
  windowsAt: string | null;
  rpc: unknown;
  lastSuccess: string | null;
  lastError: string | null;
  retentionDays: number;
  generatedAt: string;
}

const missing = (e: unknown) => e instanceof SupabaseFunctionMissing || /does not exist|PGRST20[25]|schema cache|42P01|42883/i.test(String((e as Error)?.message));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function usdcIndexView(): Promise<UsdcIndexView> {
  const base: UsdcIndexView = {
    available: false,
    reason: null,
    chain: "ethereum",
    contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    state: null,
    head: { block: null, time: null },
    finalized: { block: null, time: null },
    indexed: { block: null, time: null },
    lagBlocks: null,
    history: { complete: false, deployBlock: null, backfillThrough: null, liveFrom: null, liveFromTime: null },
    supply: { raw: null, atBlock: null },
    windows: {},
    windowsAt: null,
    rpc: null,
    lastSuccess: null,
    lastError: null,
    retentionDays: retentionDays(),
    generatedAt: new Date().toISOString(),
  };
  if (supabaseBackend !== "supabase") return { ...base, reason: "No durable store configured (SUPABASE_URL)." };
  try {
    const [[s], [stream]] = await Promise.all([
      sbSelect<Record<string, unknown>>(
        "usdc_index_state",
        `select=state,live_from_block,live_from_time,cursor_block,cursor_time,backfill_through,head_block,head_time,finalized_block,finalized_time,supply_raw:supply_raw::text,supply_block,windows,windows_at,rpc,last_success,last_error&stream=eq.${STREAM}&limit=1`
      ),
      sbSelect<{ deploy_block: number }>("usdc_index_streams", `select=deploy_block&stream=eq.${STREAM}&limit=1`),
    ]);
    if (!s) return { ...base, reason: "The USDC index has not run yet (no anchor). Start the indexer worker." };
    const fin = num(s.finalized_block);
    const cur = num(s.cursor_block);
    const liveFrom = num(s.live_from_block);
    const through = num(s.backfill_through);
    return {
      ...base,
      available: true,
      state: String(s.state),
      head: { block: num(s.head_block), time: (s.head_time as string) ?? null },
      finalized: { block: fin, time: (s.finalized_time as string) ?? null },
      indexed: { block: cur, time: (s.cursor_time as string) ?? null },
      lagBlocks: fin !== null && cur !== null ? Math.max(0, fin - cur) : null,
      history: { complete: through !== null && liveFrom !== null && through >= liveFrom - 1, deployBlock: num(stream?.deploy_block), backfillThrough: through, liveFrom, liveFromTime: (s.live_from_time as string) ?? null },
      supply: { raw: (s.supply_raw as string) ?? null, atBlock: num(s.supply_block) },
      windows: (s.windows as Record<string, unknown>) ?? {},
      windowsAt: (s.windows_at as string) ?? null,
      rpc: s.rpc ?? null,
      lastSuccess: (s.last_success as string) ?? null,
      lastError: (s.last_error as string) ?? null,
    };
  } catch (e) {
    return { ...base, reason: missing(e) ? "USDC index tables are not migrated (apply migration 0036)." : `USDC index store unreachable: ${String((e as Error).message).slice(0, 120)}` };
  }
}

export interface IndexedTransfer {
  block: number;
  logIndex: number;
  time: string;
  tx: string;
  from: string;
  to: string;
  amountRaw: string;
  kind: "transfer" | "mint" | "burn";
}
const KIND = ["transfer", "mint", "burn"] as const;

/** Retained events within the last `seconds` (≤ 1 h), newest or largest first. */
export async function recentTransfers(seconds: number, sort: "recent" | "largest", limit: number, untilIso?: string): Promise<IndexedTransfer[]> {
  const ref = untilIso ? Date.parse(untilIso) : Date.now();
  const rows = await sbRpc<Record<string, unknown>[]>("usdc_recent", { p_stream: STREAM, p_since: new Date(ref - seconds * 1000).toISOString(), p_sort: sort, p_limit: limit });
  return (rows ?? []).map((r) => ({
    block: Number(r.block_number),
    logIndex: Number(r.log_index),
    time: String(r.block_time),
    tx: String(r.tx_hash),
    from: String(r.sender),
    to: String(r.recipient),
    amountRaw: String(r.amount_raw),
    kind: KIND[Number(r.kind)] ?? "transfer",
  }));
}

export async function addressActivity(address: string, limit: number) {
  return sbRpc<Record<string, unknown>>("usdc_address", { p_stream: STREAM, p_address: address.toLowerCase(), p_limit: limit });
}
