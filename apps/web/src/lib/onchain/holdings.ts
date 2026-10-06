import { z } from "zod";
import type { Sourced } from "./allium";
import { alliumCall } from "./sync";
import { trackedAddresses } from "./ingest";

// ---------------------------------------------------------------------------
// FurlPay-owned onchain holdings (the dashboard's "Treasury Holdings" card),
// from Allium's Realtime API (verified docs.allium.so, Oct 2026):
//
//   POST /api/v1/developer/wallet/balances?with_liquidity_info=true
//   body [{chain,address}] (1-100) -> items[]: token{chain,address,decimals,
//   price, info{symbol}, attributes.total_liquidity_usd.amount},
//   raw_balance_str, block_timestamp
//
// SCOPE: treasury (TREASURY_ADDRESS_<CHAIN>) and watch-list addresses only.
// A user's linked wallet is self-custody — it is not under FurlPay's
// management, and summing it would overstate what FurlPay holds.
//
// VALUE: quantity is exact (raw_balance_str scaled by decimals as a string);
// USD = quantity x the provider's price (a float, display only). A token
// with no price, or with under $100k of DEX liquidity, is listed but NOT
// counted: unpriced or illiquid "balances" (airdropped spam) are the classic
// way an onchain AUM figure gets inflated.
// ---------------------------------------------------------------------------

const MIN_LIQUIDITY_USD = 100_000;
const CACHE_MS = 5 * 60_000;

const item = z
  .object({
    chain: z.string(),
    address: z.string(),
    token: z
      .object({
        address: z.string().nullish(),
        decimals: z.number().int().min(0).max(255).nullish(),
        price: z.number().finite().nullish(),
        info: z.object({ symbol: z.string().nullish(), name: z.string().nullish() }).partial().nullish(),
        attributes: z.object({ total_liquidity_usd: z.object({ amount: z.number().nullish() }).partial().nullish() }).partial().passthrough().nullish(),
      })
      .passthrough(),
    raw_balance_str: z.string().regex(/^\d{1,78}$/),
    block_timestamp: z.string().nullish(),
  })
  .passthrough();
const resp = z.object({ items: z.array(z.unknown()), cursor: z.string().nullish() });

export interface Holdings {
  totalUsd: number;
  counted: number;
  excluded: number;
  addresses: number;
  byAsset: { symbol: string; chain: string; quantity: string; usd: number }[];
  asOf: string | null;
}

/** "1300000000000000000", 18 -> "1.3" (exact, string arithmetic). */
export function scaleRaw(raw: string, decimals: number): string {
  const s = raw.replace(/^0+(?=\d)/, "");
  if (decimals === 0) return s;
  const padded = s.padStart(decimals + 1, "0");
  const int = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

export function summarizeHoldings(items: unknown[], addresses: number): Holdings {
  const byAsset = new Map<string, { symbol: string; chain: string; quantity: string; usd: number }>();
  let total = 0, counted = 0, excluded = 0;
  let asOf: string | null = null;
  for (const raw of items) {
    const p = item.safeParse(raw);
    if (!p.success || p.data.token.decimals === null || p.data.token.decimals === undefined) {
      excluded++;
      continue;
    }
    const t = p.data.token;
    const qty = scaleRaw(p.data.raw_balance_str, t.decimals!);
    const liq = t.attributes?.total_liquidity_usd?.amount ?? null;
    if (qty === "0") continue;
    if (!t.price || t.price <= 0 || liq === null || liq < MIN_LIQUIDITY_USD) {
      excluded++;
      continue;
    }
    const usd = Number(qty) * t.price;
    if (!Number.isFinite(usd)) {
      excluded++;
      continue;
    }
    counted++;
    total += usd;
    const symbol = (t.info?.symbol ?? "?").slice(0, 16);
    const key = `${p.data.chain}:${(t.address ?? symbol).toLowerCase()}`;
    const prev = byAsset.get(key);
    byAsset.set(key, { symbol, chain: p.data.chain, quantity: prev ? String(Number(prev.quantity) + Number(qty)) : qty, usd: (prev?.usd ?? 0) + usd });
    if (p.data.block_timestamp && (!asOf || p.data.block_timestamp > asOf)) asOf = p.data.block_timestamp;
  }
  return { totalUsd: total, counted, excluded, addresses, byAsset: [...byAsset.values()].sort((a, b) => b.usd - a.usd).slice(0, 8), asOf };
}

let cache: { at: number; value: Promise<Sourced<Holdings>> } | null = null;
const SOURCE = "Allium Realtime API (wallet balances) for FurlPay treasury/watch addresses";

export function treasuryHoldings(now = Date.now()): Promise<Sourced<Holdings>> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  const value = build();
  cache = { at: now, value };
  value.then((v) => v.status === "unavailable" && (cache = null)).catch(() => (cache = null));
  return value;
}
export function __resetHoldingsCache() {
  cache = null;
}

async function build(): Promise<Sourced<Holdings>> {
  if (!(process.env.ALLIUM_API_KEY ?? "").trim()) return { status: "unavailable", reason: "ALLIUM_API_KEY is not set.", source: SOURCE };
  try {
    const owned = (await trackedAddresses(0)).filter((t) => t.scope !== "user" && Array.isArray(t.chains));
    const pairs = owned.flatMap((t) => (t.chains as string[]).map((chain) => ({ chain, address: t.address })));
    if (pairs.length === 0) return { status: "unavailable", reason: "No FurlPay-owned address configured (TREASURY_ADDRESS_<CHAIN> or ONCHAIN_WATCH_ADDRESSES with a chain).", source: SOURCE };
    const items: unknown[] = [];
    for (let i = 0; i < pairs.length; i += 100) {
      const r = resp.parse(await alliumCall("/api/v1/developer/wallet/balances?with_liquidity_info=true", { method: "POST", body: JSON.stringify(pairs.slice(i, i + 100)) }));
      items.push(...r.items);
    }
    const h = summarizeHoldings(items, new Set(pairs.map((p) => p.address)).size);
    return { status: "ok", data: h, asOf: h.asOf ?? new Date().toISOString(), source: SOURCE };
  } catch (e) {
    return { status: "unavailable", reason: e instanceof Error ? e.message.slice(0, 160) : "request failed", source: SOURCE };
  }
}
