// DeFiLlama — TVL, stablecoins, DEX volume, fees/revenue, RWA.
//
// Every endpoint used here was verified to answer without a key. One did not:
// `bridges.llama.fi/bridges` returns HTTP 402, so bridge volume is a Pro-only
// metric and `bridges()` reports that explicitly instead of inventing a number.
// Nothing in this file falls back to a guess — an unavailable metric is null,
// and the embed renders N/A with the reason attached.

import { Provider } from "./base.js";
import type { DefiMetrics } from "../types/index.js";

const TVL = "https://api.llama.fi";
const STABLE = "https://stablecoins.llama.fi";

export interface LlamaChain {
  name: string;
  tvl: number;
  tokenSymbol: string | null;
  gecko_id: string | null;
  chainId: number | string | null;
}

export interface LlamaProtocol {
  name: string;
  slug: string;
  category: string | null;
  tvl: number | null;
  chain: string | null;
  chains: string[];
  url: string | null;
  logo: string | null;
  chainTvls?: Record<string, number>;
}

/** A metric we cannot read for free, with the reason to show the user. */
export class MetricUnavailable extends Error {
  constructor(
    readonly metric: string,
    readonly reason: string,
  ) {
    super(`${metric} unavailable: ${reason}`);
    this.name = "MetricUnavailable";
  }
}

export class DefiLlamaProvider extends Provider {
  constructor() {
    super({
      name: "defillama",
      kind: "defi",
      configured: true, // the free surface needs no key
      rps: 4,
      timeoutMs: 20_000,
      budgetLimit: null,
    });
  }

  /** TVL for every chain DeFiLlama tracks (466 at time of writing). */
  async chains(): Promise<LlamaChain[]> {
    const d = await this.request<LlamaChain[]>(`${TVL}/v2/chains`, {}, { label: "v2/chains" });
    return Array.isArray(d) ? d : [];
  }

  /** Daily TVL series for one chain, used for the 24h delta and sparkline. */
  async chainTvlHistory(llamaSlug: string): Promise<Array<{ date: number; tvl: number }>> {
    const d = await this.request<Array<{ date: number; tvl: number }>>(
      `${TVL}/v2/historicalChainTvl/${encodeURIComponent(llamaSlug)}`,
      {},
      { label: "historicalChainTvl" },
    );
    return Array.isArray(d) ? d : [];
  }

  async protocols(): Promise<LlamaProtocol[]> {
    const d = await this.request<LlamaProtocol[]>(`${TVL}/protocols`, {}, { label: "protocols" });
    return Array.isArray(d) ? d : [];
  }

  /** Circulating stablecoin supply per chain. */
  async stablecoinChains(): Promise<Array<{ name: string; totalCirculatingUSD: number }>> {
    const d = await this.request<
      Array<{ name: string; totalCirculatingUSD?: Record<string, number> }>
    >(`${STABLE}/stablecoinchains`, {}, { label: "stablecoinchains" });
    return (Array.isArray(d) ? d : []).map((r) => ({
      name: r.name,
      totalCirculatingUSD: sumValues(r.totalCirculatingUSD),
    }));
  }

  /** Individual stablecoins with their peg and circulating supply. */
  async stablecoins(): Promise<
    Array<{ symbol: string; name: string; circulating: number; chains: string[] }>
  > {
    const d = await this.request<{
      peggedAssets: Array<{
        symbol: string;
        name: string;
        circulating?: Record<string, number>;
        chains?: string[];
      }>;
    }>(`${STABLE}/stablecoins?includePrices=false`, {}, { label: "stablecoins" });
    return (d?.peggedAssets ?? []).map((a) => ({
      symbol: a.symbol,
      name: a.name,
      circulating: sumValues(a.circulating),
      chains: a.chains ?? [],
    }));
  }

  /** 24h DEX volume, either global or for one chain. */
  async dexVolume(chain?: string): Promise<{ total24h: number | null; change24h: number | null }> {
    const path = chain
      ? `/overview/dexs/${encodeURIComponent(chain)}`
      : "/overview/dexs";
    try {
      const d = await this.request<{ total24h?: number; change_1d?: number }>(
        `${TVL}${path}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`,
        {},
        { label: "overview/dexs" },
      );
      return { total24h: nz(d?.total24h), change24h: nz(d?.change_1d) };
    } catch {
      // A chain with no DEX coverage 404s. That is a real "no data", not a bug.
      return { total24h: null, change24h: null };
    }
  }

  /**
   * 24h fees and revenue. DeFiLlama exposes these on separate dataTypes of the
   * same endpoint; revenue is the protocol's cut, fees is what users paid.
   */
  async feesAndRevenue(
    chain?: string,
  ): Promise<{ fees24h: number | null; revenue24h: number | null }> {
    const base = chain ? `/overview/fees/${encodeURIComponent(chain)}` : "/overview/fees";
    const q = "excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";
    try {
      const [fees, rev] = await Promise.allSettled([
        this.request<{ total24h?: number }>(`${TVL}${base}?${q}`, {}, { label: "overview/fees" }),
        this.request<{ total24h?: number }>(
          `${TVL}${base}?${q}&dataType=dailyRevenue`,
          {},
          { label: "overview/revenue" },
        ),
      ]);
      return {
        fees24h: fees.status === "fulfilled" ? nz(fees.value?.total24h) : null,
        revenue24h: rev.status === "fulfilled" ? nz(rev.value?.total24h) : null,
      };
    } catch {
      return { fees24h: null, revenue24h: null };
    }
  }

  /**
   * RWA TVL per chain, derived from protocols whose category is RWA. There is
   * no single RWA-by-chain free endpoint, so this sums `chainTvls` across the
   * RWA category — which is the same definition DeFiLlama's own page uses.
   */
  async rwaByChain(): Promise<Map<string, { tvl: number; protocols: number }>> {
    const all = await this.protocols();
    const out = new Map<string, { tvl: number; protocols: number }>();
    for (const p of all) {
      if ((p.category ?? "").toUpperCase() !== "RWA") continue;
      const per = p.chainTvls ?? {};
      const entries = Object.entries(per).filter(([k]) => !k.includes("-"));
      if (entries.length) {
        for (const [chain, tvl] of entries) {
          if (typeof tvl !== "number" || !Number.isFinite(tvl)) continue;
          const cur = out.get(chain) ?? { tvl: 0, protocols: 0 };
          cur.tvl += tvl;
          cur.protocols += 1;
          out.set(chain, cur);
        }
      } else if (p.chain && typeof p.tvl === "number") {
        const cur = out.get(p.chain) ?? { tvl: 0, protocols: 0 };
        cur.tvl += p.tvl;
        cur.protocols += 1;
        out.set(p.chain, cur);
      }
    }
    return out;
  }

  /** Top protocols on one chain by TVL. */
  async topProtocols(llamaChain: string, limit = 5): Promise<LlamaProtocol[]> {
    const all = await this.protocols();
    return all
      .filter((p) => {
        const onChain = p.chains?.includes(llamaChain) || p.chain === llamaChain;
        return onChain && typeof (p.chainTvls?.[llamaChain] ?? p.tvl) === "number";
      })
      .map((p) => ({ ...p, tvl: p.chainTvls?.[llamaChain] ?? p.tvl ?? 0 }))
      .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
      .slice(0, limit);
  }

  /**
   * Bridge volume. Verified to return HTTP 402 on the free tier, so rather than
   * silently returning zero this throws a typed error the UI turns into an
   * honest "Pro-only" note.
   */
  async bridges(): Promise<never> {
    throw new MetricUnavailable(
      "bridge volume",
      "DeFiLlama returns HTTP 402 for /bridges without an API subscription",
    );
  }

  async ping(): Promise<boolean> {
    try {
      const c = await this.chains();
      return c.length > 0;
    } catch {
      return false;
    }
  }
}

function sumValues(o: Record<string, number> | undefined | null): number {
  if (!o || typeof o !== "object") return 0;
  let s = 0;
  for (const v of Object.values(o)) if (typeof v === "number" && Number.isFinite(v)) s += v;
  return s;
}

const nz = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export type { DefiMetrics };
