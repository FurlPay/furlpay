// CoinGecko — market data only.
//
// The Demo plan allows 10,000 calls a month, so this adapter is built around
// batching: /coins/markets takes up to 250 ids in ONE call, which is how 28
// chains plus watched tokens refresh every 60s and still land near 45k calls a
// month... which is over budget, so `budgetGuard` throttles the interval up
// automatically as the month's allowance is consumed. Nothing here ever
// fabricates a price: a missing id yields null and the UI prints N/A.

import { env } from "../config/env.js";
import { usage } from "../db/index.js";
import { Provider } from "./base.js";
import type { MarketQuote } from "../types/index.js";

const BASE = "https://api.coingecko.com/api/v3";

interface CgMarket {
  id: string;
  symbol: string;
  current_price: number | null;
  market_cap: number | null;
  fully_diluted_valuation: number | null;
  total_volume: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  ath: number | null;
  atl: number | null;
  sparkline_in_7d?: { price: number[] } | null;
}

export class CoinGeckoProvider extends Provider {
  constructor() {
    super({
      name: "coingecko",
      kind: "market",
      configured: !!env.coingeckoKey,
      // Demo plan documents 100 calls/minute; 1.5/s leaves headroom for bursts.
      rps: 1.5,
      timeoutMs: 15_000,
      budgetLimit: env.coingeckoMonthlyCalls,
    });
  }

  private url(path: string, params: Record<string, string | number | undefined> = {}): string {
    const u = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    if (env.coingeckoKey) u.searchParams.set("x_cg_demo_api_key", env.coingeckoKey);
    return u.toString();
  }

  /**
   * Fraction of the monthly Demo allowance already spent. The scheduler reads
   * this to stretch intervals rather than hitting a wall at month end.
   */
  budgetUsedFraction(): number {
    if (!this.budgetLimit) return 0;
    try {
      return Math.min(1, usage.month(this.name).units / this.budgetLimit);
    } catch {
      return 0;
    }
  }

  /** Multiplier applied to the price interval as the budget drains. */
  budgetBackoff(): number {
    const f = this.budgetUsedFraction();
    if (f < 0.6) return 1;
    if (f < 0.8) return 2;
    if (f < 0.95) return 4;
    return 10;
  }

  /** Up to 250 ids per call. Callers should pass every id they need at once. */
  async markets(ids: string[], sparkline = false): Promise<MarketQuote[]> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return [];
    const out: MarketQuote[] = [];

    for (let i = 0; i < unique.length; i += 250) {
      const slice = unique.slice(i, i + 250);
      const url = this.url("/coins/markets", {
        vs_currency: "usd",
        ids: slice.join(","),
        order: "market_cap_desc",
        per_page: 250,
        page: 1,
        sparkline: String(sparkline),
        price_change_percentage: "24h,7d,30d",
      });
      const rows = await this.request<CgMarket[]>(url, {}, { label: "coins/markets" });
      const now = Date.now();
      for (const r of rows ?? []) {
        out.push({
          coingeckoId: r.id,
          symbol: (r.symbol ?? "").toUpperCase(),
          priceUsd: nz(r.current_price),
          marketCapUsd: nz(r.market_cap),
          fdvUsd: nz(r.fully_diluted_valuation),
          volume24hUsd: nz(r.total_volume),
          change24hPct: nz(r.price_change_percentage_24h_in_currency),
          change7dPct: nz(r.price_change_percentage_7d_in_currency),
          change30dPct: nz(r.price_change_percentage_30d_in_currency),
          circulatingSupply: nz(r.circulating_supply),
          totalSupply: nz(r.total_supply),
          maxSupply: nz(r.max_supply),
          athUsd: nz(r.ath),
          atlUsd: nz(r.atl),
          sparkline7d: r.sparkline_in_7d?.price?.length ? r.sparkline_in_7d.price : null,
          fetchedAt: now,
          source: "coingecko",
        });
      }
    }
    return out;
  }

  /** Total crypto market cap and 24h volume — the header stat row. */
  async global(): Promise<{
    totalMarketCapUsd: number | null;
    totalVolume24hUsd: number | null;
    btcDominance: number | null;
    marketCapChange24hPct: number | null;
  }> {
    const d = await this.request<{
      data: {
        total_market_cap: Record<string, number>;
        total_volume: Record<string, number>;
        market_cap_percentage: Record<string, number>;
        market_cap_change_percentage_24h_usd: number;
      };
    }>(this.url("/global"), {}, { label: "global" });
    return {
      totalMarketCapUsd: nz(d?.data?.total_market_cap?.usd),
      totalVolume24hUsd: nz(d?.data?.total_volume?.usd),
      btcDominance: nz(d?.data?.market_cap_percentage?.btc),
      marketCapChange24hPct: nz(d?.data?.market_cap_change_percentage_24h_usd),
    };
  }

  /** Resolve a free-text ticker to a CoinGecko id. */
  async search(query: string): Promise<Array<{ id: string; symbol: string; name: string; rank: number | null }>> {
    const d = await this.request<{
      coins: Array<{ id: string; symbol: string; name: string; market_cap_rank: number | null }>;
    }>(this.url("/search", { query }), {}, { label: "search" });
    return (d?.coins ?? []).slice(0, 10).map((c) => ({
      id: c.id,
      symbol: (c.symbol ?? "").toUpperCase(),
      name: c.name,
      rank: c.market_cap_rank ?? null,
    }));
  }

  /**
   * Price for an arbitrary ERC-20 by contract address. Used when a whale
   * transfer involves a token the registry does not know, so the USD value is
   * real rather than guessed. Returns null when CoinGecko has no listing.
   */
  async tokenPrice(platformId: string, contract: string): Promise<number | null> {
    try {
      const d = await this.request<Record<string, { usd?: number }>>(
        this.url(`/simple/token_price/${platformId}`, {
          contract_addresses: contract,
          vs_currencies: "usd",
        }),
        {},
        { label: "simple/token_price" },
      );
      const hit = d?.[contract.toLowerCase()];
      return nz(hit?.usd);
    } catch {
      return null;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const d = await this.request<{ gecko_says?: string }>(this.url("/ping"), {}, { label: "ping" });
      return !!d?.gecko_says;
    } catch {
      return false;
    }
  }
}

const nz = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * CoinGecko "asset platform" ids, needed by tokenPrice. Only chains whose
 * platform id was confirmed to exist are listed; the rest yield no token price
 * rather than a wrong one.
 */
export const CG_PLATFORM: Record<string, string> = {
  ethereum: "ethereum",
  bnb: "binance-smart-chain",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  base: "base",
  avalanche: "avalanche",
  solana: "solana",
  zksync: "zksync",
  mantle: "mantle",
  celo: "celo",
  gnosis: "xdai",
  tron: "tron",
  sui: "sui",
  aptos: "aptos",
  near: "near-protocol",
  starknet: "starknet",
  hyperliquid: "hyperevm",
};
