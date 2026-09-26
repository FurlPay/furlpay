// Scheduled collectors.
//
// Everything users see is served from the database, never from a live API call
// made inside a slash command. That is the whole reason 100 people running
// /chain ethereum costs one refresh instead of a hundred.
//
// Budget discipline lives here too: CoinGecko's 10k monthly calls are spent on
// ONE batched /coins/markets call per tick covering every tracked id, and the
// interval stretches automatically as the month's allowance drains.

import { chains, head, metrics, prices, usage, wallets, whales } from "../db/index.js";
import { coingecko, defillama, evm, helius, nonEvm, etherscan, headProviderFor } from "../providers/index.js";
import { scanEvmChain } from "../whale/evmScanner.js";
import { scanSolana } from "../whale/solanaScanner.js";
import { whaleScore } from "../whale/classify.js";
import { ADDRESS_LABELS, SOLANA_LABELS, TOKEN_SEEDS, seedConfidence } from "../labels/seed.js";
import { pool } from "../util/resilience.js";
import { makeLogger } from "../util/logger.js";
import { env } from "../config/env.js";
import type { ChainRow } from "../types/index.js";

const log = makeLogger("collect");

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

export function seedAll(): void {
  chains.seed();
  for (const l of [...ADDRESS_LABELS, ...SOLANA_LABELS]) {
    wallets.upsertLabel({
      chainSlug: l.chainSlug,
      address: l.address,
      label: l.label,
      entity: l.entity,
      category: l.category,
      tags: l.tags ?? [],
      confidence: seedConfidence(l),
      source: "seed",
    });
  }
  for (const t of TOKEN_SEEDS) {
    wallets.upsertLabel({
      chainSlug: t.chainSlug,
      address: t.address,
      label: `${t.symbol} token`,
      entity: t.symbol,
      category: "token",
      tags: t.isStablecoin ? ["token", "stablecoin"] : ["token"],
      confidence: 1,
      source: "seed",
    });
  }
  log.info("seed complete", {
    chains: chains.all().length,
    labels: ADDRESS_LABELS.length + SOLANA_LABELS.length,
    tokens: TOKEN_SEEDS.length,
  });
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

/** Extra ids beyond the chains themselves — gas assets and major stables. */
const EXTRA_IDS = [
  "bitcoin", "ethereum", "tether", "usd-coin", "dai", "weth", "wrapped-bitcoin",
  "staked-ether", "binancecoin", "solana", "msol", "jito-staked-sol", "bonk",
  "jupiter-exchange-solana", "wbnb",
];

export async function collectPrices(): Promise<{ updated: number; error: string | null }> {
  const ids = new Set<string>(EXTRA_IDS);
  for (const c of chains.all()) if (c.coingeckoId) ids.add(c.coingeckoId);

  try {
    const quotes = await coingecko.markets([...ids], true);
    for (const q of quotes) prices.upsert(q);

    // Whole-market totals live under a reserved id so the dashboard can show
    // them next to — and clearly distinct from — the tracked-chain sum.
    try {
      const g = await coingecko.global();
      prices.upsert({
        coingeckoId: "__global__",
        symbol: "GLOBAL",
        priceUsd: null,
        marketCapUsd: g.totalMarketCapUsd,
        fdvUsd: null,
        volume24hUsd: g.totalVolume24hUsd,
        change24hPct: g.marketCapChange24hPct,
        change7dPct: null,
        change30dPct: null,
        circulatingSupply: null,
        totalSupply: null,
        maxSupply: null,
        athUsd: null,
        atlUsd: null,
        sparkline7d: null,
        fetchedAt: Date.now(),
        source: "coingecko/global",
      });
    } catch (err) {
      log.debug("global totals unavailable", { err: (err as Error).message.slice(0, 120) });
    }

    log.debug("prices updated", { count: quotes.length, ids: ids.size });
    return { updated: quotes.length, error: null };
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    log.warn("price collection failed", { err: msg });
    return { updated: 0, error: msg };
  }
}

/* ------------------------------------------------------------------ */
/* DeFi metrics                                                        */
/* ------------------------------------------------------------------ */

export async function collectDefi(): Promise<{ updated: number; error: string | null }> {
  try {
    const [llamaChains, stableChains, rwaMap] = await Promise.all([
      defillama.chains(),
      defillama.stablecoinChains().catch(() => []),
      defillama.rwaByChain().catch(() => new Map<string, { tvl: number; protocols: number }>()),
    ]);

    const tvlByName = new Map(llamaChains.map((c) => [c.name, c.tvl]));
    const stableByName = new Map(stableChains.map((c) => [c.name, c.totalCirculatingUSD]));
    const now = Date.now();
    let updated = 0;

    // DEX volume and fees are per-chain calls, so only the chains we actually
    // display get them, and tier 3 chains are refreshed less aggressively.
    const tracked = chains.all().filter((c) => c.defillamaSlug);

    const results = await pool(tracked, 3, async (c) => {
      const slug = c.defillamaSlug!;
      const tvl = tvlByName.get(slug) ?? null;

      const [dex, fees] = await Promise.all([
        defillama.dexVolume(slug).catch(() => ({ total24h: null, change24h: null })),
        defillama.feesAndRevenue(slug).catch(() => ({ fees24h: null, revenue24h: null })),
      ]);

      // 24h TVL delta from our own history when available, else from Llama's.
      let tvlChange: number | null = null;
      const hist = metrics.tvlHistory(c.slug, now - 25 * 3_600_000);
      if (hist.length >= 2 && hist[0]! > 0 && tvl !== null) {
        tvlChange = ((tvl - hist[0]!) / hist[0]!) * 100;
      }

      const rwa = rwaMap.get(slug);
      metrics.upsert({
        chainSlug: c.slug,
        tvlUsd: tvl,
        tvlChange24hPct: tvlChange,
        stablecoinMcapUsd: stableByName.get(slug) ?? null,
        dexVolume24hUsd: dex.total24h,
        fees24hUsd: fees.fees24h,
        revenue24hUsd: fees.revenue24h,
        rwaTvlUsd: rwa?.tvl ?? null,
        protocolCount: rwa?.protocols ?? null,
        fetchedAt: now,
        source: "defillama",
      });
      return 1;
    });
    updated = results.filter((r) => r.status === "fulfilled").length;
    log.debug("defi metrics updated", { chains: updated });
    return { updated, error: null };
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    log.warn("defi collection failed", { err: msg });
    return { updated: 0, error: msg };
  }
}

/* ------------------------------------------------------------------ */
/* Chain head / liveness                                               */
/* ------------------------------------------------------------------ */

export async function collectHeads(tier?: number): Promise<{ ok: number; failed: number }> {
  const targets = tier ? chains.byTier(tier) : chains.all();
  let ok = 0;
  let failed = 0;

  await pool(targets, 5, async (c) => {
    const started = Date.now();
    const prev = head.get(c.slug);
    try {
      const reading = await readHead(c);
      const latency = Date.now() - started;

      // Measure block time from consecutive observations rather than trusting
      // the configured constant, so a degraded chain is visible.
      let observed: number | null = null;
      const prevHeight = prev?.block_height as number | undefined;
      const prevAt = prev?.fetched_at as number | undefined;
      if (prevHeight && prevAt && reading.height && reading.height > prevHeight) {
        const dtSec = (Date.now() - prevAt) / 1000;
        const blocks = reading.height - prevHeight;
        if (dtSec > 5 && blocks > 0) observed = dtSec / blocks;
      }

      head.upsert({
        chainSlug: c.slug,
        blockHeight: reading.height,
        blockTimestamp: reading.timestamp,
        observedBlockTimeSec: observed,
        gasPriceGwei: reading.gasGwei,
        txCount24h: null,
        healthy: reading.height !== null || reading.timestamp !== null,
        latencyMs: latency,
        error: null,
        fetchedAt: Date.now(),
        source: reading.source,
      });
      ok += 1;
    } catch (err) {
      head.upsert({
        chainSlug: c.slug,
        blockHeight: (prev?.block_height as number) ?? null,
        blockTimestamp: (prev?.block_timestamp as number) ?? null,
        observedBlockTimeSec: null,
        gasPriceGwei: null,
        txCount24h: null,
        healthy: false,
        latencyMs: Date.now() - started,
        error: (err as Error).message.slice(0, 200),
        fetchedAt: Date.now(),
        source: "error",
      });
      failed += 1;
    }
  });

  return { ok, failed };
}

async function readHead(c: ChainRow): Promise<{
  height: number | null;
  timestamp: number | null;
  gasGwei: number | null;
  source: string;
}> {
  switch (headProviderFor(c)) {
    case "evm": {
      const [height, gas] = await Promise.all([
        evm.blockNumber(c),
        evm.gasPriceGwei(c).catch(() => null),
      ]);
      return {
        height,
        timestamp: null,
        gasGwei: gas,
        source: evm.usingAlchemy(c) ? "alchemy" : "public-rpc",
      };
    }
    case "helius": {
      const slot = await helius.slot();
      return { height: slot, timestamp: null, gasGwei: null, source: helius.configured ? "helius" : "solana-public" };
    }
    case "nonEvm": {
      const r = await nonEvm.head(c);
      return { height: r.height, timestamp: r.timestamp, gasGwei: null, source: r.source };
    }
    default:
      throw new Error(`no head provider for ${c.chainType}`);
  }
}

/* ------------------------------------------------------------------ */
/* Whale scanning                                                      */
/* ------------------------------------------------------------------ */

export async function collectWhales(tier: number): Promise<{ scanned: number; found: number }> {
  if (!env.whaleScanEnabled) return { scanned: 0, found: 0 };
  const targets = chains.byTier(tier);
  let found = 0;
  let scanned = 0;

  for (const c of targets) {
    try {
      if (c.chainType === "evm") {
        const r = await scanEvmChain(c);
        found += r.eventsNew;
        scanned += 1;
      } else if (c.chainType === "solana") {
        const r = await scanSolana(c);
        found += r.eventsNew;
        scanned += 1;
      }
      // Other chain families have no free transfer index; capabilitiesFor()
      // reports that rather than this loop silently skipping them.
    } catch (err) {
      log.warn("whale scan failed", { chain: c.slug, err: (err as Error).message.slice(0, 140) });
    }
  }
  return { scanned, found };
}

/* ------------------------------------------------------------------ */
/* Whale scoring                                                       */
/* ------------------------------------------------------------------ */

/** Recompute scores for addresses seen recently. Pure DB work, no API calls. */
export function scoreWallets(sinceMs = 7 * 86_400_000): number {
  const since = Date.now() - sinceMs;
  let scored = 0;
  for (const c of chains.all()) {
    const seen = new Map<string, { volume: number; txs: number; peers: Set<string> }>();
    for (const e of whales.recent(c.slug, 500)) {
      if (e.timestamp < since) continue;
      for (const [addr, peer] of [
        [e.fromAddress, e.toAddress],
        [e.toAddress, e.fromAddress],
      ] as const) {
        const cur = seen.get(addr) ?? { volume: 0, txs: 0, peers: new Set<string>() };
        cur.volume += e.amountUsd;
        cur.txs += 1;
        cur.peers.add(peer);
        seen.set(addr, cur);
      }
    }
    for (const [addr, agg] of seen) {
      const w = wallets.get(c.slug, addr);
      const score = whaleScore({
        balanceUsd: w?.balanceUsd ?? null,
        volumeUsd30d: agg.volume,
        txCount: agg.txs,
        distinctCounterparties: agg.peers.size,
        isLabelled: !!w?.label,
      });
      wallets.setScore(c.slug, addr, score);
      scored += 1;
    }
  }
  return scored;
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

export function prune(): void {
  const removed = whales.prune(Date.now() - 30 * 86_400_000);
  if (removed) log.info("pruned old whale events", { removed });
}

/** Snapshot used by /status. */
export function budgetSnapshot(): Array<{
  provider: string;
  used: number;
  limit: number | null;
  pct: number | null;
}> {
  const out: Array<{ provider: string; used: number; limit: number | null; pct: number | null }> = [];
  for (const p of [coingecko, evm, helius, etherscan, defillama]) {
    const used = usage.month(p.name).units;
    const limit = p.budgetLimit;
    out.push({
      provider: p.name,
      used,
      limit,
      pct: limit ? Math.round((used / limit) * 1000) / 10 : null,
    });
  }
  return out;
}
