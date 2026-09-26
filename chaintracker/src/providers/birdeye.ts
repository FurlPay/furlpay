// Birdeye — optional DEX/trading intelligence.
//
// Dormant until BIRDEYE_API_KEY is set: every method short-circuits to null or
// an empty list, and `configured` is false so /providers shows it as "not
// configured" rather than "down". Endpoint paths and chain support come from
// Birdeye's published API matrix — notably, most wallet and holder endpoints
// are Solana-only, and the perps endpoints are Hyperliquid-only, so the methods
// here refuse to be called for a chain the endpoint does not cover instead of
// returning a plausible-looking empty result.

import { env } from "../config/env.js";
import { Provider } from "./base.js";

const BASE = "https://public-api.birdeye.so";

/** Birdeye's `x-chain` header values, keyed by our chain slug. */
const CHAIN_HEADER: Record<string, string> = {
  solana: "solana",
  ethereum: "ethereum",
  bnb: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon",
  avalanche: "avalanche",
  zksync: "zksync",
  sui: "sui",
  hyperliquid: "hyperliquid",
};

/** Endpoints Birdeye documents as Solana-only. */
const SOLANA_ONLY = new Set(["holders", "walletPortfolio", "transfers", "netWorth"]);

export class BirdeyeProvider extends Provider {
  private readonly key: string | null;

  constructor() {
    super({
      name: "birdeye",
      kind: "intelligence",
      configured: !!env.birdeyeKey,
      rps: 1,
      timeoutMs: 15_000,
      attempts: 2,
      budgetLimit: env.birdeyeKey ? 30_000 : null, // Standard package CU/month
    });
    this.key = env.birdeyeKey;
  }

  supports(chainSlug: string): boolean {
    return this.configured && chainSlug in CHAIN_HEADER;
  }

  private async get<T>(
    path: string,
    chainSlug: string,
    params: Record<string, string | number> = {},
    feature?: string,
  ): Promise<T | null> {
    if (!this.key) return null;
    const chainHeader = CHAIN_HEADER[chainSlug];
    if (!chainHeader) return null;
    if (feature && SOLANA_ONLY.has(feature) && chainSlug !== "solana") return null;

    const u = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    try {
      const d = await this.request<{ success?: boolean; data?: T }>(
        u.toString(),
        { headers: { "X-API-KEY": this.key, "x-chain": chainHeader } },
        { label: path },
      );
      return d?.success === false ? null : (d?.data ?? null);
    } catch (err) {
      this.log.debug("birdeye call failed", {
        path,
        err: (err as Error).message.slice(0, 120),
      });
      return null;
    }
  }

  /** Spot price with 24h change, from DEX liquidity rather than CEX listings. */
  async price(
    chainSlug: string,
    tokenAddress: string,
  ): Promise<{ price: number; change24h: number | null; liquidity: number | null } | null> {
    const d = await this.get<{ value: number; priceChange24h?: number; liquidity?: number }>(
      "/defi/price",
      chainSlug,
      { address: tokenAddress, include_liquidity: "true" },
    );
    if (!d || typeof d.value !== "number") return null;
    return {
      price: d.value,
      change24h: num(d.priceChange24h),
      liquidity: num(d.liquidity),
    };
  }

  /** Token security flags — mint authority, freeze, top-holder concentration. */
  async tokenSecurity(
    chainSlug: string,
    tokenAddress: string,
  ): Promise<Record<string, unknown> | null> {
    return this.get<Record<string, unknown>>("/defi/token_security", chainSlug, {
      address: tokenAddress,
    });
  }

  /** Trending tokens on a chain, by Birdeye's own ranking. */
  async trending(
    chainSlug: string,
    limit = 10,
  ): Promise<Array<{ address: string; symbol: string; price: number | null; volume24h: number | null }>> {
    const d = await this.get<{ tokens?: Array<Record<string, unknown>> }>(
      "/defi/token_trending",
      chainSlug,
      { sort_by: "rank", sort_type: "asc", offset: 0, limit: Math.min(limit, 20) },
    );
    return (d?.tokens ?? []).map((t) => ({
      address: String(t.address ?? ""),
      symbol: String(t.symbol ?? ""),
      price: num(t.price as number),
      volume24h: num(t.volume24hUSD as number),
    }));
  }

  /** Largest recent trades for a token — a DEX-side whale signal. */
  async largeTrades(
    chainSlug: string,
    tokenAddress: string,
    limit = 20,
  ): Promise<Array<{ txHash: string; owner: string; volumeUsd: number; side: string; ts: number }>> {
    const d = await this.get<{ items?: Array<Record<string, unknown>> }>(
      "/defi/txs/token",
      chainSlug,
      { address: tokenAddress, offset: 0, limit: Math.min(limit, 50), tx_type: "swap", sort_type: "desc" },
    );
    return (d?.items ?? [])
      .map((t) => ({
        txHash: String(t.txHash ?? ""),
        owner: String(t.owner ?? ""),
        volumeUsd: Number(t.volumeUSD ?? 0),
        side: String(t.side ?? ""),
        ts: Number(t.blockUnixTime ?? 0) * 1000,
      }))
      .filter((t) => t.txHash && Number.isFinite(t.volumeUsd));
  }

  /** Token holder distribution. Solana-only per Birdeye's matrix. */
  async holders(
    chainSlug: string,
    tokenAddress: string,
    limit = 10,
  ): Promise<Array<{ owner: string; amount: number; percentage: number | null }>> {
    const d = await this.get<{ items?: Array<Record<string, unknown>> }>(
      "/defi/v3/token/holder",
      chainSlug,
      { address: tokenAddress, offset: 0, limit: Math.min(limit, 100) },
      "holders",
    );
    return (d?.items ?? []).map((h) => ({
      owner: String(h.owner ?? ""),
      amount: Number(h.ui_amount ?? h.amount ?? 0),
      percentage: num(h.percentage as number),
    }));
  }

  /** Hyperliquid perps overview — the only chain Birdeye exposes perps for. */
  async perpsOverview(tokenSymbol: string): Promise<Record<string, unknown> | null> {
    if (!this.configured) return null;
    return this.get<Record<string, unknown>>("/perps/v1/token/overview", "hyperliquid", {
      symbol: tokenSymbol,
    });
  }

  async ping(): Promise<boolean> {
    if (!this.key) return false;
    const d = await this.get<{ value: number }>("/defi/price", "solana", {
      address: "So11111111111111111111111111111111111111112",
    });
    return typeof d?.value === "number";
  }
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
