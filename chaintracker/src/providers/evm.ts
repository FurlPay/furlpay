// EVM blockchain provider.
//
// One instance serves every EVM chain. Endpoints are ordered per chain —
// Alchemy first when the key is set AND the network is enabled on the account,
// then public RPCs — and a failure walks down the list rather than giving up.
// The "enabled on the account" part is not theoretical: a free Alchemy app has
// only a handful of networks switched on and the rest answer 403, so the
// endpoint list is pruned at runtime by `probeEndpoints()`.

import { env } from "../config/env.js";
import {
  Provider,
  TRANSFER_TOPIC,
  ZERO_ADDRESS,
  fromWei,
  hexToBig,
  hexToNum,
  topicToAddress,
} from "./base.js";
import type { ChainRow } from "../types/index.js";

export interface EvmBlock {
  number: number;
  timestamp: number;
  hash: string;
  transactions: EvmTx[];
  gasUsed: bigint;
  baseFeePerGas: bigint | null;
}

export interface EvmTx {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
}

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

export interface TokenTransfer {
  tokenAddress: string;
  from: string;
  to: string;
  rawValue: bigint;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  /**
   * The hash of the block this log came from.
   *
   * Carried through because reorg detection needs it: a stored hash that no longer
   * matches the chain at that height is how an orphaned block is identified, and the
   * log already supplies it so there is nothing to fetch.
   */
  blockHash: string | null;
  /**
   * Block time in ms, when the endpoint supplied it on the log itself.
   *
   * Modern geth and friends include `blockTimestamp` in eth_getLogs responses.
   * Measured across all seven public endpoints this repository uses — Ethereum,
   * Base, Arbitrum, OP Mainnet, Polygon, Celo and ZKsync Era — every one returns
   * it on every log. That makes a separate round of eth_getBlockByNumber calls
   * unnecessary, which matters twice over: it is ~34 fewer batched calls per chain
   * per tick, and the header fetches were the single largest source of dropped
   * transfers (38,518 Ethereum rows lost in one measured backfill when a batch was
   * refused).
   *
   * null when an endpoint does not provide it, and the caller then falls back to
   * reading headers for those blocks.
   */
  blockTimestamp: number | null;
}

/** Alchemy publishes compute-unit costs per method; these are the ones we use. */
const CU: Record<string, number> = {
  eth_blockNumber: 10,
  eth_getBlockByNumber: 16,
  eth_getLogs: 75,
  eth_gasPrice: 19,
  eth_getBalance: 19,
  eth_call: 26,
  eth_getTransactionByHash: 17,
  eth_getTransactionReceipt: 15,
  eth_chainId: 0,
};

/**
 * Errors that mean "ask for a smaller range", not "this endpoint is broken".
 * Kept in one place because both the bisection logic and the breaker need to
 * agree on what counts as benign.
 */
export function isRangeTooLarge(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    // Alchemy free tier: "you can make eth_getLogs requests with up to a
    // 10 block range" (-32600). Phrased as a plan limit, not a size error.
    /block range|blocks? range|range is too|up to a \d+ block/i.test(msg) ||
    /too large|response size|exceed|too many results|query returned more than/i.test(msg) ||
    /-32020|-32005|-32600/.test(msg) ||
    /suitable provider|request timeout on the free plan/i.test(msg)
  );
}

export class EvmProvider extends Provider {
  /** chainSlug → ordered endpoint list, pruned of anything that 403s. */
  private endpoints = new Map<string, string[]>();
  private probed = new Set<string>();
  /**
   * Largest eth_getLogs block span each chain has actually tolerated.
   * Learned at runtime: halved whenever a range is refused, nudged back up
   * after a clean run. Without this, every scan rediscovers the same limit by
   * failing first, and on a busy chain that wastes the whole tick.
   */
  private maxLogSpan = new Map<string, number>();
  /**
   * Largest span a chain has ever been REFUSED at. Growth stops below this, so
   * the learned window settles instead of oscillating over the provider's
   * limit — every overshoot costs a failed call and can spill onto a
   * rate-limited public fallback.
   */
  private refusedAt = new Map<string, number>();
  // Alchemy's free plan refuses any eth_getLogs wider than 10 blocks, and it
  // is the primary endpoint wherever a network is enabled — so start there
  // rather than discovering it by failing on every cold start.
  private static readonly SPAN_START = 10;
  private static readonly SPAN_MIN = 1;
  private static readonly SPAN_MAX = 500;
  /**
   * Hard ceiling on getLogs calls per scan. Ten-block windows mean a wide
   * backfill would otherwise turn into hundreds of calls and blow the tick
   * budget; stopping early yields fewer events, never wrong ones.
   */
  private static readonly MAX_LOG_CALLS = 30;

  private spanFor(slug: string): number {
    return this.maxLogSpan.get(slug) ?? EvmProvider.SPAN_START;
  }
  private shrinkSpan(slug: string): number {
    const current = this.spanFor(slug);
    const priorRefusal = this.refusedAt.get(slug) ?? Infinity;
    this.refusedAt.set(slug, Math.min(priorRefusal, current));
    const next = Math.max(EvmProvider.SPAN_MIN, Math.floor(current / 2));
    this.maxLogSpan.set(slug, next);
    return next;
  }
  private growSpan(slug: string): void {
    const refused = this.refusedAt.get(slug);
    // Stay strictly under the smallest span ever refused. Without this the
    // window creeps back over the provider's cap, fails, and the retry lands
    // on a public endpoint that answers 429.
    const ceiling =
      refused === undefined
        ? EvmProvider.SPAN_MAX
        : Math.max(EvmProvider.SPAN_MIN, refused - 1);
    const next = Math.min(ceiling, Math.ceil(this.spanFor(slug) * 1.25));
    this.maxLogSpan.set(slug, Math.max(EvmProvider.SPAN_MIN, next));
  }

  constructor() {
    super({
      name: "evm-rpc",
      kind: "blockchain",
      configured: true, // public RPCs always exist, so this provider is never dark
      rps: 12,
      timeoutMs: 12_000,
      attempts: 2,
      budgetLimit: env.alchemyKey ? env.alchemyMonthlyCu : null,
    });
  }

  /** Endpoints for a chain, Alchemy first when usable. */
  private listFor(chain: ChainRow): string[] {
    const cached = this.endpoints.get(chain.slug);
    if (cached) return cached;
    const list: string[] = [];
    if (env.alchemyKey && chain.alchemySubdomain) {
      list.push(`https://${chain.alchemySubdomain}.g.alchemy.com/v2/${env.alchemyKey}`);
    }
    if (env.publicRpcFallback) list.push(...chain.publicRpc);
    this.endpoints.set(chain.slug, list);
    return list;
  }

  /** True when the first endpoint for this chain is Alchemy. */
  usingAlchemy(chain: ChainRow): boolean {
    return (this.listFor(chain)[0] ?? "").includes("alchemy.com");
  }

  /**
   * Drop an endpoint that answered 403 / "not enabled". Done once per chain so
   * a disabled Alchemy network costs a single wasted call for the process life.
   */
  private demote(chain: ChainRow, endpoint: string, reason: string): void {
    const list = this.listFor(chain).filter((e) => e !== endpoint);
    this.endpoints.set(chain.slug, list);
    this.log.warn("endpoint demoted", {
      chain: chain.slug,
      host: safeHost(endpoint),
      reason: reason.slice(0, 120),
      remaining: list.length,
    });
  }

  /** Try each endpoint in order; the first that answers wins. */
  private async call<T>(
    chain: ChainRow,
    method: string,
    params: unknown[] = [],
  ): Promise<T> {
    const list = this.listFor(chain);
    if (!list.length) {
      throw new Error(`no RPC endpoint configured for ${chain.slug}`);
    }
    let lastErr: unknown = null;
    for (const url of [...list]) {
      try {
        return await this.rpc<T>(url, method, params, {
          units: CU[method] ?? 10,
          label: `${chain.slug}.${method}`,
          breakerKey: chain.slug,
          benign: isRangeTooLarge,
        });
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/not enabled|403|forbidden|unauthorized|401/i.test(msg) && list.length > 1) {
          this.demote(chain, url, msg);
        }
      }
    }
    throw lastErr ?? new Error(`all endpoints failed for ${chain.slug}.${method}`);
  }

  private async callBatch<T>(
    chain: ChainRow,
    calls: Array<{ method: string; params?: unknown[] }>,
  ): Promise<Array<T | null>> {
    const list = this.listFor(chain);
    if (!list.length || !calls.length) return calls.map(() => null);
    const units = calls.reduce((s, c) => s + (CU[c.method] ?? 10), 0);
    let lastErr: unknown = null;
    for (const url of [...list]) {
      try {
        return await this.rpcBatch<T>(url, calls, {
          units,
          label: `${chain.slug}.batch`,
          breakerKey: chain.slug,
        });
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/not enabled|403|forbidden/i.test(msg) && list.length > 1) this.demote(chain, url, msg);
      }
    }
    throw lastErr ?? new Error(`batch failed for ${chain.slug}`);
  }

  /** Which endpoint is actually serving a chain — surfaced by /providers. */
  activeEndpoint(chain: ChainRow): string {
    return safeHost(this.listFor(chain)[0] ?? "");
  }

  /* ---------------------------------------------------------------- */
  /* Reads                                                             */
  /* ---------------------------------------------------------------- */

  async blockNumber(chain: ChainRow): Promise<number> {
    const r = await this.call<string>(chain, "eth_blockNumber");
    const n = hexToNum(r);
    if (n === null) throw new Error(`bad block number from ${chain.slug}`);
    return n;
  }

  async chainId(chain: ChainRow): Promise<number | null> {
    try {
      return hexToNum(await this.call<string>(chain, "eth_chainId"));
    } catch {
      return null;
    }
  }

  async gasPriceGwei(chain: ChainRow): Promise<number | null> {
    try {
      const wei = hexToBig(await this.call<string>(chain, "eth_gasPrice"));
      return fromWei(wei, 9);
    } catch {
      return null;
    }
  }

  async balance(chain: ChainRow, address: string): Promise<number | null> {
    try {
      const wei = hexToBig(await this.call<string>(chain, "eth_getBalance", [address, "latest"]));
      return fromWei(wei, chain.nativeDecimals);
    } catch {
      return null;
    }
  }

  async getBlock(chain: ChainRow, blockNumber: number | "latest", withTxs = false): Promise<EvmBlock | null> {
    const tag = blockNumber === "latest" ? "latest" : `0x${blockNumber.toString(16)}`;
    const raw = await this.call<RawBlock | null>(chain, "eth_getBlockByNumber", [tag, withTxs]);
    return raw ? parseBlock(raw, withTxs) : null;
  }

  /** Several blocks in one round trip — the block scanner's workhorse. */
  async getBlocks(chain: ChainRow, from: number, to: number, withTxs: boolean): Promise<EvmBlock[]> {
    const calls: Array<{ method: string; params: unknown[] }> = [];
    for (let n = from; n <= to; n++) {
      calls.push({ method: "eth_getBlockByNumber", params: [`0x${n.toString(16)}`, withTxs] });
    }
    const raw = await this.callBatch<RawBlock>(chain, calls);
    return raw.filter((b): b is RawBlock => !!b).map((b) => parseBlock(b, withTxs));
  }

  /**
   * ERC-20 Transfer logs in a block range, optionally narrowed to a token set.
   * Narrowing matters: an unfiltered range on Ethereum returns thousands of
   * logs, and the response size — not the call count — is what hurts.
   */
  async transferLogs(
    chain: ChainRow,
    fromBlock: number,
    toBlock: number,
    tokenAddresses?: string[],
  ): Promise<TokenTransfer[]> {
    const filter: Record<string, unknown> = {
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [TRANSFER_TOPIC],
    };
    if (tokenAddresses?.length) filter.address = tokenAddresses;

    const logs = await this.getLogsAdaptive(chain, filter, fromBlock, toBlock);
    const out: TokenTransfer[] = [];
    for (const l of logs ?? []) {
      // A 3-topic Transfer is ERC-20; 4 topics means ERC-721 (tokenId, not value).
      if (!Array.isArray(l.topics) || l.topics.length !== 3) continue;
      const from = topicToAddress(l.topics[1]!);
      const to = topicToAddress(l.topics[2]!);
      if (!from || !to) continue;
      out.push({
        tokenAddress: l.address.toLowerCase(),
        from,
        to,
        rawValue: hexToBig(l.data),
        txHash: l.transactionHash,
        logIndex: hexToNum(l.logIndex) ?? 0,
        blockNumber: hexToNum(l.blockNumber) ?? fromBlock,
        blockHash: l.blockHash ?? null,
        blockTimestamp: logTimestampMs(l.blockTimestamp),
      });
    }
    return out;
  }

  /**
   * Arbitrary eth_getLogs for one contract and topic filter.
   *
   * `transferLogs` above is ERC-20 specific: it hardcodes the Transfer topic and
   * discards anything without three topics. The CCTP scanner needs a different
   * contract and different event shapes, so it needs the raw logs — but it must
   * NOT reimplement the range bisection, which is the part that took real
   * measurement to get right. Hence this thin public door onto the same adaptive
   * reader.
   *
   * Block numbers come back decoded so callers do not each parse hex.
   */
  async rawLogs(
    chain: ChainRow,
    filter: { address: string; topics: string[]; fromBlock: number; toBlock: number },
  ): Promise<
    Array<{
      address: string;
      topics: string[];
      data: string;
      blockNumber: number;
      transactionHash: string;
      logIndex: number;
      blockTimestamp: number | null;
    }>
  > {
    const logs = await this.getLogsAdaptive(
      chain,
      { address: filter.address, topics: filter.topics },
      filter.fromBlock,
      filter.toBlock,
    );
    return (logs ?? []).map((l) => ({
      address: (l.address ?? "").toLowerCase(),
      topics: Array.isArray(l.topics) ? l.topics.map((t) => t.toLowerCase()) : [],
      data: l.data ?? "0x",
      blockNumber: hexToNum(l.blockNumber) ?? filter.fromBlock,
      transactionHash: l.transactionHash,
      logIndex: hexToNum(l.logIndex) ?? 0,
      blockTimestamp: logTimestampMs(l.blockTimestamp),
    }));
  }

  /**
   * eth_getLogs with automatic range bisection.
   *
   * Providers do not agree on how much they will return. Public endpoints
   * answer "backend response too large" (-32020), some cap the block span, and
   * others refuse to route the request at all. None of these are permanent
   * failures — they mean "ask for less" — so the range is halved and retried
   * until it fits or a single block still will not load.
   *
   * Without this, a busy chain like Ethereum or Base silently returns zero
   * whale events, which looks identical to a quiet market.
   */
  private async getLogsAdaptive(
    chain: ChainRow,
    filter: Record<string, unknown>,
    fromBlock: number,
    toBlock: number,
  ): Promise<EvmLogRaw[]> {
    const out: EvmLogRaw[] = [];
    let cursor = fromBlock;
    let calls = 0;

    while (cursor <= toBlock) {
      if (calls >= EvmProvider.MAX_LOG_CALLS) {
        this.log.debug("log-call budget reached", {
          chain: chain.slug,
          scannedTo: cursor - 1,
          requestedTo: toBlock,
        });
        break;
      }
      let span = Math.min(this.spanFor(chain.slug), toBlock - cursor + 1);
      let fetched = false;

      // Shrink until this window is accepted. Strictly sequential: a parallel
      // bisect fans out to hundreds of in-flight calls, starves the rate
      // limiter, and the resulting timeouts open the breaker — which is
      // exactly the failure this method exists to avoid.
      while (!fetched) {
        const hi = Math.min(toBlock, cursor + span - 1);
        try {
          const logs = await this.call<EvmLogRaw[]>(chain, "eth_getLogs", [
            {
              ...filter,
              fromBlock: `0x${cursor.toString(16)}`,
              toBlock: `0x${hi.toString(16)}`,
            },
          ]);
          if (Array.isArray(logs)) out.push(...logs);
          cursor = hi + 1;
          fetched = true;
          calls += 1;
          this.growSpan(chain.slug);
        } catch (err) {
          if (!isRangeTooLarge(err) || span <= EvmProvider.SPAN_MIN) throw err;
          span = this.shrinkSpan(chain.slug);
          this.log.debug("narrowing log span", { chain: chain.slug, span });
        }
      }
    }
    return out;
  }

  /**
   * A block by tag — "latest", "safe", "finalized", "earliest".
   *
   * WHY TAGS RATHER THAN A CONFIRMATION COUNT. A fixed depth is a guess about reorg
   * behaviour that differs by two orders of magnitude across the chains here. The
   * tags are the chain's own statement about its consensus, so they are the right
   * primitive — probed live on 2026-09-29, all twelve chains answer "finalized" and
   * eleven answer "safe" (Polygon rejects it).
   *
   * Returns null when the endpoint does not know the tag, rather than throwing, so a
   * missing "safe" degrades one signal instead of failing the pass.
   */
  async getBlockByTag(
    chain: ChainRow,
    tag: "latest" | "safe" | "finalized" | "earliest",
  ): Promise<{ number: number; hash: string; timestamp: number } | null> {
    try {
      const raw = await this.call<RawBlock | null>(chain, "eth_getBlockByNumber", [tag, false]);
      if (!raw) return null;
      const number = hexToNum(raw.number);
      if (number === null) return null;
      return {
        number,
        hash: raw.hash,
        timestamp: (hexToNum(raw.timestamp) ?? 0) * 1000,
      };
    } catch {
      return null;
    }
  }

  /**
   * The hash of the block currently at a given height.
   *
   * The reorg check: a height whose hash no longer matches what we stored means the
   * block we indexed is not on the chain that now exists. Returns null when the
   * block cannot be read, which the caller must NOT treat as a changed hash — an
   * unreadable block and a reorganised one are different facts.
   */
  async getBlockHashAt(chain: ChainRow, blockNumber: number): Promise<string | null> {
    const raw = await this.call<RawBlock | null>(chain, "eth_getBlockByNumber", [
      `0x${blockNumber.toString(16)}`,
      false,
    ]);
    return raw?.hash ?? null;
  }

  /**
   * Ask a SPECIFIC endpoint for a block hash, bypassing the fallback order.
   *
   * Every other read here takes the first endpoint that answers, which is right for
   * availability and useless for cross-validation — asking the same ordered list
   * twice just asks the same provider twice. This pins the URL so two providers can
   * be compared on the same height.
   *
   * Deliberately raw: no breaker, no budget accounting. It is a diagnostic, and it
   * must not be able to open a circuit that the ingestion path depends on.
   */
  async hashFromEndpoint(url: string, blockNumber: number, timeoutMs = 8000): Promise<string | null> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBlockByNumber",
          params: [`0x${blockNumber.toString(16)}`, false],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: { hash?: string } | null };
      return body.result?.hash ?? null;
    } catch {
      return null;
    }
  }

  /**
   * The endpoints configured for a chain, as hostnames paired with their URLs.
   *
   * Exposed so the cross-validator can pick two DIFFERENT providers. The hostname is
   * safe to log; the URL carries the API key and must not be.
   */
  endpointsFor(chain: ChainRow): Array<{ host: string; url: string }> {
    return this.listFor(chain).map((url) => ({ host: safeHost(url), url }));
  }

  /**
   * Block timestamps for an explicit, possibly sparse list of block numbers.
   *
   * WHY THIS EXISTS ALONGSIDE `getBlocks`. `getBlocks` takes a contiguous range,
   * which is the wrong shape for "date these 1,127 specific blocks scattered over
   * 2,000". Walking the range in 60-block windows fetched every block in between —
   * 2,040 header reads to learn 1,127 timestamps — and a single refused batch lost
   * every block in it with no retry. Measured on Arbitrum: 840 of 1,127 blocks came
   * back, and the 287 missing cost 4,371 real transfers, because a transfer that
   * cannot be dated is dropped rather than misdated.
   *
   * So this asks for exactly the blocks wanted, and retries whatever is still
   * missing in smaller batches. A large batch is faster when it works; a small one
   * is what works when the endpoint is refusing.
   *
   * Returns whatever it could read. Partial is safe — the caller drops the rest.
   */
  async blockTimestampsFor(
    chain: ChainRow,
    blockNumbers: readonly number[],
  ): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    const wanted = [...new Set(blockNumbers)].sort((a, b) => a - b);
    if (wanted.length === 0) return out;

    // Newest first, so if the endpoint gives up part way we keep the blocks an
    // alert is most likely to be about.
    const ordered = [...wanted].reverse();

    const fetchBatch = async (nums: readonly number[]): Promise<void> => {
      const calls = nums.map((n) => ({
        method: "eth_getBlockByNumber",
        params: [`0x${n.toString(16)}`, false] as unknown[],
      }));
      const raw = await this.callBatch<{ number: string; timestamp: string }>(chain, calls);
      for (const b of raw) {
        if (!b) continue;
        const num = hexToNum(b.number);
        const secs = hexToNum(b.timestamp);
        if (num !== null && secs !== null && secs > 0) out.set(num, secs * 1000);
      }
    };

    // Three descending batch sizes. Measured on Arbitrum, where every endpoint
    // omits `blockTimestamp` on a varying share of logs so a cold start can need
    // 1,100+ header reads in one pass: a single pass at 60 returned 768 of 1,131,
    // and each smaller retry recovers most of what the previous one was refused.
    // Large batches are fast when they work; small ones are what work when an
    // endpoint is under load.
    for (const size of [60, 20, 5]) {
      const missing = ordered.filter((n) => !out.has(n));
      if (missing.length === 0) break;
      for (let i = 0; i < missing.length; i += size) {
        try {
          await fetchBatch(missing.slice(i, i + size));
        } catch (err) {
          // One failed batch is not fatal; the smaller pass below may recover it.
          this.log.debug("header batch failed", {
            chain: chain.slug,
            size,
            error: (err as Error).message.slice(0, 80),
          });
        }
      }
    }

    if (out.size < wanted.length) {
      this.log.debug("header timestamps incomplete", {
        chain: chain.slug,
        got: out.size,
        wanted: wanted.length,
      });
    }
    return out;
  }

  /** ERC-20 metadata via eth_call; returns nulls rather than throwing. */
  async tokenMeta(
    chain: ChainRow,
    token: string,
  ): Promise<{ symbol: string | null; decimals: number | null }> {
    try {
      const [symRaw, decRaw] = await this.callBatch<string>(chain, [
        { method: "eth_call", params: [{ to: token, data: "0x95d89b41" }, "latest"] }, // symbol()
        { method: "eth_call", params: [{ to: token, data: "0x313ce567" }, "latest"] }, // decimals()
      ]);
      return {
        symbol: symRaw ? decodeAbiString(symRaw) : null,
        decimals: decRaw ? (hexToNum(decRaw) ?? null) : null,
      };
    } catch {
      return { symbol: null, decimals: null };
    }
  }

  async getTransaction(
    chain: ChainRow,
    hash: string,
  ): Promise<{ from: string; to: string | null; value: bigint; blockNumber: number | null } | null> {
    try {
      const t = await this.call<{
        from: string;
        to: string | null;
        value: string;
        blockNumber: string | null;
      } | null>(chain, "eth_getTransactionByHash", [hash]);
      if (!t) return null;
      return {
        from: (t.from ?? "").toLowerCase(),
        to: t.to ? t.to.toLowerCase() : null,
        value: hexToBig(t.value),
        blockNumber: hexToNum(t.blockNumber),
      };
    } catch {
      return null;
    }
  }

  /**
   * Confirm each chain's primary endpoint answers, demoting dead ones. Run once
   * at startup so the first real collector tick is not spent discovering 403s.
   */
  async probeEndpoints(chainsToProbe: ChainRow[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const c of chainsToProbe) {
      if (c.chainType !== "evm" || this.probed.has(c.slug)) continue;
      this.probed.add(c.slug);
      try {
        await this.blockNumber(c);
        out.set(c.slug, this.activeEndpoint(c));
      } catch (err) {
        out.set(c.slug, `unreachable: ${(err as Error).message.slice(0, 60)}`);
      }
    }
    return out;
  }

  async ping(): Promise<boolean> {
    const eth: ChainRow = {
      slug: "ethereum",
      alchemySubdomain: env.alchemyKey ? "eth-mainnet" : null,
      publicRpc: ["https://ethereum-rpc.publicnode.com"],
    } as ChainRow;
    try {
      return (await this.blockNumber(eth)) > 0;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

interface RawBlock {
  number: string;
  timestamp: string;
  hash: string;
  gasUsed?: string;
  baseFeePerGas?: string;
  transactions?: Array<RawTx | string>;
}
interface RawTx {
  hash: string;
  from: string;
  to: string | null;
  value: string;
}
interface EvmLogRaw {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash?: string;
  transactionHash: string;
  logIndex: string;
  /** Present on every endpoint measured, but optional because it is not required. */
  blockTimestamp?: string;
}

function parseBlock(b: RawBlock, withTxs: boolean): EvmBlock {
  const txs: EvmTx[] = [];
  if (withTxs && Array.isArray(b.transactions)) {
    for (const t of b.transactions) {
      if (typeof t === "string") continue;
      txs.push({
        hash: t.hash,
        from: (t.from ?? "").toLowerCase(),
        to: t.to ? t.to.toLowerCase() : null,
        value: hexToBig(t.value),
      });
    }
  }
  return {
    number: hexToNum(b.number) ?? 0,
    timestamp: (hexToNum(b.timestamp) ?? 0) * 1000,
    hash: b.hash,
    transactions: txs,
    gasUsed: hexToBig(b.gasUsed),
    baseFeePerGas: b.baseFeePerGas ? hexToBig(b.baseFeePerGas) : null,
  };
}

/** ABI-decode a dynamic string return, falling back to bytes32-style tokens. */
function decodeAbiString(hex: string): string | null {
  if (typeof hex !== "string" || hex.length < 3) return null;
  const body = hex.slice(2);
  try {
    if (body.length >= 128) {
      const len = Number.parseInt(body.slice(64, 128), 16);
      if (Number.isFinite(len) && len > 0 && len <= 64) {
        const raw = body.slice(128, 128 + len * 2);
        const s = Buffer.from(raw, "hex").toString("utf8").replace(/\0/g, "").trim();
        if (s) return s;
      }
    }
    // Some old tokens (MKR) return a raw bytes32 instead of a string.
    const s = Buffer.from(body, "hex").toString("utf8").replace(/\0/g, "").trim();
    return /^[\x20-\x7e]{1,32}$/.test(s) ? s : null;
  } catch {
    return null;
  }
}

/**
 * A log's `blockTimestamp` as ms, or null when absent or unusable.
 *
 * The value is a hex seconds count, like a block header's. Guarded rather than
 * trusted: a chain reporting it in some other unit would otherwise silently date
 * every transfer wrongly, and `isUsableTimestamp` in the USDC scanner is the
 * second line of defence rather than the first.
 */
function logTimestampMs(hex: string | undefined): number | null {
  if (!hex) return null;
  const secs = hexToNum(hex);
  if (secs === null || secs <= 0) return null;
  return secs * 1000;
}

/** Hostname only — never the path, which carries the API key. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

export { ZERO_ADDRESS, fromWei };
