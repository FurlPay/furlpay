import crypto from "crypto";
import { screenWallet } from "@furlpay/compliance";
import { recordSecurityEvent } from "@/lib/ops/events";
import { kvSet } from "@/lib/kv";
import { log } from "@/lib/log";
import { findLinkedWalletOwner } from "@/lib/linkedWalletStore";
import { sbInsertIgnoreDuplicates, sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import type { Transfer } from "./normalize";

// ---------------------------------------------------------------------------
// Scope + persistence for normalized onchain transfers.
//
// SCOPE — only activity touching an address FurlPay tracks is stored:
//   user      a VERIFIED linked wallet (linked_wallets, EIP-191 proven)
//   treasury  TREASURY_ADDRESS_<CHAIN> (the same variable deposit-detect uses)
//   watch     ONCHAIN_WATCH_ADDRESSES: "chain:address" or "*:address", comma-separated
// Everything else is ignored (counted, not stored). A lookup failure throws so
// the caller answers 5xx and the provider redelivers — never "ignored".
//
// PERSISTENCE — one RPC, onchain_ingest (migration 0032): idempotent on
// event_key, forward-only confirmation states, reorg replacement with an
// audit trail, hourly rollup rebuilt for the touched hours. This module never
// writes to the ledger, balances, payments or settlements.
// ---------------------------------------------------------------------------

export type Scope = "user" | "treasury" | "watch";
export interface Scoped extends Transfer {
  direction: "in" | "out" | "self";
  tracked_address: string;
  scope: Scope;
  user_id: string | null;
  /** OFAC SDN screen of the counterparty (the side FurlPay does not track). */
  risk_action: "allow" | "review" | "block";
  risk_flags: string[];
}
export interface IngestCounts {
  inserted: number;
  duplicates: number;
  promoted: number;
  reorg_replaced: number;
  reinstated: number;
}
type IngestResult = IngestCounts & { blocked_keys?: string[] };
export const ZERO_COUNTS: IngestCounts = { inserted: 0, duplicates: 0, promoted: 0, reorg_replaced: 0, reinstated: 0 };

const EVM = /^0x[0-9a-f]{40}$/;

function watchList(): { chain: string; address: string }[] {
  return (process.env.ONCHAIN_WATCH_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      const chain = i > 0 ? s.slice(0, i).toLowerCase() : "*";
      const raw = i > 0 ? s.slice(i + 1) : s;
      return { chain, address: EVM.test(raw.toLowerCase()) ? raw.toLowerCase() : raw };
    });
}

function treasuryFor(chain: string): string | null {
  const v = process.env[`TREASURY_ADDRESS_${chain.toUpperCase().replace(/-/g, "_")}`];
  if (!v) return null;
  return EVM.test(v.toLowerCase()) ? v.toLowerCase() : v.trim();
}

type Who = { scope: Scope; user_id: string | null } | null;

/**
 * Operator-registered wallets (migration 0034): one wallet, any number of
 * (chain, address) pairs — the chain-agnostic way to track a treasury or a
 * watched counterparty on EVM chains and Solana alike. Cached for 30 s per
 * instance. Before 0034 is applied the table does not exist: that is "no
 * registered wallets", reported once, not an error that blocks ingestion.
 * Any other failure throws, so a webhook is redelivered rather than dropped.
 */
const REG_TTL_MS = 30_000;
let reg: { at: number; rows: { chain: string; address: string; scope: Scope }[] } | null = null;
let regMissingLogged = false;
export function resetRegisteredCache() {
  reg = null;
}
export async function registeredAddresses(now = Date.now()): Promise<{ chain: string; address: string; scope: Scope }[]> {
  if (supabaseBackend !== "supabase") return [];
  if (reg && now - reg.at < REG_TTL_MS) return reg.rows;
  try {
    const wallets = await sbSelect<{ id: string; scope: "treasury" | "watch" }>("onchain_tracked_wallets", "select=id,scope&active=eq.true&limit=1000");
    const scopes = new Map(wallets.map((w) => [w.id, w.scope]));
    const addrs = wallets.length ? await sbSelect<{ wallet_id: string; chain: string; address: string }>("onchain_tracked_addresses", "select=wallet_id,chain,address&limit=5000") : [];
    const rows = addrs.filter((a) => scopes.has(a.wallet_id)).map((a) => ({ chain: a.chain, address: a.address, scope: scopes.get(a.wallet_id)! as Scope }));
    reg = { at: now, rows };
    return rows;
  } catch (e) {
    const m = (e as Error).message;
    if (/does not exist|PGRST205|Could not find the table|42P01/i.test(m)) {
      if (!regMissingLogged) log.warn("onchain_tracked_wallets missing (apply migration 0034); no registered wallets", {});
      regMissingLogged = true;
      reg = { at: now, rows: [] };
      return [];
    }
    throw e;
  }
}

/** Who an address belongs to, if FurlPay tracks it. Throws when the lookup itself fails. */
export async function resolveAddress(chain: string, address: string, cache = new Map<string, Who>()): Promise<Who> {
  const key = `${chain}:${address}`;
  if (cache.has(key)) return cache.get(key)!;
  let who: Who = null;
  if (treasuryFor(chain) === address) who = { scope: "treasury", user_id: null };
  else if (EVM.test(address)) {
    const owner = await findLinkedWalletOwner(address);
    if (owner) who = { scope: "user", user_id: owner };
  }
  if (!who && watchList().some((w) => (w.chain === "*" || w.chain === chain) && w.address === address)) who = { scope: "watch", user_id: null };
  if (!who) {
    const hit = (await registeredAddresses()).find((r) => r.chain === chain && r.address === address);
    if (hit) who = { scope: hit.scope, user_id: null };
  }
  cache.set(key, who);
  return who;
}

/** Attach scope/direction; transfers touching no tracked address are dropped. */
export async function scopeTransfers(transfers: Transfer[]): Promise<{ scoped: Scoped[]; ignored: number }> {
  const cache = new Map<string, Who>();
  const scoped: Scoped[] = [];
  let ignored = 0;
  for (const t of transfers) {
    const [to, from] = await Promise.all([resolveAddress(t.chain, t.to_address, cache), resolveAddress(t.chain, t.from_address, cache)]);
    if (!to && !from) {
      ignored++;
      continue;
    }
    const primary = to ?? from!;
    // AML floor at ingest: the local, synchronous OFAC SDN list
    // (packages/compliance). Both sides are screened — a tracked address can
    // also be listed. A hit FLAGS the event and raises one security event;
    // nothing is frozen or moved (this is a read model, not the ledger).
    const screens = [t.from_address, t.to_address].map((a) => screenWallet(a));
    const hit = screens.find((x) => x.action === "block") ?? screens.find((x) => x.action === "review");
    scoped.push({
      ...t,
      direction: to && from ? "self" : to ? "in" : "out",
      tracked_address: to ? t.to_address : t.from_address,
      scope: primary.scope,
      user_id: primary.user_id,
      risk_action: hit?.action ?? "allow",
      risk_flags: hit ? [hit.provider, ...hit.categories].slice(0, 10) : [],
    });
  }
  return { scoped, ignored };
}

export async function persist(events: Scoped[]): Promise<IngestCounts> {
  const total = { ...ZERO_COUNTS };
  if (events.length === 0) return total;
  if (supabaseBackend !== "supabase") throw new Error("no durable store configured (SUPABASE_URL)");
  const blocked: string[] = [];
  for (let i = 0; i < events.length; i += 500) {
    const r = await sbRpc<IngestResult>("onchain_ingest", { p_events: events.slice(i, i + 500) });
    for (const k of Object.keys(total) as (keyof IngestCounts)[]) total[k] += Number(r?.[k] ?? 0);
    blocked.push(...(r?.blocked_keys ?? []));
  }
  // onchain_ingest reports a blocked key only on its FIRST insert, so a
  // redelivered event can never raise a second alert.
  for (const key of blocked) {
    await recordSecurityEvent({ kind: "sanctions_screen_hit", rail: "transfers", severity: "high", detail: `OFAC SDN counterparty on onchain event ${key}` }).catch((e) =>
      log.error("onchain sanctions alert failed", { error: (e as Error).message.slice(0, 160) })
    );
  }
  if (total.inserted + total.promoted + total.reorg_replaced + total.reinstated > 0) await publishChange();
  return total;
}

/**
 * Hot-state fan-out: one Redis key that every SSE connection on every
 * instance can read without touching Postgres. Best effort — Postgres stays
 * the source of truth, and the stream falls back to it when Redis is down.
 */
export const ONCHAIN_VERSION_KEY = "onchain:version";
export async function publishChange(): Promise<void> {
  await kvSet(ONCHAIN_VERSION_KEY, Date.now(), 7 * 24 * 3600).catch(() => {});
}

/** Freshness bookkeeping for an upstream source (onchain_source_status). Never throws. */
export async function touchSource(source: string, ok: boolean, opts: { error?: string; dataAt?: string | null } = {}): Promise<void> {
  if (supabaseBackend !== "supabase") return;
  await sbRpc("onchain_touch_source", { p_source: source, p_ok: ok, p_error: opts.error ?? null, p_data_at: opts.dataAt ?? null }).catch(() => {});
}

/** Authenticated-but-unusable payloads. Deduplicated on content; never retried automatically. */
export async function deadLetter(source: string, reason: string, payload: unknown): Promise<void> {
  if (supabaseBackend !== "supabase") return;
  const body = JSON.stringify(payload ?? null);
  const payload_hash = crypto.createHash("sha256").update(body).digest("hex");
  await sbInsertIgnoreDuplicates("onchain_dead_letters", {
    source,
    reason: reason.slice(0, 300),
    payload_hash,
    // Bounded: a hostile-but-signed payload cannot balloon the table.
    payload: body.length <= 32_000 ? JSON.parse(body) : { truncated: true, bytes: body.length },
  });
}

/** Every address backfill/reconciliation should query, by chain family. */
export async function trackedAddresses(limit = 2_000): Promise<{ address: string; chains: "evm" | string[]; scope: Scope }[]> {
  const out: { address: string; chains: "evm" | string[]; scope: Scope }[] = [];
  if (supabaseBackend === "supabase") {
    const rows = await sbSelect<{ address_norm: string }>("linked_wallets", `select=address_norm&status=eq.active&order=linked_at.desc&limit=${limit}`);
    for (const r of rows) out.push({ address: r.address_norm, chains: "evm", scope: "user" });
  }
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^TREASURY_ADDRESS_([A-Z0-9_]+)$/.exec(k);
    if (m && v) out.push({ address: EVM.test(v.toLowerCase()) ? v.toLowerCase() : v.trim(), chains: [m[1].toLowerCase()], scope: "treasury" });
  }
  for (const w of watchList()) out.push({ address: w.address, chains: w.chain === "*" ? (EVM.test(w.address) ? "evm" : ["solana"]) : [w.chain], scope: "watch" });
  for (const r of await registeredAddresses()) out.push({ address: r.address, chains: [r.chain], scope: r.scope });
  return out;
}
