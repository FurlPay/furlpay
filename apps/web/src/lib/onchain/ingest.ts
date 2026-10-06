import crypto from "crypto";
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
}
export interface IngestCounts {
  inserted: number;
  duplicates: number;
  promoted: number;
  reorg_replaced: number;
  reinstated: number;
}
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
    scoped.push({
      ...t,
      direction: to && from ? "self" : to ? "in" : "out",
      tracked_address: to ? t.to_address : t.from_address,
      scope: primary.scope,
      user_id: primary.user_id,
    });
  }
  return { scoped, ignored };
}

export async function persist(events: Scoped[]): Promise<IngestCounts> {
  const total = { ...ZERO_COUNTS };
  if (events.length === 0) return total;
  if (supabaseBackend !== "supabase") throw new Error("no durable store configured (SUPABASE_URL)");
  for (let i = 0; i < events.length; i += 500) {
    const r = await sbRpc<IngestCounts>("onchain_ingest", { p_events: events.slice(i, i + 500) });
    for (const k of Object.keys(total) as (keyof IngestCounts)[]) total[k] += Number(r?.[k] ?? 0);
  }
  return total;
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
  return out;
}
