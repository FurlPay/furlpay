import { z } from "zod";
import { sbInsert, sbRpc, sbSelect, sbUpdate, sbUpsert, supabaseBackend } from "@/lib/supabase";
import { log } from "@/lib/log";
import { raiseFinancialAlert } from "@/lib/ops/financialAlerts";
import { alliumKeyConfigured } from "./allium";
import { normalizeWalletItem, type Transfer } from "./normalize";
import { persist, scopeTransfers, touchSource, trackedAddresses, ZERO_COUNTS, type IngestCounts } from "./ingest";

// ---------------------------------------------------------------------------
// Backfill + reconciliation over Allium's Realtime API (verified against
// docs.allium.so, Oct 2026):
//
//   chains   GET  https://api.allium.so/api/v1/supported-chains/realtime-apis
//            (public; endpoints.wallet_transactions per chain). Discovery, not
//            a hard-coded list; ONCHAIN_SYNC_CHAINS may narrow it.
//   history  POST https://api.allium.so/api/v1/developer/wallet/transactions
//            body [{chain,address}] (1-20 pairs), ?limit<=1000&cursor=…,
//            X-API-KEY. items[].asset_transfers[] carry log_index + block_hash.
//
// The stream (Beam) is the primary path; this job fills gaps and checks it:
//   - inserts anything the stream missed (idempotent, so overlap is free)
//   - promotes events older than the finality margin to 'finalized'
//   - marks stored events the provider no longer returns inside a FULLY
//     paginated window as 'reorged' (Allium corrects reorgs by replacement)
//   - flags ledger disagreements (reconciliation_required) — never writes back
//
// Calls retry 429/5xx with exponential backoff + jitter (3 attempts), honour
// Retry-After, and stop the run (partial, recorded) when the budget expires.
// ---------------------------------------------------------------------------

const API = "https://api.allium.so";
const PAGE_LIMIT = 1000;
const MAX_PAGES_PER_BATCH = 10;
/** Older than this, Allium's per-chain finality window has passed on every
 *  chain it documents except Linea (~2.3h) and Gnosis (~25min). 3h covers all. */
export const FINALITY_MARGIN_MS = 3 * 3_600_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AlliumError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** One Allium call with retry/backoff/jitter. Never logs the key or the body. */
export async function alliumCall(path: string, init: RequestInit & { timeoutMs?: number } = {}, attempts = 3): Promise<unknown> {
  const key = (process.env.ALLIUM_API_KEY ?? "").trim();
  if (!key) throw new AlliumError(0, "ALLIUM_API_KEY is not set");
  let last: Error = new Error("no attempt");
  for (let i = 0; i < attempts; i++) {
    const started = Date.now();
    try {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { "X-API-KEY": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
        cache: "no-store",
      });
      log.info("allium api", { path: path.split("?")[0], status: res.status, ms: Date.now() - started });
      if (res.ok) return await res.json();
      if (res.status === 401 || res.status === 403) throw new AlliumError(res.status, `Allium responded ${res.status} (check ALLIUM_API_KEY)`);
      if (res.status !== 429 && res.status < 500) throw new AlliumError(res.status, `Allium responded ${res.status}`);
      last = new AlliumError(res.status, `Allium responded ${res.status}`);
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : 500 * 2 ** i + Math.random() * 250);
    } catch (e) {
      if (e instanceof AlliumError && e.status !== 429 && e.status < 500) throw e;
      last = e instanceof Error ? e : new Error(String(e));
      if (!(e instanceof AlliumError)) await sleep(500 * 2 ** i + Math.random() * 250);
    }
  }
  throw last;
}

const chainsSchema = z.array(
  z.object({ id: z.string(), chain_type: z.string().nullish(), endpoints: z.record(z.object({ availability: z.string().nullish() }).passthrough().nullable()).nullish() }).passthrough()
);
let chainCache: { at: number; evm: string[]; all: string[] } | null = null;

/** Chains whose wallet_transactions endpoint is GA/beta right now, from Allium itself. */
export async function discoverChains(now = Date.now()): Promise<{ evm: string[]; all: string[] }> {
  if (chainCache && now - chainCache.at < 24 * 3_600_000) return chainCache;
  const res = await fetch(`${API}/api/v1/supported-chains/realtime-apis`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new AlliumError(res.status, `chain discovery responded ${res.status}`);
  const rows = chainsSchema.parse(await res.json());
  const allow = (process.env.ONCHAIN_SYNC_CHAINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ok = rows.filter((c) => {
    const a = c.endpoints?.wallet_transactions?.availability;
    return (a === "ga" || a === "beta") && (allow.length === 0 || allow.includes(c.id));
  });
  chainCache = { at: now, evm: ok.filter((c) => c.chain_type === "EVM").map((c) => c.id), all: ok.map((c) => c.id) };
  return chainCache;
}
export function __resetChainCache() {
  chainCache = null;
}

const page = z.object({ items: z.array(z.unknown()), cursor: z.string().nullish() });

export interface SyncReport {
  runId: number | null;
  status: "ok" | "partial" | "failed" | "not_configured";
  reason?: string;
  addresses: number;
  providerEvents: number;
  counts: IngestCounts;
  markedReorged: number;
  ledgerFlagged: number;
  errors: string[];
}

/**
 * Backfill (`kind: "backfill"`, long lookback) or reconcile (short lookback,
 * daily). `deadline()` is checked between batches; an expired budget ends the
 * run as `partial`, recorded, never silently.
 */
export async function syncOnchain(kind: "backfill" | "reconcile", opts: { lookbackHours: number; deadline: () => boolean; now?: number }): Promise<SyncReport> {
  const now = opts.now ?? Date.now();
  const report: SyncReport = { runId: null, status: "ok", addresses: 0, providerEvents: 0, counts: { ...ZERO_COUNTS }, markedReorged: 0, ledgerFlagged: 0, errors: [] };
  if (!alliumKeyConfigured()) return { ...report, status: "not_configured", reason: "ALLIUM_API_KEY is not set." };
  if (supabaseBackend !== "supabase") return { ...report, status: "not_configured", reason: "No durable store (SUPABASE_URL)." };

  const windowStart = now - opts.lookbackHours * 3_600_000;
  const [run] = (await sbInsert<{ kind: string }>("onchain_reconciliation_runs", { kind })) as unknown as { id: number }[];
  report.runId = run?.id ?? null;

  try {
    const chains = await discoverChains(now);
    const tracked = await trackedAddresses();
    const pairs: { chain: string; address: string }[] = [];
    for (const t of tracked) {
      const list = t.chains === "evm" ? chains.evm : t.chains.filter((c) => chains.all.includes(c));
      for (const chain of list) pairs.push({ chain, address: t.address });
    }
    report.addresses = new Set(pairs.map((p) => p.address)).size;

    for (let i = 0; i < pairs.length; i += 20) {
      if (opts.deadline()) {
        report.status = "partial";
        report.errors.push(`budget expired after ${i} of ${pairs.length} (chain, address) pairs`);
        break;
      }
      const batch = pairs.slice(i, i + 20);
      try {
        await syncBatch(batch, windowStart, now, report);
      } catch (e) {
        report.status = "partial";
        report.errors.push((e as Error).message.slice(0, 200));
        if (e instanceof AlliumError && (e.status === 401 || e.status === 403)) break;
      }
    }
  } catch (e) {
    report.status = "failed";
    report.errors.push((e as Error).message.slice(0, 200));
  }

  if (report.runId !== null) {
    await sbUpdate("onchain_reconciliation_runs", `id=eq.${report.runId}`, {
      finished_at: new Date().toISOString(),
      status: report.status,
      addresses: report.addresses,
      provider_events: report.providerEvents,
      inserted: report.counts.inserted,
      duplicates: report.counts.duplicates,
      reorg_replaced: report.counts.reorg_replaced,
      marked_reorged: report.markedReorged,
      ledger_flagged: report.ledgerFlagged,
      errors: report.errors.slice(0, 20),
    }).catch((e) => log.error("onchain run record update failed", { error: (e as Error).message.slice(0, 160) }));
  }
  await touchSource("allium_realtime_api", report.status === "ok" || report.status === "partial", { error: report.errors[0] });
  if (report.ledgerFlagged > 0) void raiseFinancialAlert("onchain_ledger_mismatch", { flagged: report.ledgerFlagged, runId: report.runId });
  return report;
}

async function syncBatch(batch: { chain: string; address: string }[], windowStart: number, now: number, report: SyncReport) {
  const transfers: Transfer[] = [];
  let cursor: string | null = null;
  let complete = false;
  for (let p = 0; p < MAX_PAGES_PER_BATCH; p++) {
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) qs.set("cursor", cursor);
    const body = page.parse(await alliumCall(`/api/v1/developer/wallet/transactions?${qs}`, { method: "POST", body: JSON.stringify(batch) }));
    let olderSeen = false;
    for (const raw of body.items) {
      const n = normalizeWalletItem(raw);
      if (!n.ok) continue;
      for (const t of n.transfers) {
        const at = Date.parse(t.block_timestamp);
        if (at < windowStart) {
          olderSeen = true;
          continue;
        }
        // Still returned, in the same block, after the finality margin.
        if (now - at > FINALITY_MARGIN_MS) t.confirmation_state = "finalized";
        transfers.push(t);
      }
    }
    cursor = body.cursor ?? null;
    if (!cursor || olderSeen) {
      complete = true;
      break;
    }
  }
  report.providerEvents += transfers.length;

  const { scoped } = await scopeTransfers(transfers);
  const counts = await persist(scoped);
  for (const k of Object.keys(counts) as (keyof IngestCounts)[]) report.counts[k] += counts[k];

  const at = new Date().toISOString();
  await sbUpsert(
    "onchain_ingest_checkpoints",
    batch.map((b) => ({ chain: b.chain, address: b.address, last_run_at: at, last_status: complete ? "complete" : "truncated", last_error: null, events_seen: transfers.filter((t) => t.chain === b.chain && (t.to_address === b.address || t.from_address === b.address)).length }))
  ).catch(() => {});

  // Reorg detection only over a window the provider returned in FULL.
  if (complete) {
    const returned = new Set(transfers.map((t) => t.event_key));
    const finalBefore = new Date(now - FINALITY_MARGIN_MS).toISOString();
    for (const b of batch) {
      const stored = await sbSelect<{ event_key: string }>(
        "onchain_events",
        `select=event_key&chain=eq.${encodeURIComponent(b.chain)}&tracked_address=eq.${encodeURIComponent(b.address)}&confirmation_state=neq.reorged&block_timestamp=gte.${encodeURIComponent(new Date(windowStart).toISOString())}&block_timestamp=lt.${encodeURIComponent(finalBefore)}&limit=5000`
      );
      for (const s of stored) {
        if (returned.has(s.event_key)) continue;
        const marked = await sbRpc<boolean>("onchain_mark_reorged", { p_event_key: s.event_key, p_reason: "not returned by Allium for a fully paginated window past finality" });
        if (marked) report.markedReorged++;
      }
    }
  }

  report.ledgerFlagged += await correlateLedger(scoped.map((s) => s.tx_hash), scoped);
}

/**
 * Compare chain events with the FurlPay ledger by transaction hash. A ledger
 * row claiming a settlement whose hash has no matching transfer amount is
 * FLAGGED (reconciliation_required). Nothing is written to the ledger.
 */
export async function correlateLedger(hashes: string[], events: { event_key: string; tx_hash: string; amount_usd: string | null }[]): Promise<number> {
  const uniq = [...new Set(hashes)].slice(0, 200);
  if (uniq.length === 0) return 0;
  const rows = await sbSelect<{ id: string; tx_hash: string; state: string; amount_usd: number | string | null }>(
    "ops_tx_events",
    `select=id,tx_hash,state,amount_usd&tx_hash=in.(${uniq.map((h) => `"${h}"`).join(",")})&limit=1000`
  );
  let flagged = 0;
  for (const l of rows) {
    if (l.state !== "settled" || l.amount_usd === null) continue;
    const ledgerUsd = Number(l.amount_usd);
    const mine = events.filter((e) => e.tx_hash === l.tx_hash.toLowerCase() || e.tx_hash === l.tx_hash);
    const priced = mine.filter((e) => e.amount_usd !== null);
    if (priced.length === 0) continue;
    const matches = priced.some((e) => Math.abs(Number(e.amount_usd) - ledgerUsd) <= Math.max(1, ledgerUsd * 0.01));
    if (!matches) {
      const ok = await sbRpc<boolean>("onchain_flag_ledger", {
        p_event_key: priced[0].event_key,
        p_ledger_ref: l.id,
        p_note: `ledger ${l.id} settled $${ledgerUsd.toFixed(2)}; no transfer in this tx within 1%`,
      });
      if (ok) flagged++;
    }
  }
  return flagged;
}
