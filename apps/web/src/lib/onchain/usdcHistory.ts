import { SupabaseFunctionMissing, sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { formatUnits } from "./normalize";

// ---------------------------------------------------------------------------
// USDC history from the stored network index (migration 0034). Aggregated in
// Postgres (onchain_asset_series / onchain_supply_series): the browser gets
// at most a few hundred buckets, never raw events.
//
// COVERAGE IS EXPLICIT. The index starts when a chain was first anchored and
// holds FINALIZED blocks only (Ethereum ~13 min, L2s up to ~20 min behind the
// head; the live panel covers the tip). Each chain reports coveredFrom /
// coveredTo; a range that starts before coveredFrom is marked partial and a
// chain with no coverage is excluded from totals and rankings — never shown
// as zero.
//
// Unique wallets are NOT here: distinct counts do not add across buckets and
// the index does not store addresses. They are exact for the live window only.
// ---------------------------------------------------------------------------

export const HISTORY_RANGES = ["1h", "24h", "7d", "30d", "90d", "all"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
const SPAN_MS: Record<Exclude<HistoryRange, "all">, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000, "90d": 90 * 86_400_000 };
const BUCKET: Record<HistoryRange, "minute" | "hour" | "day"> = { "1h": "minute", "24h": "hour", "7d": "hour", "30d": "day", "90d": "day", all: "day" };
const DECIMALS = 6;

export interface SeriesRow {
  bucket: string;
  chain: string;
  transfers: number | string;
  transfer_raw: string;
  mints: number | string;
  mint_raw: string;
  burns: number | string;
  burn_raw: string;
}
export interface SupplyRow {
  bucket: string;
  chain: string;
  block: number | string;
  supply_raw: string;
  decimals: number;
}
export interface Coverage {
  chain: string;
  coveredFrom: string | null;
  coveredTo: string | null;
  /** False for supply-only chains (Solana): no transfer activity is indexed there. */
  activity: boolean;
}

export interface ChainHistory {
  chain: string;
  coveredFrom: string | null;
  coveredTo: string | null;
  /** The range starts before this chain's index does. */
  partial: boolean;
  /** False for supply-only chains: transfers/volume/minted/burned are then null, never 0. */
  activity: boolean;
  transfers: number | null;
  volume: string | null;
  minted: string | null;
  burned: string | null;
  /** Supply at the first and last snapshot inside the range (exact). */
  supplyStart: string | null;
  supplyEnd: string | null;
  supplyChange: string | null;
  /** supplyChange / supplyStart; null without both snapshots. */
  supplyGrowth: number | null;
}

export interface UsdcHistory {
  generatedAt: string;
  range: HistoryRange;
  bucket: "minute" | "hour" | "day";
  from: string;
  to: string;
  available: boolean;
  reason: string | null;
  unit: "USDC";
  chains: ChainHistory[];
  /** Per bucket, per chain. Amounts are decimal USDC strings. */
  series: { bucket: string; chain: string; transfers: number; volume: string; minted: string; burned: string }[];
  supplySeries: { bucket: string; chain: string; block: number; supply: string }[];
  totals: { chains: string[]; transfers: number; volume: string; minted: string; burned: string } | null;
  rankings: {
    volume: { chain: string; value: string }[];
    transfers: { chain: string; value: number }[];
    supplyGrowth: { chain: string; value: number }[];
    supplyShare: { chain: string; value: number; supply: string }[];
    notRanked: { chain: string; reason: string }[];
  };
}

const fmt = (raw: bigint) => (raw < 0n ? "-" : "") + formatUnits((raw < 0n ? -raw : raw).toString(), DECIMALS);
const big = (v: string | number | null | undefined) => BigInt(String(v ?? "0").split(".")[0] || "0");

/** Pure: stored rows -> the response. `now` and `from` bound the range. */
export function summarizeHistory(range: HistoryRange, from: Date, to: Date, rows: SeriesRow[], supply: SupplyRow[], coverage: Coverage[]): Omit<UsdcHistory, "generatedAt" | "available" | "reason"> {
  const covered = coverage.filter((c) => c.coveredFrom && c.coveredTo && Date.parse(c.coveredTo) >= from.getTime());
  const chains: ChainHistory[] = covered.map((c) => {
    const mine = rows.filter((r) => r.chain === c.chain);
    const sup = supply.filter((s) => s.chain === c.chain).sort((a, b) => Number(a.block) - Number(b.block));
    const s0 = sup[0] ? big(sup[0].supply_raw) : null;
    const s1 = sup.length ? big(sup[sup.length - 1].supply_raw) : null;
    const change = s0 !== null && s1 !== null && sup.length > 1 ? s1 - s0 : null;
    return {
      chain: c.chain,
      coveredFrom: c.coveredFrom,
      coveredTo: c.coveredTo,
      partial: Date.parse(c.coveredFrom!) > from.getTime(),
      activity: c.activity,
      transfers: c.activity ? mine.reduce((a, r) => a + Number(r.transfers), 0) : null,
      volume: c.activity ? fmt(mine.reduce((a, r) => a + big(r.transfer_raw), 0n)) : null,
      minted: c.activity ? fmt(mine.reduce((a, r) => a + big(r.mint_raw), 0n)) : null,
      burned: c.activity ? fmt(mine.reduce((a, r) => a + big(r.burn_raw), 0n)) : null,
      supplyStart: s0 === null ? null : fmt(s0),
      supplyEnd: s1 === null ? null : fmt(s1),
      supplyChange: change === null ? null : fmt(change),
      // 1e-12 resolution: hourly supply moves on a $49B chain are far below 1e-6.
      supplyGrowth: change !== null && s0 !== null && s0 > 0n ? Number((change * 1_000_000_000_000n) / s0) / 1e12 : null,
    };
  });
  const coveredSet = new Set(chains.map((c) => c.chain));
  const act = chains.filter((c) => c.activity);
  const notRanked = [
    ...coverage.filter((c) => !coveredSet.has(c.chain)).map((c) => ({ chain: c.chain, reason: c.coveredTo ? "No indexed data in this range." : "Not indexed yet." })),
    ...chains.filter((c) => !c.activity).map((c) => ({ chain: c.chain, reason: "Supply only: network-wide transfer activity needs a Geyser stream." })),
  ];
  const addDec = (vals: string[]) => fmt(vals.reduce((a, v) => a + BigInt(v.replace("-", "").split(".")[0] + (v.split(".")[1] ?? "").padEnd(DECIMALS, "0")) * (v.startsWith("-") ? -1n : 1n), 0n));
  const latestSupply = chains.filter((c) => c.supplyEnd !== null);
  const totalSupplyRaw = latestSupply.reduce((a, c) => a + BigInt(c.supplyEnd!.split(".")[0] + (c.supplyEnd!.split(".")[1] ?? "").padEnd(DECIMALS, "0")), 0n);
  const toRawN = (v: string) => Number(v);
  return {
    range,
    bucket: BUCKET[range],
    from: from.toISOString(),
    to: to.toISOString(),
    unit: "USDC",
    chains,
    series: rows.map((r) => ({ bucket: new Date(r.bucket).toISOString(), chain: r.chain, transfers: Number(r.transfers), volume: fmt(big(r.transfer_raw)), minted: fmt(big(r.mint_raw)), burned: fmt(big(r.burn_raw)) })),
    supplySeries: supply.map((s) => ({ bucket: new Date(s.bucket).toISOString(), chain: s.chain, block: Number(s.block), supply: fmt(big(s.supply_raw)) })),
    totals: act.length
      ? { chains: act.map((c) => c.chain), transfers: act.reduce((a, c) => a + c.transfers!, 0), volume: addDec(act.map((c) => c.volume!)), minted: addDec(act.map((c) => c.minted!)), burned: addDec(act.map((c) => c.burned!)) }
      : null,
    rankings: {
      volume: [...act].sort((a, b) => toRawN(b.volume!) - toRawN(a.volume!)).map((c) => ({ chain: c.chain, value: c.volume! })),
      transfers: [...act].sort((a, b) => b.transfers! - a.transfers!).map((c) => ({ chain: c.chain, value: c.transfers! })),
      supplyGrowth: chains.filter((c) => c.supplyGrowth !== null).sort((a, b) => b.supplyGrowth! - a.supplyGrowth!).map((c) => ({ chain: c.chain, value: c.supplyGrowth! })),
      supplyShare:
        totalSupplyRaw > 0n
          ? latestSupply
              .map((c) => {
                const raw = BigInt(c.supplyEnd!.split(".")[0] + (c.supplyEnd!.split(".")[1] ?? "").padEnd(DECIMALS, "0"));
                return { chain: c.chain, value: Number((raw * 1_000_000n) / totalSupplyRaw) / 1_000_000, supply: c.supplyEnd! };
              })
              .sort((a, b) => b.value - a.value)
          : [],
      notRanked,
    },
  };
}

const TTL_MS = 30_000;
const cache = new Map<HistoryRange, { at: number; p: Promise<UsdcHistory> }>();
// sbRpc signals a missing Postgres function with its own error type whose message is just the name.
const missing = (e: unknown) => e instanceof SupabaseFunctionMissing || /does not exist|PGRST205|PGRST202|Could not find the (table|function)|42P01|42883/i.test((e as Error).message);

export function usdcHistory(range: HistoryRange, now = Date.now()): Promise<UsdcHistory> {
  const hit = cache.get(range);
  if (hit && now - hit.at < TTL_MS) return hit.p;
  const p = build(range, now);
  cache.set(range, { at: now, p });
  p.catch(() => cache.delete(range));
  return p;
}

async function build(range: HistoryRange, now: number): Promise<UsdcHistory> {
  const to = new Date(now);
  const from = new Date(range === "all" ? Date.UTC(2009, 0, 3) : now - SPAN_MS[range]);
  const empty = (reason: string): UsdcHistory => ({
    ...summarizeHistory(range, from, to, [], [], []),
    generatedAt: new Date(now).toISOString(),
    available: false,
    reason,
  });
  if (supabaseBackend !== "supabase") return empty("No durable store configured (SUPABASE_URL): history is not stored.");
  try {
    const [rows, supply, cursors, firsts] = await Promise.all([
      sbRpc<SeriesRow[]>("onchain_asset_series", { p_asset: "usdc", p_from: from.toISOString(), p_to: to.toISOString(), p_bucket: BUCKET[range] }),
      sbRpc<SupplyRow[]>("onchain_supply_series", { p_asset: "usdc", p_from: from.toISOString(), p_to: to.toISOString(), p_bucket: BUCKET[range] }),
      sbSelect<{ chain: string; last_block_time: string; started_block: number | string }>("onchain_asset_cursors", "select=chain,last_block_time,started_block&asset=eq.usdc"),
      sbSelect<{ chain: string; block_time: string }>("onchain_supply_snapshots", "select=chain,block_time&asset=eq.usdc&order=block_time.asc&limit=1000"),
    ]);
    const firstByChain = new Map<string, string>();
    for (const f of firsts) if (!firstByChain.has(f.chain)) firstByChain.set(f.chain, f.block_time);
    const coverage: Coverage[] = cursors.map((c) => ({ chain: c.chain, coveredFrom: firstByChain.get(c.chain) ?? null, coveredTo: c.last_block_time, activity: true }));
    // Solana: supply snapshots only (no network-wide transfer index without Geyser).
    if (!coverage.some((c) => c.chain === "solana") && firstByChain.has("solana")) {
      const last = supply.filter((s) => s.chain === "solana").at(-1);
      coverage.push({ chain: "solana", coveredFrom: firstByChain.get("solana")!, coveredTo: last ? new Date(last.bucket).toISOString() : null, activity: false });
    }
    return { ...summarizeHistory(range, from, to, rows ?? [], supply ?? [], coverage), generatedAt: new Date(now).toISOString(), available: true, reason: coverage.length ? null : "Nothing indexed yet: the network index starts when the tail worker first runs." };
  } catch (e) {
    return empty(missing(e) ? "Network index tables are not migrated yet (apply migration 0034)." : `Index store unreachable: ${(e as Error).message.slice(0, 120)}`);
  }
}
