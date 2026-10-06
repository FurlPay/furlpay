import { sbSelect, supabaseBackend } from "@/lib/supabase";
import { bucketIndex, type AnalyticsRange } from "@/lib/analytics/range";
import { alliumKeyConfigured, alliumQuery, type Sourced } from "./allium";
import { stablecoinMarket } from "./market";

// ---------------------------------------------------------------------------
// /onchain — the Onchain Intelligence dashboard. Three kinds of source, each
// labelled on the card it feeds:
//
//   FurlPay ledger   ops_tx_events (settled money movement, every rail) and
//                    ops_security_events, read from Supabase for the range
//                    AND the equally long window before it (for change %).
//   Market           DefiLlama's public stablecoin API (supply, coins, chains).
//   Allium           saved Explorer queries (transfer volume, active
//                    addresses, corridors) when ALLIUM_API_KEY is set.
//
// Rules, as on /analytics: a zero is a measured zero; a source that is not
// configured or failed is `unavailable` with the reason; nothing is estimated.
// Addresses and hashes leave this module truncated (0x12ab…cd34).
// ---------------------------------------------------------------------------

export const CHAIN_FILTERS = ["all", "ethereum", "base", "arbitrum", "solana", "polygon", "optimism", "avalanche"] as const;
export type ChainFilter = (typeof CHAIN_FILTERS)[number];
export function parseChain(raw: string | null): ChainFilter | null {
  const v = (raw ?? "all").toLowerCase();
  return (CHAIN_FILTERS as readonly string[]).includes(v) ? (v as ChainFilter) : null;
}

export const TOKENS = ["USDC", "USDT", "BTC", "ETH", "SOL", "OTHER"] as const;
export type TokenKey = (typeof TOKENS)[number];

export interface LedgerRow {
  rail: string;
  state: string;
  amount_usd: number | string | null;
  fee_usd?: number | string | null;
  token: string | null;
  source_chain: string | null;
  dest_chain: string | null;
  recipient: string | null;
  tx_hash: string | null;
  user_id: string | null;
  created_at: string;
}
export interface SecurityRow {
  kind: string;
  severity: string;
  created_at: string;
}

export interface Kpi {
  value: number;
  change: number | null; // ratio vs previous window
  series: number[];
}

export interface LedgerView {
  truncated: boolean;
  kpis: { volume: Kpi; transactions: Kpi; users: Kpi; recipients: Kpi; fees: Kpi };
  volumeByBucket: { bucket: string; tokens: Record<TokenKey, number> }[];
  chains: { chain: string; volume: number; count: number; share: number }[];
  rails: { rail: string; volume: number; count: number; share: number }[];
  counterparties: { address: string; volume: number; count: number; chain: string | null }[];
  flow: { sources: { label: string; value: number }[]; destinations: { label: string; value: number }[] };
  activity: { hash: string | null; rail: string; state: string; amountUsd: number | null; token: string | null; chain: string | null; at: string }[];
}

export interface RiskView {
  total: number;
  bySeverity: { low: number; medium: number; high: number };
  flagged: Kpi;
  sanctions: Kpi;
  critical: Kpi;
}

export type Section<T> = { status: "ok"; data: T; source: string; note?: string } | { status: "unavailable"; reason: string; source: string };

export interface OnchainDashboard {
  generatedAt: string;
  range: { key: string; from: string; to: string; bucket: "hour" | "day"; buckets: string[] };
  chain: ChainFilter;
  ledger: Section<LedgerView>;
  risk: Section<RiskView>;
  market: Sourced<import("./market").StablecoinMarket>;
  alliumConfigured: boolean;
  alliumDaily: Sourced<{ day: string; transferVolumeUsd: number; transferCount: number; activeAddresses: number }[]>;
  corridors: Sourced<{ from: string; to: string; volumeUsd: number }[]>;
}

const ROW_LIMIT = 20_000;
const LEDGER_SOURCE = "FurlPay ledger (ops_tx_events)";
const RISK_SOURCE = "FurlPay security events (ops_security_events)";
const iso = (ms: number) => new Date(ms).toISOString();
const isoQ = (ms: number) => encodeURIComponent(iso(ms));
const num = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v) || 0);
const ratio = (cur: number, prev: number): number | null => (prev > 0 ? (cur - prev) / prev : null);

export function shortRef(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return s.length <= 12 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function tokenKey(t: string | null): TokenKey {
  const u = (t ?? "").toUpperCase();
  if (u === "USDC" || u === "USDC.E") return "USDC";
  if (u === "USDT" || u === "USDT0") return "USDT";
  if (u === "BTC" || u === "WBTC" || u === "CBBTC") return "BTC";
  if (u === "ETH" || u === "WETH") return "ETH";
  if (u === "SOL" || u === "WSOL") return "SOL";
  return "OTHER";
}

const chainOf = (r: LedgerRow) => (r.dest_chain ?? r.source_chain ?? "").toLowerCase() || null;
const matchesChain = (r: LedgerRow, c: ChainFilter) =>
  c === "all" || (r.dest_chain ?? "").toLowerCase() === c || (r.source_chain ?? "").toLowerCase() === c;

/** Pure: everything on the ledger-backed cards, from rows of the two windows. */
export function summarizeLedger(range: AnalyticsRange, cur: LedgerRow[], prev: LedgerRow[], chain: ChainFilter): LedgerView {
  const inCur = cur.filter((r) => matchesChain(r, chain));
  const settled = inCur.filter((r) => r.state === "settled");
  const prevSettled = prev.filter((r) => matchesChain(r, chain) && r.state === "settled");

  const zero = () => range.buckets.map(() => 0);
  const volSeries = zero();
  const feeSeries = zero();
  const txSeries = zero();
  const userSets = range.buckets.map(() => new Set<string>());
  const recSets = range.buckets.map(() => new Set<string>());
  const byBucket = range.buckets.map(() => Object.fromEntries(TOKENS.map((t) => [t, 0])) as Record<TokenKey, number>);
  const chains = new Map<string, { volume: number; count: number }>();
  const rails = new Map<string, { volume: number; count: number }>();
  const cps = new Map<string, { volume: number; count: number; chain: string | null }>();
  const users = new Set<string>();
  const recipients = new Set<string>();
  let volume = 0;
  let fees = 0;

  for (const r of settled) {
    const amt = num(r.amount_usd);
    volume += amt;
    fees += num(r.fee_usd);
    const i = bucketIndex(range, Date.parse(r.created_at));
    if (i >= 0) {
      volSeries[i] += amt;
      feeSeries[i] += num(r.fee_usd);
      txSeries[i] += 1;
      byBucket[i][tokenKey(r.token)] += amt;
      if (r.user_id) userSets[i].add(r.user_id);
      if (r.recipient) recSets[i].add(r.recipient.toLowerCase());
    }
    if (r.user_id) users.add(r.user_id);
    const c = chainOf(r) ?? "unknown";
    const ch = chains.get(c) ?? { volume: 0, count: 0 };
    ch.volume += amt;
    ch.count += 1;
    chains.set(c, ch);
    const rail = rails.get(r.rail) ?? { volume: 0, count: 0 };
    rail.volume += amt;
    rail.count += 1;
    rails.set(r.rail, rail);
    if (r.recipient) {
      const k = r.recipient.toLowerCase();
      recipients.add(k);
      const cp = cps.get(k) ?? { volume: 0, count: 0, chain: chainOf(r) };
      cp.volume += amt;
      cp.count += 1;
      cps.set(k, cp);
    }
  }

  const prevVolume = prevSettled.reduce((s, r) => s + num(r.amount_usd), 0);
  const prevFees = prevSettled.reduce((s, r) => s + num(r.fee_usd), 0);
  const prevUsers = new Set(prevSettled.map((r) => r.user_id).filter(Boolean)).size;
  const prevRecipients = new Set(prevSettled.map((r) => r.recipient?.toLowerCase()).filter(Boolean)).size;
  const share = (v: number) => (volume > 0 ? v / volume : 0);

  const chainList = [...chains.entries()].map(([c, v]) => ({ chain: c, ...v, share: share(v.volume) })).sort((a, b) => b.volume - a.volume);
  const railList = [...rails.entries()].map(([rail, v]) => ({ rail, ...v, share: share(v.volume) })).sort((a, b) => b.volume - a.volume);

  return {
    truncated: cur.length >= ROW_LIMIT || prev.length >= ROW_LIMIT,
    kpis: {
      volume: { value: volume, change: ratio(volume, prevVolume), series: volSeries },
      transactions: { value: settled.length, change: ratio(settled.length, prevSettled.length), series: txSeries },
      users: { value: users.size, change: ratio(users.size, prevUsers), series: userSets.map((s) => s.size) },
      recipients: { value: recipients.size, change: ratio(recipients.size, prevRecipients), series: recSets.map((s) => s.size) },
      fees: { value: fees, change: ratio(fees, prevFees), series: feeSeries },
    },
    volumeByBucket: range.buckets.map((b, i) => ({ bucket: iso(b), tokens: byBucket[i] })),
    chains: chainList,
    rails: railList,
    counterparties: [...cps.entries()]
      .map(([address, v]) => ({ address: shortRef(address) ?? "—", ...v }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 20),
    flow: {
      sources: railList.slice(0, 5).map((r) => ({ label: r.rail, value: r.volume })),
      destinations: chainList.slice(0, 5).map((c) => ({ label: c.chain, value: c.volume })),
    },
    activity: [...inCur]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 20)
      .map((r) => ({
        hash: shortRef(r.tx_hash),
        rail: r.rail,
        state: r.state,
        amountUsd: r.amount_usd === null ? null : num(r.amount_usd),
        token: r.token,
        chain: chainOf(r),
        at: r.created_at,
      })),
  };
}

const sevBand = (s: string): "low" | "medium" | "high" => (s === "high" || s === "critical" ? "high" : s === "medium" ? "medium" : "low");

/** Pure: the Risk & Compliance card from security events of the two windows. */
export function summarizeRisk(cur: SecurityRow[], prev: SecurityRow[]): RiskView {
  const count = (rows: SecurityRow[], f: (r: SecurityRow) => boolean) => rows.filter(f).length;
  const flagged = (r: SecurityRow) => sevBand(r.severity) !== "low";
  const sanction = (r: SecurityRow) => /sanction|ofac|screen/i.test(r.kind);
  const critical = (r: SecurityRow) => r.severity === "critical";
  const k = (f: (r: SecurityRow) => boolean): Kpi => {
    const c = count(cur, f);
    return { value: c, change: ratio(c, count(prev, f)), series: [] };
  };
  return {
    total: cur.length,
    bySeverity: {
      low: count(cur, (r) => sevBand(r.severity) === "low"),
      medium: count(cur, (r) => sevBand(r.severity) === "medium"),
      high: count(cur, (r) => sevBand(r.severity) === "high"),
    },
    flagged: k(flagged),
    sanctions: k(sanction),
    critical: k(critical),
  };
}

const why = (e: unknown) => (e instanceof Error ? e.message.slice(0, 160) : "source failed");

async function ledger(range: AnalyticsRange, chain: ChainFilter): Promise<Section<LedgerView>> {
  if (supabaseBackend !== "supabase") return { status: "unavailable", reason: "No durable ledger configured (SUPABASE_URL).", source: LEDGER_SOURCE };
  const q = (from: number, to: number) =>
    sbSelect<LedgerRow>(
      "ops_tx_events",
      `select=rail,state,amount_usd,fee_usd,token,source_chain,dest_chain,recipient,tx_hash,user_id,created_at&created_at=gte.${isoQ(from)}&created_at=lt.${isoQ(to)}&order=created_at.desc&limit=${ROW_LIMIT}`
    );
  try {
    const [cur, prev] = await Promise.all([q(range.fromMs, range.toMs), q(range.prevFromMs, range.prevToMs)]);
    const data = summarizeLedger(range, cur, prev, chain);
    return { status: "ok", data, source: LEDGER_SOURCE, ...(data.truncated ? { note: `Capped at ${ROW_LIMIT.toLocaleString("en-US")} rows; totals are a lower bound.` } : {}) };
  } catch (e) {
    return { status: "unavailable", reason: why(e), source: LEDGER_SOURCE };
  }
}

async function risk(range: AnalyticsRange): Promise<Section<RiskView>> {
  if (supabaseBackend !== "supabase") return { status: "unavailable", reason: "No durable event store configured (SUPABASE_URL).", source: RISK_SOURCE };
  const q = (from: number, to: number) =>
    sbSelect<SecurityRow>("ops_security_events", `select=kind,severity,created_at&created_at=gte.${isoQ(from)}&created_at=lt.${isoQ(to)}&limit=${ROW_LIMIT}`);
  try {
    const [cur, prev] = await Promise.all([q(range.fromMs, range.toMs), q(range.prevFromMs, range.prevToMs)]);
    return { status: "ok", data: summarizeRisk(cur, prev), source: RISK_SOURCE };
  } catch (e) {
    return { status: "unavailable", reason: why(e), source: RISK_SOURCE };
  }
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<OnchainDashboard> }>();

/**
 * One shared build per (range, chain) for 60 s, with concurrent callers
 * awaiting the same promise. The page is public, so this — not the per-IP
 * limiter — is what bounds ledger reads.
 */
export function onchainCached(range: AnalyticsRange, chain: ChainFilter, now = Date.now()): Promise<OnchainDashboard> {
  const key = `${range.key}:${chain}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = buildOnchainDashboard(range, chain);
  cache.set(key, { at: now, value });
  value.catch(() => cache.delete(key));
  return value;
}

export async function buildOnchainDashboard(range: AnalyticsRange, chain: ChainFilter): Promise<OnchainDashboard> {
  const [l, r, market, daily, corridors] = await Promise.all([
    ledger(range, chain),
    risk(range),
    stablecoinMarket(),
    alliumQuery("stablecoinDaily"),
    alliumQuery("corridors"),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    range: { key: range.key, from: iso(range.fromMs), to: iso(range.toMs), bucket: range.bucket, buckets: range.buckets.map(iso) },
    chain,
    ledger: l,
    risk: r,
    market,
    alliumConfigured: alliumKeyConfigured(),
    alliumDaily:
      daily.status === "ok"
        ? {
            ...daily,
            data: daily.data
              .map((d) => ({ day: d.day.slice(0, 10), transferVolumeUsd: d.transfer_volume_usd, transferCount: d.transfer_count, activeAddresses: d.active_addresses }))
              .sort((a, b) => a.day.localeCompare(b.day)),
          }
        : daily,
    corridors:
      corridors.status === "ok"
        ? { ...corridors, data: corridors.data.map((c) => ({ from: c.from_country, to: c.to_country, volumeUsd: c.volume_usd })).sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 5) }
        : corridors,
  };
}
