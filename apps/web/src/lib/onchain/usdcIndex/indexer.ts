import { SupabaseFunctionMissing, sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { indexerEvent } from "../indexerLog";
import { fromHex, hllCount, hllMerge, newSketch, stdError } from "./hll";
import { RpcPool } from "./rpcPool";
import { build, decode, DAY_P, fetchRange, HOUR_P } from "./scan";

// ---------------------------------------------------------------------------
// Ethereum USDC index (migration 0036). Finalized blocks only.
//
//   live:      cursor+1 .. finalized, in ranges of LIVE_RANGE blocks, each
//              committed atomically by compare-and-set with a parent-hash
//              check (usdc_index_commit).
//   backfill:  claim a historical unit (lease), scan it, commit it; raw events
//              are stored only for units inside the retention window, older
//              units contribute aggregates + the audit row only.
//   windows:   after each pass, 1H (exact, from events), 24H (hourly rows),
//              7D/30D/90D (daily rows), ALL (totals) are materialised into
//              usdc_index_state.windows, so the dashboard reads one row.
//
// RPC: the keyless provider pool (rpcPool.ts); Alchemy is not used here.
// ---------------------------------------------------------------------------

export const STREAM = 1;
export const USDC_ETHEREUM = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const LIVE_RANGE = 50;
const BACKFILL_UNIT = 500;
const FINALITY_WINDOW = 64;

export const retentionDays = () => {
  const v = Number(process.env.USDC_INDEX_RETENTION_DAYS ?? "30");
  return Number.isFinite(v) && v >= 2 && v <= 3650 ? Math.floor(v) : 30;
};

interface Header {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
}
export interface IndexState {
  state: string;
  live_from_block: number;
  live_from_time: string;
  cursor_block: number;
  cursor_hash: string;
  cursor_time: string;
  backfill_through: number;
  head_block: number | null;
  finalized_block: number | null;
  last_success: string | null;
  last_error: string | null;
}
export interface PassReport {
  mode: "live" | "backfill";
  status: "ok" | "caught_up" | "partial" | "failed" | "not_configured";
  reason?: string;
  commits: number;
  events: number;
  from?: number;
  to?: number;
  errors: string[];
  durationMs: number;
}

const missing = (e: unknown) => e instanceof SupabaseFunctionMissing || /does not exist|PGRST20[25]|schema cache|42P01|42883/i.test(String((e as Error)?.message));
const iso = (t: number) => new Date(t * 1000).toISOString();

async function readState(): Promise<IndexState | null> {
  const [s] = await sbSelect<IndexState>("usdc_index_state", `select=state,live_from_block,live_from_time,cursor_block,cursor_hash,cursor_time,backfill_through,head_block,finalized_block,last_success,last_error&stream=eq.${STREAM}&limit=1`);
  return s ? { ...s, live_from_block: Number(s.live_from_block), cursor_block: Number(s.cursor_block), backfill_through: Number(s.backfill_through) } : null;
}

async function heads(pool: RpcPool, deadline: () => boolean) {
  const [latest, fin] = await Promise.all([
    pool.rpc<Header>("eth_getBlockByNumber", ["latest", false], deadline),
    pool.rpc<Header | null>("eth_getBlockByNumber", ["finalized", false], deadline),
  ]);
  if (!fin) throw new Error("provider did not serve the finalized tag");
  return { latest, fin, head: Number(BigInt(latest.number)), finalized: Number(BigInt(fin.number)) };
}

/** First run: anchor the live cursor at the current finalized block and plan the history as units. */
export async function ensureAnchor(pool: RpcPool, deadline: () => boolean): Promise<IndexState> {
  const s = await readState();
  if (s) return s;
  const { fin } = await heads(pool, deadline);
  await sbRpc<boolean>("usdc_index_anchor", { p_stream: STREAM, p_block: Number(BigInt(fin.number)), p_hash: fin.hash.toLowerCase(), p_time: iso(Number(BigInt(fin.timestamp))), p_unit: BACKFILL_UNIT });
  indexerEvent("indexer_checkpoint_saved", { indexer: "usdc_index", block: Number(BigInt(fin.number)), anchor: true });
  return (await readState())!;
}

async function commitRange(pool: RpcPool, kind: "live" | "backfill", from: number, to: number, expected: number | null, deadline: () => boolean, rawSince: number) {
  const r = await fetchRange(pool, USDC_ETHEREUM, from, to, deadline);
  const { events, duplicates } = decode(r.logs, USDC_ETHEREUM, r.times);
  const hourSketchesSince = Math.floor(Date.now() / 1000) - retentionDays() * 86_400;
  const b = build(events, { hourSketchesSince });
  const raw = kind === "live" || Number(BigInt(r.last.timestamp)) >= rawSince;
  const res = await sbRpc<{ ok: boolean; reason?: string; events?: number }>("usdc_index_commit", {
    p_stream: STREAM,
    p_kind: kind,
    p_from: from,
    p_to: to,
    p_expected: expected,
    p_parent_hash: r.first.parentHash.toLowerCase(),
    p_to_hash: r.last.hash.toLowerCase(),
    p_to_time: iso(Number(BigInt(r.last.timestamp))),
    p_events: raw ? b.rows : [],
    p_hours: b.hours,
    p_days: b.days,
    p_totals: b.totals,
    p_digest: b.digest,
    p_providers: { ...r.providers, ...(duplicates ? { duplicatesSkipped: duplicates } : {}) },
    p_raw_stored: raw,
  });
  return { res, events: events.length };
}

export async function livePass(pool: RpcPool, deadline: () => boolean): Promise<PassReport> {
  const t0 = Date.now();
  const rep: PassReport = { mode: "live", status: "ok", commits: 0, events: 0, errors: [], durationMs: 0 };
  try {
    const st = await ensureAnchor(pool, deadline);
    const { finalized } = await heads(pool, deadline);
    let cursor = st.cursor_block;
    rep.from = cursor + 1;
    while (cursor < finalized) {
      if (deadline()) {
        rep.status = "partial";
        break;
      }
      const from = cursor + 1;
      const to = Math.min(finalized, from + LIVE_RANGE - 1);
      const { res, events } = await commitRange(pool, "live", from, to, cursor, deadline, 0);
      if (!res.ok) {
        if (res.reason === "stale_cursor") {
          rep.status = "partial";
          rep.errors.push("another pass advanced the cursor");
          break;
        }
        if (res.reason === "parent_hash_mismatch") indexerEvent("indexer_reorg_detected", { indexer: "usdc_index", block: cursor });
        throw new Error(`commit refused: ${res.reason}`);
      }
      rep.commits++;
      rep.events += events;
      cursor = to;
      indexerEvent("block_indexed", { indexer: "usdc_index", from, to, events });
    }
    rep.to = cursor;
    if (rep.status === "ok" && rep.commits === 0) rep.status = "caught_up";
  } catch (e) {
    rep.status = missing(e) ? "not_configured" : "failed";
    rep.reason = missing(e) ? "Migration 0036 is not applied." : undefined;
    rep.errors.push(String((e as Error).message).slice(0, 200));
  }
  rep.durationMs = Date.now() - t0;
  return rep;
}

export async function backfillPass(pool: RpcPool, deadline: () => boolean): Promise<PassReport> {
  const t0 = Date.now();
  const rep: PassReport = { mode: "backfill", status: "ok", commits: 0, events: 0, errors: [], durationMs: 0 };
  const rawSince = Math.floor(Date.now() / 1000) - retentionDays() * 86_400;
  try {
    await ensureAnchor(pool, deadline);
    for (;;) {
      if (deadline()) {
        rep.status = "partial";
        break;
      }
      const u = await sbRpc<{ from: number; to: number } | null>("usdc_backfill_claim", { p_stream: STREAM, p_lease: "10 minutes" });
      if (!u) {
        if (rep.commits === 0) rep.status = "caught_up";
        break;
      }
      try {
        const { res, events } = await commitRange(pool, "backfill", Number(u.from), Number(u.to), null, deadline, rawSince);
        if (!res.ok && res.reason !== "already_committed") throw new Error(`commit refused: ${res.reason}`);
        rep.commits++;
        rep.events += events;
        rep.from ??= Number(u.from);
        rep.to = Number(u.to);
      } catch (e) {
        await sbRpc("usdc_backfill_fail", { p_stream: STREAM, p_from: Number(u.from), p_error: String((e as Error).message) }).catch(() => {});
        throw e;
      }
    }
  } catch (e) {
    rep.status = missing(e) ? "not_configured" : rep.commits ? "partial" : "failed";
    rep.reason = missing(e) ? "Migration 0036 is not applied." : undefined;
    rep.errors.push(String((e as Error).message).slice(0, 200));
  }
  rep.durationMs = Date.now() - t0;
  return rep;
}

// ---------------------------------------------------------------- windows

interface AggRow {
  hour?: string;
  day?: string;
  transfers: number | string;
  transfer_raw: string;
  mints: number | string;
  mint_raw: string;
  burns: number | string;
  burn_raw: string;
  zero_value: number | string;
  first_block: number | string;
  last_block: number | string;
  top: unknown[];
  senders_hll: string | null;
  receivers_hll: string | null;
}

export interface WindowMetrics {
  from: string;
  to: string;
  exact: boolean;
  basis: string;
  events: number;
  transfers: number;
  transferRaw: string;
  mints: number;
  mintRaw: string;
  burns: number;
  burnRaw: string;
  txCount: number | null;
  uniqueSenders: { count: number | null; exact: boolean; method?: string; stdError?: number; note?: string };
  uniqueReceivers: { count: number | null; exact: boolean; method?: string; stdError?: number; note?: string };
  top: unknown[];
  coverage: { complete: boolean; historyFrom: string | null };
}

function sumRows(rows: AggRow[], p: number, label: string, from: string, to: string, complete: boolean, historyFrom: string | null): WindowMetrics {
  const n = (v: number | string) => Number(v);
  const s = newSketch(p);
  const r = newSketch(p);
  let sketched = rows.length > 0;
  let tr = 0n, mr = 0n, br = 0n, transfers = 0, mints = 0, burns = 0;
  let top: unknown[] = [];
  for (const x of rows) {
    transfers += n(x.transfers);
    mints += n(x.mints);
    burns += n(x.burns);
    tr += BigInt(String(x.transfer_raw).split(".")[0]);
    mr += BigInt(String(x.mint_raw).split(".")[0]);
    br += BigInt(String(x.burn_raw).split(".")[0]);
    top = top.concat(x.top ?? []);
    const a = fromHex(x.senders_hll);
    const b = fromHex(x.receivers_hll);
    if (a && b && a.length === s.length) (hllMerge(s, a), hllMerge(r, b));
    else sketched = false;
  }
  top.sort((a, b) => {
    const x = BigInt((a as string[])[0]);
    const y = BigInt((b as string[])[0]);
    return x < y ? 1 : x > y ? -1 : 0;
  });
  const uniq = (k: Uint8Array) => (sketched ? { count: hllCount(k), exact: false, method: `hll-p${p}`, stdError: stdError(p) } : { count: null, exact: false, note: "sketch not available for every bucket in this window" });
  return {
    from,
    to,
    exact: true,
    basis: label,
    events: transfers + mints + burns,
    transfers,
    transferRaw: tr.toString(),
    mints,
    mintRaw: mr.toString(),
    burns,
    burnRaw: br.toString(),
    txCount: null,
    uniqueSenders: uniq(s),
    uniqueReceivers: uniq(r),
    top: top.slice(0, 10),
    coverage: { complete, historyFrom },
  };
}

/** Materialise 1H/24H/7D/30D/90D/ALL from the aggregate tables (no lifetime scans). */
export async function computeWindows(st: IndexState): Promise<Record<string, unknown>> {
  const end = new Date(st.cursor_time);
  const endS = Math.floor(end.getTime() / 1000);
  const historyComplete = st.backfill_through >= st.live_from_block - 1;
  const [streamRow] = await sbSelect<{ deploy_block: number }>("usdc_index_streams", `select=deploy_block&stream=eq.${STREAM}&limit=1`);
  // A window is complete when the history is, or when it starts after the live anchor.
  const liveFrom = Date.parse(st.live_from_time);
  const covers = (fromIso: string) => historyComplete || Date.parse(fromIso) >= liveFrom;
  const historyFrom = historyComplete ? null : st.live_from_time;
  const windows: Record<string, unknown> = {};

  // 1H and 5M: exact from events.
  for (const [k, secs] of [["5m", 300], ["1h", 3600]] as const) {
    const since = new Date((endS - secs) * 1000).toISOString();
    const x = await sbRpc<Record<string, string | number | null>>("usdc_window_exact", { p_stream: STREAM, p_since: since, p_until: end.toISOString() });
    windows[k] = {
      from: since,
      to: end.toISOString(),
      exact: true,
      basis: "retained events",
      events: Number(x.events),
      transfers: Number(x.transfers),
      transferRaw: String(x.transfer_raw),
      mints: Number(x.mints),
      mintRaw: String(x.mint_raw),
      burns: Number(x.burns),
      burnRaw: String(x.burn_raw),
      txCount: Number(x.tx_count),
      uniqueSenders: { count: Number(x.senders), exact: true },
      uniqueReceivers: { count: Number(x.receivers), exact: true },
      eventsPerSecond: +(Number(x.events) / secs).toFixed(3),
      coverage: { complete: covers(since), historyFrom },
    };
  }

  // 24H: the 24 hourly rows ending with the cursor's hour (hour-aligned).
  const h0 = new Date(Math.floor(endS / 3600) * 3600 * 1000 - 23 * 3600 * 1000).toISOString();
  const hours = await sbSelect<AggRow>("usdc_hourly", `select=hour,transfers,transfer_raw:transfer_raw::text,mints,mint_raw:mint_raw::text,burns,burn_raw:burn_raw::text,zero_value,first_block,last_block,top,senders_hll,receivers_hll&stream=eq.${STREAM}&hour=gte.${encodeURIComponent(h0)}&order=hour.asc`);
  windows["24h"] = sumRows(hours, HOUR_P, "24 hourly rows (hour-aligned)", h0, end.toISOString(), covers(h0), historyFrom);

  // 7D/30D/90D: whole UTC days (today partial up to the cursor).
  for (const [k, d] of [["7d", 7], ["30d", 30], ["90d", 90]] as const) {
    const d0 = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - (d - 1))).toISOString().slice(0, 10);
    const days = await sbSelect<AggRow>("usdc_daily", `select=day,transfers,transfer_raw:transfer_raw::text,mints,mint_raw:mint_raw::text,burns,burn_raw:burn_raw::text,zero_value,first_block,last_block,top,senders_hll,receivers_hll&stream=eq.${STREAM}&day=gte.${d0}&order=day.asc`);
    windows[k] = sumRows(days, DAY_P, `${d} daily rows (UTC days)`, `${d0}T00:00:00.000Z`, end.toISOString(), covers(`${d0}T00:00:00.000Z`), historyFrom);
  }

  // ALL: one row.
  const [t] = await sbSelect<Record<string, string | number | null>>("usdc_totals", `select=events,tx_count,transfers,transfer_raw:transfer_raw::text,mints,mint_raw:mint_raw::text,burns,burn_raw:burn_raw::text,zero_value,senders_hll,receivers_hll&stream=eq.${STREAM}&limit=1`);
  if (t) {
    const s = fromHex(t.senders_hll as string | null);
    const r = fromHex(t.receivers_hll as string | null);
    windows.all = {
      from: null,
      to: end.toISOString(),
      exact: true,
      basis: "usdc_totals",
      events: Number(t.events),
      transfers: Number(t.transfers),
      transferRaw: String(t.transfer_raw).split(".")[0],
      mints: Number(t.mints),
      mintRaw: String(t.mint_raw).split(".")[0],
      burns: Number(t.burns),
      burnRaw: String(t.burn_raw).split(".")[0],
      txCount: Number(t.tx_count),
      uniqueSenders: s ? { count: hllCount(s), exact: false, method: `hll-p${DAY_P}`, stdError: stdError(DAY_P) } : { count: null, exact: false },
      uniqueReceivers: r ? { count: hllCount(r), exact: false, method: `hll-p${DAY_P}`, stdError: stdError(DAY_P) } : { count: null, exact: false },
      coverage: { complete: historyComplete, historyFrom, deployBlock: Number(streamRow?.deploy_block ?? 0), backfillThrough: st.backfill_through },
    };
  }
  return windows;
}

export function deriveState(st: IndexState, finalized: number | null, lastPassFailed: boolean): string {
  if (lastPassFailed) return "DEGRADED";
  if (st.backfill_through < st.live_from_block - 1) return "BACKFILLING";
  if (finalized !== null && finalized - st.cursor_block > FINALITY_WINDOW) return "CATCHING_UP";
  return "LIVE";
}

/** One cron pass: live first (small, current), then backfill with the remaining budget, then windows. */
export async function runUsdcIndex(opts: { deadline: () => boolean; backfillDeadline: () => boolean; mode?: "live" | "backfill" | "all"; pool?: RpcPool }) {
  if (supabaseBackend !== "supabase") return { ok: false, status: "not_configured", reason: "No durable store (SUPABASE_URL)." };
  const pool = opts.pool ?? new RpcPool();
  const mode = opts.mode ?? "all";
  const reports: PassReport[] = [];
  if (mode !== "backfill") reports.push(await livePass(pool, opts.deadline));
  if (mode !== "live" && reports.every((r) => r.status !== "not_configured")) reports.push(await backfillPass(pool, opts.backfillDeadline));
  if (reports.some((r) => r.status === "not_configured")) return { ok: false, status: "not_configured", reason: "Migration 0036 is not applied.", reports };
  let headInfo: Awaited<ReturnType<typeof heads>> | null = null;
  let supply: bigint | null = null;
  try {
    headInfo = await heads(pool, () => false);
    supply = BigInt(await pool.rpc<string>("eth_call", [{ to: USDC_ETHEREUM, data: "0x18160ddd" }, headInfo.fin.number]));
  } catch (e) {
    reports.push({ mode: "live", status: "failed", commits: 0, events: 0, errors: [`heads/supply: ${(e as Error).message.slice(0, 120)}`], durationMs: 0 });
  }
  const st = (await readState())!;
  const failed = reports.some((r) => r.status === "failed");
  // Retention: raw events and hourly sketches older than the window.
  const cutoff = new Date(new Date(st.cursor_time).getTime() - retentionDays() * 86_400_000).toISOString();
  const pruned = await sbRpc<Record<string, number>>("usdc_index_prune", { p_stream: STREAM, p_before: cutoff, p_limit: 50_000 }).catch((e) => ({ error: String((e as Error).message) }));
  let windows: Record<string, unknown> | null = null;
  try {
    windows = await computeWindows(st);
  } catch (e) {
    reports.push({ mode: "live", status: "failed", commits: 0, events: 0, errors: [`windows: ${(e as Error).message.slice(0, 120)}`], durationMs: 0 });
  }
  const state = deriveState(st, headInfo?.finalized ?? null, failed);
  await sbRpc("usdc_index_touch", {
    p_stream: STREAM,
    p_state: state,
    p_head: headInfo?.head ?? null,
    p_head_time: headInfo ? iso(Number(BigInt(headInfo.latest.timestamp))) : null,
    p_finalized: headInfo?.finalized ?? null,
    p_finalized_time: headInfo ? iso(Number(BigInt(headInfo.fin.timestamp))) : null,
    p_supply: supply === null ? null : supply.toString(),
    p_supply_block: supply === null ? null : headInfo!.finalized,
    p_windows: windows,
    p_rpc: { providers: pool.health(), at: new Date().toISOString() },
    p_error: failed ? reports.flatMap((r) => r.errors).join("; ").slice(0, 400) : null,
  });
  return { ok: !failed, status: state, reports, pruned };
}
