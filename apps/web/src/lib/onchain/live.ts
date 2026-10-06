import { sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { alliumKeyConfigured } from "./allium";
import { beamSecret } from "./beamAuth";
import { shortRef } from "./dashboard";

// ---------------------------------------------------------------------------
// Live read model for /onchain: the ingested chain feed, its freshness, and
// pipeline health — the inputs to the LIVE / DEGRADED / STALE / OFFLINE badge.
//
// PRIVACY: /onchain is public. A full transaction hash or address of a USER's
// linked wallet would tell anyone that the wallet belongs to a FurlPay user,
// so for scope 'user' everything leaves truncated and without explorer links.
// Treasury and watch-list activity is FurlPay's own and is shown in full.
// Operators (admin session) get full detail. user_id never leaves the server.
// ---------------------------------------------------------------------------

export type PipelineState = "live" | "degraded" | "stale" | "offline" | "not_configured";

export interface FeedEvent {
  key: string;
  chain: string;
  hash: string;
  hashFull: string | null;
  from: string;
  to: string;
  direction: "in" | "out" | "self";
  scope: "user" | "treasury" | "watch";
  activity: string;
  asset: string | null;
  amount: string | null;
  amountUsd: number | null;
  state: "observed" | "confirmed" | "finalized" | "reorged";
  blockNumber: number | null;
  at: string;
  observedAt: string;
  explorerUrl: string | null;
  reconciliationRequired: boolean;
}

export interface LiveSnapshot {
  generatedAt: string;
  state: PipelineState;
  reason: string | null;
  configured: { alliumApiKey: boolean; beamWebhook: boolean; store: boolean };
  freshness: { lastBlockAt: string | null; lastIngestAt: string | null; ingestLagMs: number | null; ageMs: number | null };
  health: { eventsTotal: number; deadLetters24h: number; deadLettersOpen: number; reconciliationRequired: number; reorgedTotal: number; lastRun: { kind: string; status: string; finishedAt: string | null; startedAt: string; inserted: number; markedReorged: number } | null } | null;
  latestId: number | null;
  feed: FeedEvent[];
}

/** Official block explorers. A chain not listed gets no link (never a guessed URL). */
const EXPLORERS: Record<string, { tx: string; address: string }> = {
  ethereum: { tx: "https://etherscan.io/tx/", address: "https://etherscan.io/address/" },
  base: { tx: "https://basescan.org/tx/", address: "https://basescan.org/address/" },
  arbitrum: { tx: "https://arbiscan.io/tx/", address: "https://arbiscan.io/address/" },
  optimism: { tx: "https://optimistic.etherscan.io/tx/", address: "https://optimistic.etherscan.io/address/" },
  polygon: { tx: "https://polygonscan.com/tx/", address: "https://polygonscan.com/address/" },
  avalanche: { tx: "https://snowtrace.io/tx/", address: "https://snowtrace.io/address/" },
  bsc: { tx: "https://bscscan.com/tx/", address: "https://bscscan.com/address/" },
  celo: { tx: "https://celoscan.io/tx/", address: "https://celoscan.io/address/" },
  unichain: { tx: "https://uniscan.xyz/tx/", address: "https://uniscan.xyz/address/" },
  solana: { tx: "https://solscan.io/tx/", address: "https://solscan.io/account/" },
};
export function explorerUrl(chain: string, kind: "tx" | "address", value: string): string | null {
  const e = EXPLORERS[chain];
  return e ? `${e[kind]}${encodeURIComponent(value)}` : null;
}

export interface Row {
  id: number;
  event_key: string;
  chain: string;
  tx_hash: string;
  block_number: number | null;
  block_hash: string | null;
  block_timestamp: string;
  log_index: number | null;
  from_address: string;
  to_address: string;
  asset_address: string | null;
  asset_symbol: string | null;
  amount: string | null;
  amount_usd: string | null;
  activity_type: string;
  direction: "in" | "out" | "self";
  scope: "user" | "treasury" | "watch";
  confirmation_state: FeedEvent["state"];
  reconciliation_required: boolean;
  reconciliation_note?: string | null;
  ledger_ref?: string | null;
  revision?: number;
  observed_at: string;
  source?: string;
}
export const ROW_COLS =
  "id,event_key,chain,tx_hash,block_number,block_hash,block_timestamp,log_index,from_address,to_address,asset_address,asset_symbol,amount,amount_usd,activity_type,direction,scope,confirmation_state,reconciliation_required,observed_at";

export function toFeed(r: Row, full: boolean): FeedEvent {
  const open = full || r.scope !== "user";
  return {
    key: open ? r.event_key : `${r.chain}:${shortRef(r.tx_hash)}:${r.log_index ?? "n"}`,
    chain: r.chain,
    hash: shortRef(r.tx_hash) ?? "—",
    hashFull: open ? r.tx_hash : null,
    from: open ? r.from_address : (shortRef(r.from_address) ?? "—"),
    to: open ? r.to_address : (shortRef(r.to_address) ?? "—"),
    direction: r.direction,
    scope: r.scope,
    activity: r.activity_type,
    asset: r.asset_symbol,
    amount: r.amount,
    amountUsd: r.amount_usd === null ? null : Number(r.amount_usd),
    state: r.confirmation_state,
    blockNumber: r.block_number,
    at: r.block_timestamp,
    observedAt: r.observed_at,
    explorerUrl: open ? explorerUrl(r.chain, "tx", r.tx_hash) : null,
    reconciliationRequired: full ? r.reconciliation_required : false,
  };
}

const STALE_MS = 26 * 3_600_000;

/** Pure: derive the badge from configuration and health. Never "live" without evidence. */
export function pipelineState(input: {
  configured: LiveSnapshot["configured"];
  health: LiveSnapshot["health"];
  lastIngestAt: string | null;
  now: number;
}): { state: PipelineState; reason: string | null } {
  const { configured, health, now } = input;
  if (!configured.store) return { state: "offline", reason: "No durable store configured." };
  if (!configured.alliumApiKey && !configured.beamWebhook) return { state: "not_configured", reason: "Allium is not connected (ALLIUM_API_KEY, ALLIUM_BEAM_WEBHOOK_SECRET)." };
  if (!health) return { state: "offline", reason: "Ingestion store unreachable." };
  const lastRunOkAt = health.lastRun && health.lastRun.status === "ok" ? Date.parse(health.lastRun.finishedAt ?? health.lastRun.startedAt) : NaN;
  const lastIngest = input.lastIngestAt ? Date.parse(input.lastIngestAt) : NaN;
  const lastEvidence = Math.max(Number.isFinite(lastRunOkAt) ? lastRunOkAt : 0, Number.isFinite(lastIngest) ? lastIngest : 0);
  if (lastEvidence === 0) return { state: "stale", reason: "No events ingested and no successful reconciliation yet." };
  if (now - lastEvidence > STALE_MS) return { state: "stale", reason: "No ingestion or successful reconciliation in 26 hours." };
  if (health.deadLetters24h > 0) return { state: "degraded", reason: `${health.deadLetters24h} delivery(ies) dead-lettered in 24h.` };
  if (health.lastRun && health.lastRun.status !== "ok" && health.lastRun.status !== "running") return { state: "degraded", reason: `Last reconciliation was ${health.lastRun.status}.` };
  return { state: "live", reason: null };
}

let shared: { at: number; full: boolean; value: Promise<LiveSnapshot> } | null = null;
export const LIVE_CACHE_MS = 2_000;

/** One shared snapshot per instance every 2 s (redacted); operators get an uncached full one. */
export function liveSnapshot(full: boolean, now = Date.now()): Promise<LiveSnapshot> {
  if (!full && shared && !shared.full && now - shared.at < LIVE_CACHE_MS) return shared.value;
  const value = buildLive(full, now);
  if (!full) {
    shared = { at: now, full, value };
    value.catch(() => (shared = null));
  }
  return value;
}

async function buildLive(full: boolean, now: number): Promise<LiveSnapshot> {
  const configured = { alliumApiKey: alliumKeyConfigured(), beamWebhook: beamSecret().length >= 32, store: supabaseBackend === "supabase" };
  const base: LiveSnapshot = {
    generatedAt: new Date(now).toISOString(),
    state: "offline",
    reason: null,
    configured,
    freshness: { lastBlockAt: null, lastIngestAt: null, ingestLagMs: null, ageMs: null },
    health: null,
    latestId: null,
    feed: [],
  };
  // Not connected (or no store) is the root state: report it without querying.
  if (!configured.store || (!configured.alliumApiKey && !configured.beamWebhook)) return { ...base, ...pipelineState({ configured, health: null, lastIngestAt: null, now }) };
  try {
    const [h, rows] = await Promise.all([
      sbRpc<Record<string, unknown>>("onchain_health", {}),
      sbSelect<Row>("onchain_events", `select=${ROW_COLS}&order=id.desc&limit=25`),
    ]);
    const run = h.last_run as Record<string, unknown> | null;
    const health: LiveSnapshot["health"] = {
      eventsTotal: Number(h.events_total ?? 0),
      deadLetters24h: Number(h.dead_letters_24h ?? 0),
      deadLettersOpen: Number(h.dead_letters_open ?? 0),
      reconciliationRequired: Number(h.reconciliation_required ?? 0),
      reorgedTotal: Number(h.reorged_total ?? 0),
      lastRun: run
        ? { kind: String(run.kind), status: String(run.status), finishedAt: (run.finished_at as string | null) ?? null, startedAt: String(run.started_at), inserted: Number(run.inserted ?? 0), markedReorged: Number(run.marked_reorged ?? 0) }
        : null,
    };
    const lastIngestAt = (h.last_observed_at as string | null) ?? null;
    const lastBlockAt = (h.last_block_timestamp as string | null) ?? null;
    const newest = rows[0];
    return {
      ...base,
      ...pipelineState({ configured, health, lastIngestAt, now }),
      health,
      freshness: {
        lastBlockAt,
        lastIngestAt,
        ingestLagMs: newest ? Math.max(0, Date.parse(newest.observed_at) - Date.parse(newest.block_timestamp)) : null,
        ageMs: lastBlockAt ? Math.max(0, now - Date.parse(lastBlockAt)) : null,
      },
      latestId: newest?.id ?? null,
      feed: rows.map((r) => toFeed(r, full)),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const reason = /onchain_health|PGRST202|does not exist|SupabaseFunctionMissing/i.test(msg) || e?.constructor?.name === "SupabaseFunctionMissing" ? "Migration 0032_onchain_ingestion.sql is not applied." : "Ingestion store unreachable.";
    return { ...base, state: "offline", reason };
  }
}

const HASH = /^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/;
const ADDR = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const SYMBOL = /^[A-Za-z0-9.]{1,12}$/;

export type SearchResult = { kind: "tx" | "address" | "asset" | "chain"; events: FeedEvent[]; nextCursor: number | null };

/**
 * Server-side search. Inputs are matched against strict shapes and become
 * PostgREST `eq` filters only (no LIKE scans, no user-supplied operators).
 * Public callers search FurlPay's own (treasury/watch) activity only;
 * operators search everything. Cursor = last id (keyset pagination).
 */
export async function searchEvents(q: string, full: boolean, cursor: number | null, pageSize = 25): Promise<SearchResult | null> {
  const s = q.trim();
  const v = /^0x/i.test(s) ? s.toLowerCase() : s;
  let kind: SearchResult["kind"];
  let filter: string;
  if (HASH.test(s)) {
    kind = "tx";
    filter = `tx_hash=eq.${encodeURIComponent(v)}`;
  } else if (ADDR.test(s)) {
    kind = "address";
    filter = `or=(from_address.eq.${encodeURIComponent(v)},to_address.eq.${encodeURIComponent(v)})`;
  } else if (/^[a-z0-9_-]{2,32}$/.test(s) && Object.keys(EXPLORERS).includes(s)) {
    kind = "chain";
    filter = `chain=eq.${s}`;
  } else if (SYMBOL.test(s)) {
    kind = "asset";
    filter = `asset_symbol=eq.${encodeURIComponent(s.toUpperCase())}`;
  } else return null;
  const scope = full ? "" : "&scope=in.(treasury,watch)";
  const after = cursor ? `&id=lt.${cursor}` : "";
  const rows = await sbSelect<Row>("onchain_events", `select=${ROW_COLS}&${filter}${scope}${after}&order=id.desc&limit=${pageSize + 1}`);
  const page = rows.slice(0, pageSize);
  return { kind, events: page.map((r) => toFeed(r, full)), nextCursor: rows.length > pageSize ? page[page.length - 1].id : null };
}

export interface TxDetail {
  event: FeedEvent;
  blockHash: string | null;
  logIndex: number | null;
  assetAddress: string | null;
  revision: number;
  related: FeedEvent[];
  ledger: { ref: string | null; reconciliationRequired: boolean; note: string | null } | null;
  revisions: { change: string; reason: string | null; at: string }[] | null;
  explorer: { tx: string | null; from: string | null; to: string | null };
}

/** Transaction detail by event key. User-scope events are redacted for public callers. */
export async function txDetail(eventKey: string, full: boolean): Promise<TxDetail | null> {
  const key = eventKey.toLowerCase();
  if (!/^[a-z0-9_-]{2,32}:[0-9a-z]{8,128}:[0-9a-z:._-]{1,200}$/i.test(key)) return null;
  const rows = await sbSelect<Row>("onchain_events", `select=${ROW_COLS},ledger_ref,reconciliation_note,revision&event_key=eq.${encodeURIComponent(key)}&limit=1`);
  const r = rows[0];
  if (!r) return null;
  if (!full && r.scope === "user") {
    // Public view of a user's event: what the feed already shows, nothing more.
    return { event: toFeed(r, false), blockHash: null, logIndex: null, assetAddress: r.asset_address, revision: r.revision ?? 1, related: [], ledger: null, revisions: null, explorer: { tx: null, from: null, to: null } };
  }
  const [related, revs] = await Promise.all([
    sbSelect<Row>("onchain_events", `select=${ROW_COLS}&chain=eq.${encodeURIComponent(r.chain)}&tx_hash=eq.${encodeURIComponent(r.tx_hash)}&event_key=neq.${encodeURIComponent(key)}&limit=20`),
    full ? sbSelect<{ change: string; reason: string | null; created_at: string }>("onchain_event_revisions", `select=change,reason,created_at&event_key=eq.${encodeURIComponent(key)}&order=id.asc&limit=50`) : Promise.resolve([]),
  ]);
  return {
    event: toFeed(r, true),
    blockHash: r.block_hash,
    logIndex: r.log_index,
    assetAddress: r.asset_address,
    revision: r.revision ?? 1,
    related: related.map((x) => toFeed(x, full)),
    ledger: full ? { ref: r.ledger_ref ?? null, reconciliationRequired: r.reconciliation_required, note: r.reconciliation_note ?? null } : null,
    revisions: full ? revs.map((x) => ({ change: x.change, reason: x.reason, at: x.created_at })) : null,
    explorer: { tx: explorerUrl(r.chain, "tx", r.tx_hash), from: explorerUrl(r.chain, "address", r.from_address), to: explorerUrl(r.chain, "address", r.to_address) },
  };
}
