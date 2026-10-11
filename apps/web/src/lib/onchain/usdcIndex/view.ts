import { SupabaseFunctionMissing, sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { retentionDays, STREAM } from "./indexer";
import { fromHex, hllCount, stdError } from "./hll";

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

// ---------------------------------------------------------------------------
// Hourly / daily series (GET /api/onchain/token/usdc/metrics/{hourly,daily}).
// Reads the indexer's own rollups (usdc_hourly / usdc_daily, migration 0036).
// Amounts are integer base-unit strings plus a 6-decimal string, never floats.
// Buckets with no row are OMITTED, never zero-filled: a missing hour can mean
// "no activity" or "not indexed yet", and `coverage` says which range is real.
// Unique senders/receivers per bucket are HLL estimates (p12 hourly, p14 daily).
// ---------------------------------------------------------------------------

export type SeriesGranularity = "hourly" | "daily";
export const SERIES_LIMITS: Record<SeriesGranularity, { maxBuckets: number; defaultBuckets: number; ms: number; p: number }> = {
  hourly: { maxBuckets: 168, defaultBuckets: 24, ms: 3_600_000, p: 12 },
  daily: { maxBuckets: 366, defaultBuckets: 30, ms: 86_400_000, p: 14 },
};

const DECIMALS = 6n;
/** "1234567" base units → "1.234567" (exact, no float). */
export function toDecimal(raw: string): string {
  const neg = raw.startsWith("-");
  const digits = (neg ? raw.slice(1) : raw).split(".")[0].replace(/^0+(?=\d)/, "") || "0";
  const padded = digits.padStart(Number(DECIMALS) + 1, "0");
  const int = padded.slice(0, -Number(DECIMALS));
  const frac = padded.slice(-Number(DECIMALS)).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

export interface SeriesBucket {
  bucket: string;
  transfers: number;
  transferRaw: string;
  transferAmount: string;
  mints: number;
  mintRaw: string;
  burns: number;
  burnRaw: string;
  zeroValue: number;
  blocks: { first: number; last: number };
  uniqueSenders: { count: number | null; exact: false; method: string; stdError: number; note?: string };
  uniqueReceivers: { count: number | null; exact: false; method: string; stdError: number; note?: string };
}

export interface SeriesView {
  available: boolean;
  reason: string | null;
  granularity: SeriesGranularity;
  from: string;
  to: string;
  buckets: SeriesBucket[];
  coverage: { complete: boolean; historyFrom: string | null; indexedThrough: string | null };
}

export function parseSeriesRange(g: SeriesGranularity, fromRaw: string | null, toRaw: string | null, now = Date.now()): { from: Date; to: Date } | { error: string } {
  const L = SERIES_LIMITS[g];
  const floor = (t: number) => Math.floor(t / L.ms) * L.ms;
  const parse = (v: string) => {
    const iso = g === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v;
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/.test(iso)) return NaN;
    return Date.parse(iso);
  };
  const to = toRaw ? parse(toRaw) : floor(now) + L.ms;
  const from = fromRaw ? parse(fromRaw) : to - L.defaultBuckets * L.ms;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: "invalid_range: from/to must be ISO-8601 (daily also accepts YYYY-MM-DD)" };
  const f = floor(from);
  const t = Math.ceil(to / L.ms) * L.ms;
  if (t <= f) return { error: "invalid_range: to must be after from" };
  if ((t - f) / L.ms > L.maxBuckets) return { error: `invalid_range: at most ${L.maxBuckets} ${g === "hourly" ? "hours" : "days"} per request` };
  return { from: new Date(f), to: new Date(t) };
}

function uniq(hex: unknown, p: number) {
  const s = typeof hex === "string" ? fromHex(hex) : null;
  const ok = s !== null && s.length === 1 << p;
  return { count: ok ? hllCount(s) : null, exact: false as const, method: `hll-p${p}`, stdError: stdError(p), ...(ok ? {} : { note: "sketch not stored for this bucket" }) };
}

export async function usdcSeries(g: SeriesGranularity, from: Date, to: Date): Promise<SeriesView> {
  const L = SERIES_LIMITS[g];
  const base: SeriesView = { available: false, reason: null, granularity: g, from: from.toISOString(), to: to.toISOString(), buckets: [], coverage: { complete: false, historyFrom: null, indexedThrough: null } };
  if (supabaseBackend !== "supabase") return { ...base, reason: "No durable store configured (SUPABASE_URL)." };
  const table = g === "hourly" ? "usdc_hourly" : "usdc_daily";
  const col = g === "hourly" ? "hour" : "day";
  const lo = g === "hourly" ? from.toISOString() : from.toISOString().slice(0, 10);
  const hi = g === "hourly" ? to.toISOString() : to.toISOString().slice(0, 10);
  try {
    const [rows, state] = await Promise.all([
      sbSelect<Record<string, unknown>>(
        table,
        `select=${col},transfers,transfer_raw:transfer_raw::text,mints,mint_raw:mint_raw::text,burns,burn_raw:burn_raw::text,zero_value,first_block,last_block,senders_hll,receivers_hll&stream=eq.${STREAM}&${col}=gte.${encodeURIComponent(lo)}&${col}=lt.${encodeURIComponent(hi)}&order=${col}.asc&limit=${L.maxBuckets + 1}`
      ),
      usdcIndexView(),
    ]);
    const buckets: SeriesBucket[] = rows.map((r) => {
      const transferRaw = String(r.transfer_raw ?? "0").split(".")[0];
      return {
        bucket: g === "hourly" ? new Date(String(r.hour)).toISOString() : String(r.day),
        transfers: Number(r.transfers),
        transferRaw,
        transferAmount: toDecimal(transferRaw),
        mints: Number(r.mints),
        mintRaw: String(r.mint_raw ?? "0").split(".")[0],
        burns: Number(r.burns),
        burnRaw: String(r.burn_raw ?? "0").split(".")[0],
        zeroValue: Number(r.zero_value),
        blocks: { first: Number(r.first_block), last: Number(r.last_block) },
        uniqueSenders: uniq(r.senders_hll, L.p),
        uniqueReceivers: uniq(r.receivers_hll, L.p),
      };
    });
    return {
      ...base,
      available: state.available,
      reason: state.available ? null : state.reason,
      buckets,
      coverage: { complete: state.history.complete, historyFrom: state.history.liveFromTime, indexedThrough: state.indexed.time },
    };
  } catch (e) {
    return { ...base, reason: missing(e) ? "USDC index tables are not migrated (apply migration 0036)." : `USDC index store unreachable: ${String((e as Error).message).slice(0, 120)}` };
  }
}
