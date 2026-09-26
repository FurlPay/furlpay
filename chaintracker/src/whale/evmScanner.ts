// EVM whale scanner.
//
// Strategy, and the budget reasoning behind it:
//
//   * Token transfers come from ONE `eth_getLogs` call covering the whole block
//     range since the last scan, filtered to the seeded token contracts. One
//     call per chain per tick regardless of how many blocks passed, which is
//     what makes 30-second scanning affordable on a free tier.
//   * Native transfers need full block bodies, which is far more expensive, so
//     they are opt-in per chain (`scanNativeTransfers`) and default to Ethereum
//     only.
//   * The cursor is persisted, so a restart resumes instead of re-alerting, and
//     the UNIQUE(chain,tx,log_index) index makes an overlapping window harmless.
//
// Anything that cannot be priced is dropped, never valued at zero.

import { cursors, wallets, whales } from "../db/index.js";
import { evm } from "../providers/index.js";
import { fromWei, ZERO_ADDRESS } from "../providers/base.js";
import { tokensForChain, type TokenSeed } from "../labels/seed.js";
import { classifyEvent, minThresholdFor, tierFor } from "./classify.js";
import { valueSync, value as valueAsync, isStablecoinSymbol } from "./pricing.js";
import { makeLogger } from "../util/logger.js";
import type { AddressCategory, ChainRow, WhaleEvent } from "../types/index.js";

const log = makeLogger("whale:evm");

/** Never pull more than this many blocks in one tick, however far behind. */
const MAX_BLOCK_SPAN = 2_000;
/**
 * eth_getLogs is priced per call, but the RESPONSE grows with the range, and an
 * oversized response is what actually breaks a free endpoint. Chunk wide ranges.
 */
const LOGS_CHUNK_BLOCKS = 500;
/**
 * Cold-start look-back. Kept modest on purpose: providers cap eth_getLogs at
 * ten blocks on the free tier, so every extra block of history costs another
 * call, and public fallbacks refuse archive reads beyond the recent window
 * anyway. Roughly the last few minutes of a chain is what is actually
 * retrievable for free.
 */
const BACKFILL_BLOCKS_MAX = 240;
/** Full-body block fetches are expensive; cap them hard. */
const MAX_NATIVE_BLOCKS = 8;

export interface ScanResult {
  chainSlug: string;
  fromBlock: number;
  toBlock: number;
  logsScanned: number;
  eventsFound: number;
  eventsNew: number;
  dropped: { unpriced: number; belowThreshold: number };
  error: string | null;
}

export async function scanEvmChain(chain: ChainRow): Promise<ScanResult> {
  const result: ScanResult = {
    chainSlug: chain.slug,
    fromBlock: 0,
    toBlock: 0,
    logsScanned: 0,
    eventsFound: 0,
    eventsNew: 0,
    dropped: { unpriced: 0, belowThreshold: 0 },
    error: null,
  };

  let head: number;
  try {
    head = await evm.blockNumber(chain);
  } catch (err) {
    result.error = (err as Error).message.slice(0, 160);
    return result;
  }

  const cursor = cursors.get(chain.slug, "whale");
  // On a cold start there is no cursor, and scanning only the head block would
  // make the first report look empty even on a busy chain. Reach back roughly
  // an hour of blocks instead — bounded, so a slow chain does not turn this
  // into an unbounded historical crawl.
  const backfillBlocks = cursor.lastBlock ? 0 : BACKFILL_BLOCKS_MAX;
  const from = cursor.lastBlock ? cursor.lastBlock + 1 : Math.max(1, head - backfillBlocks);
  if (from > head) {
    result.fromBlock = from;
    result.toBlock = head;
    return result;
  }
  const start = Math.max(from, head - MAX_BLOCK_SPAN);
  result.fromBlock = start;
  result.toBlock = head;

  const threshold = minThresholdFor(chain);
  const tokens = tokensForChain(chain.slug);
  const events: WhaleEvent[] = [];

  /* --- Token transfers ------------------------------------------- */
  if (tokens.length) {
    try {
      const tokenAddrs = tokens.map((t) => t.address);
      const transfers: Awaited<ReturnType<typeof evm.transferLogs>> = [];
      for (let lo = start; lo <= head; lo += LOGS_CHUNK_BLOCKS) {
        const hi = Math.min(head, lo + LOGS_CHUNK_BLOCKS - 1);
        transfers.push(...(await evm.transferLogs(chain, lo, hi, tokenAddrs)));
      }
      result.logsScanned = transfers.length;
      const byAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));
      // A log carries no timestamp, so "when" would otherwise default to
      // now — which is wrong the moment a scan covers more than one block or
      // resumes after downtime. Read the real header times for the blocks the
      // logs actually landed in.
      const blockTimes = await blockTimestamps(
        chain,
        [...new Set(transfers.map((t) => t.blockNumber))],
      );

      for (const t of transfers) {
        const meta = byAddress.get(t.tokenAddress);
        if (!meta) continue;
        const amount = fromWei(t.rawValue, meta.decimals);
        if (!Number.isFinite(amount) || amount <= 0) continue;

        const v = valueSync(amount, meta.symbol, meta.coingeckoId);
        if (!v) {
          result.dropped.unpriced += 1;
          continue;
        }
        if (v.amountUsd < threshold) {
          result.dropped.belowThreshold += 1;
          continue;
        }
        events.push(
          buildEvent(chain, {
            txHash: t.txHash,
            logIndex: t.logIndex,
            blockNumber: t.blockNumber,
            symbol: meta.symbol,
            tokenAddress: t.tokenAddress,
            amount,
            valuation: v,
            from: t.from,
            to: t.to,
            isNative: false,
            isStablecoin: meta.isStablecoin,
            timestamp: blockTimes.get(t.blockNumber),
          }),
        );
      }
    } catch (err) {
      result.error = `logs: ${(err as Error).message.slice(0, 140)}`;
    }
  }

  /* --- Native transfers ------------------------------------------ */
  if (chain.scanNativeTransfers) {
    const nativeFrom = Math.max(start, head - MAX_NATIVE_BLOCKS + 1);
    try {
      const blocks = await evm.getBlocks(chain, nativeFrom, head, true);
      const nativeSymbol = chain.nativeToken;
      for (const b of blocks) {
        for (const tx of b.transactions) {
          if (tx.value <= 0n) continue;
          const amount = fromWei(tx.value, chain.nativeDecimals);
          const v = valueSync(amount, nativeSymbol, nativeCoingeckoId(chain));
          if (!v) {
            result.dropped.unpriced += 1;
            continue;
          }
          if (v.amountUsd < threshold) {
            result.dropped.belowThreshold += 1;
            continue;
          }
          events.push(
            buildEvent(chain, {
              txHash: tx.hash,
              // -1 marks "the transaction's own value leg", distinct from any
              // log index, so a native and a token transfer in one tx coexist.
              logIndex: -1,
              blockNumber: b.number,
              symbol: nativeSymbol,
              tokenAddress: null,
              amount,
              valuation: v,
              from: tx.from,
              to: tx.to ?? ZERO_ADDRESS,
              isNative: true,
              isStablecoin: false,
              timestamp: b.timestamp,
            }),
          );
        }
      }
    } catch (err) {
      result.error = (result.error ? result.error + "; " : "") + `blocks: ${(err as Error).message.slice(0, 100)}`;
    }
  }

  /* --- Persist ---------------------------------------------------- */
  result.eventsFound = events.length;
  for (const e of events) {
    if (whales.insert(e)) {
      result.eventsNew += 1;
      wallets.touch(chain.slug, e.fromAddress, e.timestamp);
      wallets.touch(chain.slug, e.toAddress, e.timestamp);
    }
  }

  // Only advance the cursor if the scan actually completed, otherwise a
  // transient RPC failure would silently skip a range forever.
  if (!result.error) cursors.set(chain.slug, "whale", head);

  if (result.eventsNew || result.error) {
    log.info("scan", {
      chain: chain.slug,
      blocks: `${start}-${head}`,
      logs: result.logsScanned,
      new: result.eventsNew,
      unpriced: result.dropped.unpriced,
      err: result.error ?? undefined,
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */

interface EventInput {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  symbol: string;
  tokenAddress: string | null;
  amount: number;
  valuation: { priceUsd: number; amountUsd: number; confidence: number };
  from: string;
  to: string;
  isNative: boolean;
  isStablecoin: boolean;
  timestamp?: number | undefined;
}

/**
 * Real header timestamps for a set of block numbers, in one batched call.
 * Capped because a long catch-up window must not turn into a huge batch; any
 * block beyond the cap keeps a null timestamp and falls back to scan time.
 */
const MAX_TIMESTAMP_LOOKUPS = 40;

async function blockTimestamps(
  chain: ChainRow,
  blockNumbers: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!blockNumbers.length) return out;
  const wanted = blockNumbers.slice(0, MAX_TIMESTAMP_LOOKUPS).sort((a, b) => a - b);
  try {
    const blocks = await evm.getBlocks(chain, wanted[0]!, wanted[wanted.length - 1]!, false);
    for (const b of blocks) if (b.timestamp > 0) out.set(b.number, b.timestamp);
  } catch {
    // Non-fatal: the event still records, it just carries the scan time.
  }
  return out;
}

function buildEvent(chain: ChainRow, i: EventInput): WhaleEvent {
  const fromW = wallets.get(chain.slug, i.from);
  const toW = wallets.get(chain.slug, i.to);
  const fromCategory: AddressCategory = fromW?.category ?? "unknown";
  const toCategory: AddressCategory = toW?.category ?? "unknown";

  return {
    chainSlug: chain.slug,
    txHash: i.txHash,
    logIndex: i.logIndex,
    blockNumber: i.blockNumber,
    timestamp: i.timestamp ?? Date.now(),
    tokenSymbol: i.symbol,
    tokenAddress: i.tokenAddress,
    amount: i.amount,
    amountUsd: i.valuation.amountUsd,
    priceUsd: i.valuation.priceUsd,
    fromAddress: i.from,
    toAddress: i.to,
    fromLabel: fromW?.label ?? null,
    toLabel: toW?.label ?? null,
    fromCategory,
    toCategory,
    eventType: classifyEvent(
      fromCategory,
      toCategory,
      i.isNative,
      i.isStablecoin || isStablecoinSymbol(i.symbol),
    ),
    tier: tierFor(i.valuation.amountUsd),
    confidence: i.valuation.confidence,
    source: evm.usingAlchemy(chain) ? "alchemy" : "public-rpc",
    explorerUrl: `${chain.explorerUrl.replace(/\/$/, "")}/tx/${i.txHash}`,
  };
}

/** CoinGecko id for a chain's gas asset — needed to price native transfers. */
function nativeCoingeckoId(chain: ChainRow): string | null {
  // A chain's own token id is only right when the gas asset IS that token.
  if (chain.symbol && chain.nativeToken === chain.symbol) return chain.coingeckoId;
  const GAS_IDS: Record<string, string> = {
    ETH: "ethereum",
    BNB: "binancecoin",
    POL: "matic-network",
    AVAX: "avalanche-2",
    xDAI: "dai",
    CELO: "celo",
    MNT: "mantle",
    HYPE: "hyperliquid",
  };
  return GAS_IDS[chain.nativeToken] ?? null;
}

export { MAX_BLOCK_SPAN, type TokenSeed };
export { valueAsync };
