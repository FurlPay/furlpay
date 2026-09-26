// Database handle and repositories.
//
// Uses node:sqlite, which ships with Node 22.5+ — no native build step, which
// matters because this has to install cleanly on Windows without a toolchain.
// Everything the rest of the app touches goes through the repos at the bottom,
// so the storage engine stays swappable.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./schema.js";
import { CHAIN_SEEDS } from "../chains/registry.js";
import { env } from "../config/env.js";
import { makeLogger } from "../util/logger.js";
import type {
  AddressCategory,
  AlertRule,
  ChainRow,
  DefiMetrics,
  GuildSettings,
  MarketQuote,
  WalletRecord,
  WhaleEvent,
} from "../types/index.js";

const log = makeLogger("db");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const path = env.databaseUrl;
  if (path.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL points at Postgres, but this build ships the SQLite driver. " +
        "Leave DATABASE_URL unset to use the bundled file database.",
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  d.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set(
    (d.prepare("SELECT id FROM _migrations").all() as Array<{ id: string }>).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    d.exec("BEGIN");
    try {
      d.exec(m.sql);
      d.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(m.id, Date.now());
      d.exec("COMMIT");
      log.info("migration applied", { id: m.id });
    } catch (err) {
      d.exec("ROLLBACK");
      throw new Error(`migration ${m.id} failed: ${(err as Error).message}`);
    }
  }
}

const J = (v: unknown): string => JSON.stringify(v ?? null);
function P<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string" || !s) return fallback;
  try {
    const v = JSON.parse(s);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}
const bit = (b: boolean): number => (b ? 1 : 0);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/* ================================================================== */
/* Chains                                                              */
/* ================================================================== */

interface ChainDbRow {
  id: number;
  slug: string;
  name: string;
  symbol: string | null;
  chain_type: string;
  layer: string;
  parent_chain: string | null;
  evm_chain_id: number | null;
  alchemy_subdomain: string | null;
  public_rpc: string;
  websocket_url: string | null;
  explorer_url: string;
  explorer_name: string;
  etherscan_chain_id: number | null;
  coingecko_id: string | null;
  defillama_slug: string | null;
  native_token: string;
  native_decimals: number;
  logo: string | null;
  coin_logo: string | null;
  categories: string;
  block_time_sec: number | null;
  tier: number;
  scan_native: number;
  whale_thresholds: string;
  color: number;
  enabled: number;
  is_testnet: number;
  metadata: string;
  created_at: number;
  updated_at: number;
}

function toChain(r: ChainDbRow): ChainRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    symbol: r.symbol,
    chainType: r.chain_type as ChainRow["chainType"],
    layer: r.layer as ChainRow["layer"],
    parentChain: r.parent_chain,
    evmChainId: r.evm_chain_id,
    alchemySubdomain: r.alchemy_subdomain,
    publicRpc: P<string[]>(r.public_rpc, []),
    explorerUrl: r.explorer_url,
    explorerName: r.explorer_name,
    etherscanChainId: r.etherscan_chain_id,
    coingeckoId: r.coingecko_id,
    defillamaSlug: r.defillama_slug,
    nativeToken: r.native_token,
    nativeDecimals: r.native_decimals,
    logo: r.logo ?? "",
    coinLogo: r.coin_logo ?? "",
    categories: P<string[]>(r.categories, []),
    blockTimeSec: r.block_time_sec ?? 0,
    tier: (r.tier as 1 | 2 | 3) ?? 3,
    scanNativeTransfers: r.scan_native === 1,
    whaleThresholdsUsd: P<number[]>(r.whale_thresholds, []),
    color: r.color,
    enabled: r.enabled === 1,
    isTestnet: r.is_testnet === 1,
    metadata: P<Record<string, unknown>>(r.metadata, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface ChainsRepo {
  seed(): number;
  all(includeDisabled?: boolean): ChainRow[];
  byTier(tier: number): ChainRow[];
  bySlug(slug: string): ChainRow | null;
  resolve(input: string): ChainRow | null;
  byCategory(cat: string): ChainRow[];
  upsert(patch: Partial<ChainRow> & { slug: string }): void;
  insert(seed: NewChain): void;
  setEnabled(slug: string, on: boolean): boolean;
}

/** Everything needed to add a chain that is not already in the seed list. */
export type NewChain = Omit<
  ChainRow,
  "id" | "createdAt" | "updatedAt" | "isTestnet" | "metadata" | "enabled"
> & { enabled?: boolean };

export const chains: ChainsRepo = {
  /** Insert seed rows the first time only; later edits in the DB are kept. */
  seed(): number {
    const d = getDb();
    const now = Date.now();
    const stmt = d.prepare(`
      INSERT INTO chains (slug,name,symbol,chain_type,layer,parent_chain,evm_chain_id,
        alchemy_subdomain,public_rpc,explorer_url,explorer_name,etherscan_chain_id,
        coingecko_id,defillama_slug,native_token,native_decimals,logo,coin_logo,
        categories,block_time_sec,tier,scan_native,whale_thresholds,color,
        enabled,is_testnet,metadata,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,'{}',?,?)
      ON CONFLICT(slug) DO NOTHING
    `);
    let inserted = 0;
    for (const c of CHAIN_SEEDS) {
      const r = stmt.run(
        c.slug, c.name, c.symbol, c.chainType, c.layer, c.parentChain, c.evmChainId,
        c.alchemySubdomain, J(c.publicRpc), c.explorerUrl, c.explorerName, c.etherscanChainId,
        c.coingeckoId, c.defillamaSlug, c.nativeToken, c.nativeDecimals, c.logo, c.coinLogo,
        J(c.categories), c.blockTimeSec, c.tier, bit(c.scanNativeTransfers),
        J(c.whaleThresholdsUsd), c.color, now, now,
      );
      inserted += Number(r.changes);
    }
    if (inserted) log.info("chains seeded", { inserted });
    return inserted;
  },

  all(includeDisabled = false): ChainRow[] {
    const d = getDb();
    const sql = includeDisabled
      ? "SELECT * FROM chains ORDER BY tier, name"
      : "SELECT * FROM chains WHERE enabled = 1 ORDER BY tier, name";
    return (d.prepare(sql).all() as unknown as ChainDbRow[]).map(toChain);
  },

  byTier(tier: number): ChainRow[] {
    return (
      getDb()
        .prepare("SELECT * FROM chains WHERE enabled = 1 AND tier = ? ORDER BY name")
        .all(tier) as unknown as ChainDbRow[]
    ).map(toChain);
  },

  bySlug(slug: string): ChainRow | null {
    const r = getDb()
      .prepare("SELECT * FROM chains WHERE slug = ?")
      .get(slug.toLowerCase()) as unknown as ChainDbRow | undefined;
    return r ? toChain(r) : null;
  },

  /**
   * Resolve user input to a chain. Accepts slug, name, ticker or a numeric EVM
   * chain id, so /chain eth, /chain 1 and /chain "BNB Chain" all land.
   */
  resolve(input: string): ChainRow | null {
    const q = input.trim().toLowerCase();
    if (!q) return null;
    const d = getDb();
    const direct = d
      .prepare("SELECT * FROM chains WHERE lower(slug)=? OR lower(name)=? OR lower(symbol)=?")
      .get(q, q, q) as unknown as ChainDbRow | undefined;
    if (direct) return toChain(direct);

    if (/^\d+$/.test(q)) {
      const byId = d
        .prepare("SELECT * FROM chains WHERE evm_chain_id = ?")
        .get(Number(q)) as unknown as ChainDbRow | undefined;
      if (byId) return toChain(byId);
    }
    const ALIASES: Record<string, string> = {
      eth: "ethereum", sol: "solana", bsc: "bnb", binance: "bnb", avax: "avalanche",
      matic: "polygon", arb: "arbitrum", op: "optimism", rh: "robinhood",
      robinhoodchain: "robinhood", hype: "hyperliquid", hl: "hyperliquid",
      zk: "zksync", era: "zksync", atom: "cosmos", dot: "polkadot", trx: "tron",
      xlm: "stellar", hbar: "hedera", ada: "cardano", algo: "algorand",
      "internet computer": "icp", "cosmos hub": "cosmos", "bnb chain": "bnb",
      "arbitrum one": "arbitrum", "gnosis chain": "gnosis",
    };
    const alias = ALIASES[q];
    if (alias) return chains.bySlug(alias);

    const like = d
      .prepare("SELECT * FROM chains WHERE lower(name) LIKE ? OR lower(slug) LIKE ? ORDER BY tier LIMIT 1")
      .get(`${q}%`, `${q}%`) as unknown as ChainDbRow | undefined;
    return like ? toChain(like) : null;
  },

  byCategory(cat: string): ChainRow[] {
    const c = cat.toLowerCase();
    return chains.all().filter((x: ChainRow) => x.categories.some((k: string) => k.toLowerCase() === c));
  },

  upsert(patch: Partial<ChainRow> & { slug: string }): void {
    const d = getDb();
    const existing = chains.bySlug(patch.slug);
    const now = Date.now();
    if (!existing) throw new Error(`chain ${patch.slug} does not exist; add it first`);
    const merged = { ...existing, ...patch };
    d.prepare(`
      UPDATE chains SET name=?, symbol=?, layer=?, parent_chain=?, evm_chain_id=?,
        alchemy_subdomain=?, public_rpc=?, explorer_url=?, explorer_name=?,
        etherscan_chain_id=?, coingecko_id=?, defillama_slug=?, native_token=?,
        native_decimals=?, categories=?, block_time_sec=?, tier=?, scan_native=?,
        whale_thresholds=?, color=?, enabled=?, updated_at=? WHERE slug=?
    `).run(
      merged.name, merged.symbol, merged.layer, merged.parentChain, merged.evmChainId,
      merged.alchemySubdomain, J(merged.publicRpc), merged.explorerUrl, merged.explorerName,
      merged.etherscanChainId, merged.coingeckoId, merged.defillamaSlug, merged.nativeToken,
      merged.nativeDecimals, J(merged.categories), merged.blockTimeSec, merged.tier,
      bit(merged.scanNativeTransfers), J(merged.whaleThresholdsUsd), merged.color,
      bit(merged.enabled), now, merged.slug,
    );
  },

  insert(seed: NewChain): void {
    const d = getDb();
    const now = Date.now();
    d.prepare(`
      INSERT INTO chains (slug,name,symbol,chain_type,layer,parent_chain,evm_chain_id,
        alchemy_subdomain,public_rpc,explorer_url,explorer_name,etherscan_chain_id,
        coingecko_id,defillama_slug,native_token,native_decimals,logo,coin_logo,
        categories,block_time_sec,tier,scan_native,whale_thresholds,color,
        enabled,is_testnet,metadata,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'{}',?,?)
    `).run(
      seed.slug, seed.name, seed.symbol, seed.chainType, seed.layer, seed.parentChain,
      seed.evmChainId, seed.alchemySubdomain, J(seed.publicRpc), seed.explorerUrl,
      seed.explorerName, seed.etherscanChainId, seed.coingeckoId, seed.defillamaSlug,
      seed.nativeToken, seed.nativeDecimals, seed.logo, seed.coinLogo, J(seed.categories),
      seed.blockTimeSec, seed.tier, bit(seed.scanNativeTransfers), J(seed.whaleThresholdsUsd),
      seed.color, bit(seed.enabled ?? true), now, now,
    );
  },

  setEnabled(slug: string, on: boolean): boolean {
    const r = getDb()
      .prepare("UPDATE chains SET enabled=?, updated_at=? WHERE slug=?")
      .run(bit(on), Date.now(), slug.toLowerCase());
    return Number(r.changes) > 0;
  },
};

/* ================================================================== */
/* Prices                                                              */
/* ================================================================== */

export const prices = {
  upsert(q: MarketQuote): void {
    getDb().prepare(`
      INSERT INTO prices (coingecko_id,symbol,price_usd,market_cap,fdv,volume_24h,
        change_24h,change_7d,change_30d,circulating,total_supply,max_supply,ath,atl,
        sparkline_7d,fetched_at,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(coingecko_id) DO UPDATE SET
        symbol=excluded.symbol, price_usd=excluded.price_usd, market_cap=excluded.market_cap,
        fdv=excluded.fdv, volume_24h=excluded.volume_24h, change_24h=excluded.change_24h,
        change_7d=excluded.change_7d, change_30d=excluded.change_30d,
        circulating=excluded.circulating, total_supply=excluded.total_supply,
        max_supply=excluded.max_supply, ath=excluded.ath, atl=excluded.atl,
        sparkline_7d=excluded.sparkline_7d, fetched_at=excluded.fetched_at,
        source=excluded.source
    `).run(
      q.coingeckoId, q.symbol, q.priceUsd, q.marketCapUsd, q.fdvUsd, q.volume24hUsd,
      q.change24hPct, q.change7dPct, q.change30dPct, q.circulatingSupply, q.totalSupply,
      q.maxSupply, q.athUsd, q.atlUsd, q.sparkline7d ? J(q.sparkline7d) : null,
      q.fetchedAt, q.source,
    );
    if (q.priceUsd !== null) {
      const bucket = Math.floor(q.fetchedAt / 300_000) * 300_000;
      getDb()
        .prepare("INSERT OR REPLACE INTO price_history (coingecko_id, ts, price_usd) VALUES (?,?,?)")
        .run(q.coingeckoId, bucket, q.priceUsd);
    }
  },

  get(coingeckoId: string): MarketQuote | null {
    const r = getDb().prepare("SELECT * FROM prices WHERE coingecko_id=?").get(coingeckoId) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      coingeckoId: r.coingecko_id as string,
      symbol: r.symbol as string,
      priceUsd: num(r.price_usd),
      marketCapUsd: num(r.market_cap),
      fdvUsd: num(r.fdv),
      volume24hUsd: num(r.volume_24h),
      change24hPct: num(r.change_24h),
      change7dPct: num(r.change_7d),
      change30dPct: num(r.change_30d),
      circulatingSupply: num(r.circulating),
      totalSupply: num(r.total_supply),
      maxSupply: num(r.max_supply),
      athUsd: num(r.ath),
      atlUsd: num(r.atl),
      sparkline7d: P<number[] | null>(r.sparkline_7d, null),
      fetchedAt: r.fetched_at as number,
      source: r.source as string,
    };
  },

  /** Symbol → USD price, used by the whale engine to value transfers. */
  bySymbol(symbol: string): { price: number; fetchedAt: number } | null {
    const r = getDb()
      .prepare("SELECT price_usd, fetched_at FROM prices WHERE upper(symbol)=? AND price_usd IS NOT NULL ORDER BY market_cap DESC LIMIT 1")
      .get(symbol.toUpperCase()) as { price_usd: number; fetched_at: number } | undefined;
    return r ? { price: r.price_usd, fetchedAt: r.fetched_at } : null;
  },

  history(coingeckoId: string, sinceMs: number): number[] {
    return (
      getDb()
        .prepare("SELECT price_usd FROM price_history WHERE coingecko_id=? AND ts>=? ORDER BY ts")
        .all(coingeckoId, sinceMs) as Array<{ price_usd: number }>
    ).map((r) => r.price_usd);
  },
};

/* ================================================================== */
/* Chain metrics + head                                                */
/* ================================================================== */

export const metrics = {
  upsert(m: DefiMetrics): void {
    getDb().prepare(`
      INSERT INTO chain_metrics (chain_slug,tvl_usd,tvl_change_24h,stablecoin_mcap,
        dex_volume_24h,fees_24h,revenue_24h,rwa_tvl,protocol_count,fetched_at,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(chain_slug) DO UPDATE SET
        tvl_usd=excluded.tvl_usd, tvl_change_24h=excluded.tvl_change_24h,
        stablecoin_mcap=excluded.stablecoin_mcap, dex_volume_24h=excluded.dex_volume_24h,
        fees_24h=excluded.fees_24h, revenue_24h=excluded.revenue_24h,
        rwa_tvl=excluded.rwa_tvl, protocol_count=excluded.protocol_count,
        fetched_at=excluded.fetched_at, source=excluded.source
    `).run(
      m.chainSlug, m.tvlUsd, m.tvlChange24hPct, m.stablecoinMcapUsd, m.dexVolume24hUsd,
      m.fees24hUsd, m.revenue24hUsd, m.rwaTvlUsd, m.protocolCount, m.fetchedAt, m.source,
    );
    if (m.tvlUsd !== null) {
      const bucket = Math.floor(m.fetchedAt / 3_600_000) * 3_600_000;
      getDb()
        .prepare("INSERT OR REPLACE INTO tvl_history (chain_slug, ts, tvl_usd) VALUES (?,?,?)")
        .run(m.chainSlug, bucket, m.tvlUsd);
    }
  },

  get(slug: string): DefiMetrics | null {
    const r = getDb().prepare("SELECT * FROM chain_metrics WHERE chain_slug=?").get(slug) as
      | Record<string, unknown>
      | undefined;
    if (!r) return null;
    return {
      chainSlug: r.chain_slug as string,
      tvlUsd: num(r.tvl_usd),
      tvlChange24hPct: num(r.tvl_change_24h),
      stablecoinMcapUsd: num(r.stablecoin_mcap),
      dexVolume24hUsd: num(r.dex_volume_24h),
      fees24hUsd: num(r.fees_24h),
      revenue24hUsd: num(r.revenue_24h),
      rwaTvlUsd: num(r.rwa_tvl),
      protocolCount: num(r.protocol_count),
      fetchedAt: r.fetched_at as number,
      source: r.source as string,
    };
  },

  all(): Map<string, DefiMetrics> {
    const rows = getDb().prepare("SELECT chain_slug FROM chain_metrics").all() as Array<{
      chain_slug: string;
    }>;
    const out = new Map<string, DefiMetrics>();
    for (const r of rows) {
      const m = metrics.get(r.chain_slug);
      if (m) out.set(r.chain_slug, m);
    }
    return out;
  },

  tvlHistory(slug: string, sinceMs: number): number[] {
    return (
      getDb()
        .prepare("SELECT tvl_usd FROM tvl_history WHERE chain_slug=? AND ts>=? ORDER BY ts")
        .all(slug, sinceMs) as Array<{ tvl_usd: number }>
    ).map((r) => r.tvl_usd);
  },
};

export const head = {
  upsert(h: {
    chainSlug: string;
    blockHeight: number | null;
    blockTimestamp: number | null;
    observedBlockTimeSec: number | null;
    gasPriceGwei: number | null;
    txCount24h: number | null;
    healthy: boolean;
    latencyMs: number | null;
    error: string | null;
    fetchedAt: number;
    source: string;
  }): void {
    getDb().prepare(`
      INSERT INTO chain_head (chain_slug,block_height,block_timestamp,observed_bt_sec,
        gas_price_gwei,tx_count_24h,healthy,latency_ms,error,fetched_at,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(chain_slug) DO UPDATE SET
        block_height=excluded.block_height, block_timestamp=excluded.block_timestamp,
        observed_bt_sec=COALESCE(excluded.observed_bt_sec, chain_head.observed_bt_sec),
        gas_price_gwei=COALESCE(excluded.gas_price_gwei, chain_head.gas_price_gwei),
        tx_count_24h=COALESCE(excluded.tx_count_24h, chain_head.tx_count_24h),
        healthy=excluded.healthy, latency_ms=excluded.latency_ms, error=excluded.error,
        fetched_at=excluded.fetched_at, source=excluded.source
    `).run(
      h.chainSlug, h.blockHeight, h.blockTimestamp, h.observedBlockTimeSec, h.gasPriceGwei,
      h.txCount24h, bit(h.healthy), h.latencyMs, h.error, h.fetchedAt, h.source,
    );
  },

  get(slug: string): Record<string, unknown> | null {
    return (getDb().prepare("SELECT * FROM chain_head WHERE chain_slug=?").get(slug) ?? null) as
      | Record<string, unknown>
      | null;
  },

  all(): Map<string, Record<string, unknown>> {
    const rows = getDb().prepare("SELECT * FROM chain_head").all() as Array<Record<string, unknown>>;
    return new Map(rows.map((r) => [r.chain_slug as string, r]));
  },
};

/* ================================================================== */
/* Wallets                                                             */
/* ================================================================== */

function toWallet(r: Record<string, unknown>): WalletRecord {
  return {
    id: r.id as number,
    chainSlug: r.chain_slug as string,
    address: r.address as string,
    label: (r.label as string) ?? null,
    entity: (r.entity as string) ?? null,
    category: (r.category as AddressCategory) ?? "unknown",
    balanceNative: num(r.balance_native),
    balanceUsd: num(r.balance_usd),
    txCount: num(r.tx_count),
    firstSeen: num(r.first_seen),
    lastSeen: num(r.last_seen),
    whaleScore: num(r.whale_score),
    tags: P<string[]>(r.tags, []),
    confidence: (r.confidence as number) ?? 0.5,
    source: (r.source as string) ?? null,
  };
}

export const wallets = {
  get(chainSlug: string, address: string): WalletRecord | null {
    const r = getDb()
      .prepare("SELECT * FROM wallets WHERE chain_slug=? AND lower(address)=lower(?)")
      .get(chainSlug, address) as Record<string, unknown> | undefined;
    return r ? toWallet(r) : null;
  },

  /** Look an address up on any chain — used when /address gets a bare hash. */
  findAnywhere(address: string): WalletRecord[] {
    return (
      getDb()
        .prepare("SELECT * FROM wallets WHERE lower(address)=lower(?)")
        .all(address) as Array<Record<string, unknown>>
    ).map(toWallet);
  },

  upsertLabel(w: {
    chainSlug: string;
    address: string;
    label?: string | null;
    entity?: string | null;
    category?: AddressCategory;
    tags?: string[];
    confidence?: number;
    source?: string;
  }): void {
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO wallets (chain_slug,address,label,entity,category,tags,confidence,source,first_seen,last_seen)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(chain_slug,address) DO UPDATE SET
        label=COALESCE(excluded.label, wallets.label),
        entity=COALESCE(excluded.entity, wallets.entity),
        category=CASE WHEN excluded.confidence >= wallets.confidence
                      THEN excluded.category ELSE wallets.category END,
        tags=excluded.tags,
        confidence=MAX(excluded.confidence, wallets.confidence),
        source=COALESCE(excluded.source, wallets.source),
        last_seen=excluded.last_seen
    `).run(
      w.chainSlug, w.address, w.label ?? null, w.entity ?? null, w.category ?? "unknown",
      J(w.tags ?? []), w.confidence ?? 0.5, w.source ?? null, now, now,
    );
  },

  touch(chainSlug: string, address: string, seenAt: number): void {
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO wallets (chain_slug,address,category,tags,confidence,first_seen,last_seen)
      VALUES (?,?,'unknown','[]',0.3,?,?)
      ON CONFLICT(chain_slug,address) DO UPDATE SET
        last_seen=MAX(excluded.last_seen, COALESCE(wallets.last_seen,0)),
        first_seen=MIN(COALESCE(wallets.first_seen, excluded.first_seen), excluded.first_seen)
    `).run(chainSlug, address, seenAt || now, seenAt || now);
  },

  setBalance(chainSlug: string, address: string, native: number | null, usd: number | null): void {
    getDb()
      .prepare("UPDATE wallets SET balance_native=?, balance_usd=? WHERE chain_slug=? AND lower(address)=lower(?)")
      .run(native, usd, chainSlug, address);
  },

  setScore(chainSlug: string, address: string, score: number): void {
    getDb()
      .prepare("UPDATE wallets SET whale_score=? WHERE chain_slug=? AND lower(address)=lower(?)")
      .run(score, chainSlug, address);
  },

  topWhales(chainSlug: string, limit = 10): WalletRecord[] {
    return (
      getDb().prepare(`
        SELECT * FROM wallets
        WHERE chain_slug=? AND whale_score IS NOT NULL
        ORDER BY whale_score DESC LIMIT ?
      `).all(chainSlug, limit) as Array<Record<string, unknown>>
    ).map(toWallet);
  },

  byCategory(chainSlug: string, category: AddressCategory, limit = 25): WalletRecord[] {
    return (
      getDb()
        .prepare("SELECT * FROM wallets WHERE chain_slug=? AND category=? ORDER BY COALESCE(balance_usd,0) DESC LIMIT ?")
        .all(chainSlug, category, limit) as Array<Record<string, unknown>>
    ).map(toWallet);
  },

  countByChain(chainSlug: string): number {
    const r = getDb()
      .prepare("SELECT COUNT(*) n FROM wallets WHERE chain_slug=?")
      .get(chainSlug) as { n: number };
    return r.n;
  },
};

/* ================================================================== */
/* Whale events                                                        */
/* ================================================================== */

export const whales = {
  /**
   * Returns true when the row was new. The UNIQUE(chain,tx,log_index) index is
   * what makes block replay and overlapping scan windows harmless.
   */
  insert(e: WhaleEvent): boolean {
    const r = getDb().prepare(`
      INSERT INTO whale_transactions (chain_slug,tx_hash,log_index,block_number,ts,
        token_symbol,token_address,amount,amount_usd,price_usd,from_address,to_address,
        from_label,to_label,from_category,to_category,event_type,tier,confidence,source,explorer_url)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(chain_slug,tx_hash,log_index) DO NOTHING
    `).run(
      e.chainSlug, e.txHash, e.logIndex ?? -1, e.blockNumber, e.timestamp, e.tokenSymbol,
      e.tokenAddress, e.amount, e.amountUsd, e.priceUsd, e.fromAddress, e.toAddress,
      e.fromLabel, e.toLabel, e.fromCategory, e.toCategory, e.eventType, e.tier,
      e.confidence, e.source, e.explorerUrl,
    );
    return Number(r.changes) > 0;
  },

  /** Events that have not yet been pushed to Discord. */
  pendingAlerts(limit = 25): Array<WhaleEvent & { id: number }> {
    const rows = getDb()
      .prepare("SELECT * FROM whale_transactions WHERE alerted=0 ORDER BY amount_usd DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...rowToWhale(r), id: r.id as number }));
  },

  markAlerted(ids: number[]): void {
    if (!ids.length) return;
    const d = getDb();
    const stmt = d.prepare("UPDATE whale_transactions SET alerted=1 WHERE id=?");
    for (const id of ids) stmt.run(id);
  },

  recent(chainSlug: string | null, limit = 10, minUsd = 0): WhaleEvent[] {
    const d = getDb();
    const rows = chainSlug
      ? d.prepare("SELECT * FROM whale_transactions WHERE chain_slug=? AND amount_usd>=? ORDER BY ts DESC LIMIT ?").all(chainSlug, minUsd, limit)
      : d.prepare("SELECT * FROM whale_transactions WHERE amount_usd>=? ORDER BY ts DESC LIMIT ?").all(minUsd, limit);
    return (rows as Array<Record<string, unknown>>).map(rowToWhale);
  },

  largest(chainSlug: string | null, sinceMs: number, limit = 10): WhaleEvent[] {
    const d = getDb();
    const rows = chainSlug
      ? d.prepare("SELECT * FROM whale_transactions WHERE chain_slug=? AND ts>=? ORDER BY amount_usd DESC LIMIT ?").all(chainSlug, sinceMs, limit)
      : d.prepare("SELECT * FROM whale_transactions WHERE ts>=? ORDER BY amount_usd DESC LIMIT ?").all(sinceMs, limit);
    return (rows as Array<Record<string, unknown>>).map(rowToWhale);
  },

  countSince(chainSlug: string, sinceMs: number): number {
    const r = getDb()
      .prepare("SELECT COUNT(*) n FROM whale_transactions WHERE chain_slug=? AND ts>=?")
      .get(chainSlug, sinceMs) as { n: number };
    return r.n;
  },

  /** Net exchange flow: deposits minus withdrawals, in USD. */
  exchangeFlow(chainSlug: string, sinceMs: number): { inUsd: number; outUsd: number } {
    const d = getDb();
    const i = d.prepare("SELECT COALESCE(SUM(amount_usd),0) s FROM whale_transactions WHERE chain_slug=? AND ts>=? AND event_type='exchange_deposit'").get(chainSlug, sinceMs) as { s: number };
    const o = d.prepare("SELECT COALESCE(SUM(amount_usd),0) s FROM whale_transactions WHERE chain_slug=? AND ts>=? AND event_type='exchange_withdrawal'").get(chainSlug, sinceMs) as { s: number };
    return { inUsd: i.s, outUsd: o.s };
  },

  byAddress(address: string, limit = 10): WhaleEvent[] {
    return (
      getDb().prepare(`
        SELECT * FROM whale_transactions
        WHERE lower(from_address)=lower(?) OR lower(to_address)=lower(?)
        ORDER BY ts DESC LIMIT ?
      `).all(address, address, limit) as Array<Record<string, unknown>>
    ).map(rowToWhale);
  },

  byTxHash(hash: string): WhaleEvent[] {
    return (
      getDb()
        .prepare("SELECT * FROM whale_transactions WHERE lower(tx_hash)=lower(?)")
        .all(hash) as Array<Record<string, unknown>>
    ).map(rowToWhale);
  },

  prune(olderThanMs: number): number {
    const r = getDb().prepare("DELETE FROM whale_transactions WHERE ts < ?").run(olderThanMs);
    return Number(r.changes);
  },
};

function rowToWhale(r: Record<string, unknown>): WhaleEvent {
  return {
    chainSlug: r.chain_slug as string,
    txHash: r.tx_hash as string,
    logIndex: num(r.log_index),
    blockNumber: num(r.block_number),
    timestamp: r.ts as number,
    tokenSymbol: r.token_symbol as string,
    tokenAddress: (r.token_address as string) ?? null,
    amount: r.amount as number,
    amountUsd: r.amount_usd as number,
    priceUsd: num(r.price_usd),
    fromAddress: r.from_address as string,
    toAddress: r.to_address as string,
    fromLabel: (r.from_label as string) ?? null,
    toLabel: (r.to_label as string) ?? null,
    fromCategory: (r.from_category as AddressCategory) ?? "unknown",
    toCategory: (r.to_category as AddressCategory) ?? "unknown",
    eventType: r.event_type as WhaleEvent["eventType"],
    tier: r.tier as WhaleEvent["tier"],
    confidence: (r.confidence as number) ?? 1,
    source: r.source as string,
    explorerUrl: (r.explorer_url as string) ?? "",
  };
}

/* ================================================================== */
/* Scan cursors                                                        */
/* ================================================================== */

export const cursors = {
  get(chainSlug: string, scanner: string): { lastBlock: number | null; lastValue: string | null } {
    const r = getDb()
      .prepare("SELECT last_block, last_value FROM scan_cursors WHERE chain_slug=? AND scanner=?")
      .get(chainSlug, scanner) as { last_block: number | null; last_value: string | null } | undefined;
    return { lastBlock: r?.last_block ?? null, lastValue: r?.last_value ?? null };
  },
  set(chainSlug: string, scanner: string, lastBlock: number | null, lastValue?: string | null): void {
    getDb().prepare(`
      INSERT INTO scan_cursors (chain_slug,scanner,last_block,last_value,updated_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(chain_slug,scanner) DO UPDATE SET
        last_block=excluded.last_block, last_value=excluded.last_value,
        updated_at=excluded.updated_at
    `).run(chainSlug, scanner, lastBlock, lastValue ?? null, Date.now());
  },
};

/* ================================================================== */
/* Guilds, alerts, watchlists                                          */
/* ================================================================== */

export const guilds = {
  register(guildId: string, name: string | null): void {
    const d = getDb();
    d.prepare("INSERT INTO guilds (guild_id,name,joined_at) VALUES (?,?,?) ON CONFLICT(guild_id) DO UPDATE SET name=excluded.name")
      .run(guildId, name, Date.now());
    d.prepare("INSERT INTO guild_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING")
      .run(guildId);
  },

  settings(guildId: string): GuildSettings {
    const d = getDb();
    d.prepare("INSERT INTO guild_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING").run(guildId);
    const r = d.prepare("SELECT * FROM guild_settings WHERE guild_id=?").get(guildId) as Record<string, unknown>;
    return {
      guildId,
      categoryPrefix: (r.category_prefix as string) ?? "CHAINTRACKER",
      channels: P<Record<string, string>>(r.channels, {}),
      whaleMinUsd: (r.whale_min_usd as number) ?? 1_000_000,
      enabledChains: P<string[] | null>(r.enabled_chains, null),
      setupAt: num(r.setup_at),
    };
  },

  setChannels(guildId: string, channels: Record<string, string>): void {
    getDb()
      .prepare("UPDATE guild_settings SET channels=?, setup_at=? WHERE guild_id=?")
      .run(J(channels), Date.now(), guildId);
  },

  setWhaleMin(guildId: string, usd: number): void {
    getDb().prepare("UPDATE guild_settings SET whale_min_usd=? WHERE guild_id=?").run(usd, guildId);
  },

  all(): GuildSettings[] {
    return (getDb().prepare("SELECT guild_id FROM guild_settings").all() as Array<{ guild_id: string }>)
      .map((r) => guilds.settings(r.guild_id));
  },
};

export const alerts = {
  create(a: Omit<AlertRule, "id" | "createdAt" | "lastFiredAt">): number {
    const r = getDb().prepare(`
      INSERT INTO alerts (guild_id,channel_id,user_id,kind,chain_slug,target,comparator,
        threshold,cooldown_sec,enabled,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      a.guildId, a.channelId, a.userId, a.kind, a.chainSlug, a.target, a.comparator,
      a.threshold, a.cooldownSec, bit(a.enabled), Date.now(),
    );
    return Number(r.lastInsertRowid);
  },

  list(guildId: string, userId?: string): AlertRule[] {
    const d = getDb();
    const rows = userId
      ? d.prepare("SELECT * FROM alerts WHERE guild_id=? AND user_id=? ORDER BY id DESC").all(guildId, userId)
      : d.prepare("SELECT * FROM alerts WHERE guild_id=? ORDER BY id DESC").all(guildId);
    return (rows as Array<Record<string, unknown>>).map(toAlert);
  },

  active(kind?: string): AlertRule[] {
    const d = getDb();
    const rows = kind
      ? d.prepare("SELECT * FROM alerts WHERE enabled=1 AND kind=?").all(kind)
      : d.prepare("SELECT * FROM alerts WHERE enabled=1").all();
    return (rows as Array<Record<string, unknown>>).map(toAlert);
  },

  remove(id: number, guildId: string): boolean {
    const r = getDb().prepare("DELETE FROM alerts WHERE id=? AND guild_id=?").run(id, guildId);
    return Number(r.changes) > 0;
  },

  markFired(id: number): void {
    getDb().prepare("UPDATE alerts SET last_fired_at=? WHERE id=?").run(Date.now(), id);
  },

  /**
   * Records a firing and reports whether it is a duplicate inside the window.
   * The fingerprint is caller-supplied so a price alert and a whale alert
   * dedupe on different things.
   */
  claimFingerprint(fingerprint: string, windowMs: number): boolean {
    const d = getDb();
    const now = Date.now();
    const r = d.prepare("SELECT fired_at FROM alert_dedupe WHERE fingerprint=?").get(fingerprint) as
      | { fired_at: number }
      | undefined;
    if (r && now - r.fired_at < windowMs) return false;
    d.prepare("INSERT INTO alert_dedupe (fingerprint,fired_at) VALUES (?,?) ON CONFLICT(fingerprint) DO UPDATE SET fired_at=excluded.fired_at")
      .run(fingerprint, now);
    return true;
  },

  pruneDedupe(olderThanMs: number): void {
    getDb().prepare("DELETE FROM alert_dedupe WHERE fired_at < ?").run(Date.now() - olderThanMs);
  },
};

function toAlert(r: Record<string, unknown>): AlertRule {
  return {
    id: r.id as number,
    guildId: r.guild_id as string,
    channelId: (r.channel_id as string) ?? null,
    userId: (r.user_id as string) ?? null,
    kind: r.kind as AlertRule["kind"],
    chainSlug: (r.chain_slug as string) ?? null,
    target: (r.target as string) ?? null,
    comparator: r.comparator as AlertRule["comparator"],
    threshold: r.threshold as number,
    cooldownSec: r.cooldown_sec as number,
    enabled: r.enabled === 1,
    lastFiredAt: num(r.last_fired_at),
    createdAt: r.created_at as number,
  };
}

export const watchlists = {
  add(guildId: string, userId: string, kind: string, value: string, chainSlug: string | null): boolean {
    const r = getDb().prepare(`
      INSERT INTO watchlists (guild_id,user_id,kind,value,chain_slug,created_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING
    `).run(guildId, userId, kind, value, chainSlug, Date.now());
    return Number(r.changes) > 0;
  },
  remove(guildId: string, userId: string, kind: string, value: string): boolean {
    const r = getDb()
      .prepare("DELETE FROM watchlists WHERE guild_id=? AND user_id=? AND kind=? AND lower(value)=lower(?)")
      .run(guildId, userId, kind, value);
    return Number(r.changes) > 0;
  },
  list(guildId: string, userId: string): Array<{ kind: string; value: string; chainSlug: string | null }> {
    return (
      getDb()
        .prepare("SELECT kind,value,chain_slug FROM watchlists WHERE guild_id=? AND user_id=? ORDER BY kind,value")
        .all(guildId, userId) as Array<{ kind: string; value: string; chain_slug: string | null }>
    ).map((r) => ({ kind: r.kind, value: r.value, chainSlug: r.chain_slug }));
  },
  /** Every distinct watched address, so the scanner knows what to follow. */
  watchedAddresses(): Array<{ address: string; chainSlug: string | null }> {
    return getDb()
      .prepare("SELECT DISTINCT value AS address, chain_slug AS chainSlug FROM watchlists WHERE kind='address'")
      .all() as Array<{ address: string; chainSlug: string | null }>;
  },
};

/* ================================================================== */
/* Usage accounting                                                    */
/* ================================================================== */

export const usage = {
  record(provider: string, units: number, latencyMs: number, ok: boolean): void {
    const day = new Date().toISOString().slice(0, 10);
    getDb().prepare(`
      INSERT INTO api_usage (provider,day,calls,failures,units,latency_sum)
      VALUES (?,?,1,?,?,?)
      ON CONFLICT(provider,day) DO UPDATE SET
        calls=api_usage.calls+1,
        failures=api_usage.failures+excluded.failures,
        units=api_usage.units+excluded.units,
        latency_sum=api_usage.latency_sum+excluded.latency_sum
    `).run(provider, day, ok ? 0 : 1, units, latencyMs);
  },

  /** Usage for the current calendar month — the window free tiers reset on. */
  month(provider: string): { calls: number; failures: number; units: number; avgLatency: number } {
    const prefix = new Date().toISOString().slice(0, 7);
    const r = getDb().prepare(`
      SELECT COALESCE(SUM(calls),0) calls, COALESCE(SUM(failures),0) failures,
             COALESCE(SUM(units),0) units, COALESCE(SUM(latency_sum),0) lat
      FROM api_usage WHERE provider=? AND day LIKE ?
    `).get(provider, `${prefix}%`) as { calls: number; failures: number; units: number; lat: number };
    return {
      calls: r.calls,
      failures: r.failures,
      units: r.units,
      avgLatency: r.calls ? r.lat / r.calls : 0,
    };
  },

  today(provider: string): { calls: number; units: number } {
    const day = new Date().toISOString().slice(0, 10);
    const r = getDb()
      .prepare("SELECT COALESCE(calls,0) calls, COALESCE(units,0) units FROM api_usage WHERE provider=? AND day=?")
      .get(provider, day) as { calls: number; units: number } | undefined;
    return { calls: r?.calls ?? 0, units: r?.units ?? 0 };
  },

  allProviders(): string[] {
    return (getDb().prepare("SELECT DISTINCT provider FROM api_usage").all() as Array<{ provider: string }>)
      .map((r) => r.provider);
  },
};

export function closeDb(): void {
  db?.close();
  db = null;
}
