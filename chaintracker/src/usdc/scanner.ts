// EVM native-USDC scanner.
//
// This is the file that makes the tracker real. Everything else in src/usdc was
// able to classify, format and store a transfer; nothing produced one. The
// `doctor` command said so in as many words: "no realtime provider is
// configured". Now every row in `usdc_transfers` comes from an eth_getLogs call
// against a verified contract, and there is no path in this module that can
// write a row from anything else.
//
// WHY CHAIN-WIDE eth_getLogs RATHER THAN ADDRESS WEBHOOKS. Alchemy's Address
// Activity webhook is the better tool for a known address set — it is push, it is
// cheap, and it is what the FurlPay-wallet path should eventually use. It is the
// wrong tool for whale discovery: it only reports addresses you already
// subscribed, so a previously unknown whale is invisible to it by construction.
// A filter on (USDC contract, Transfer topic) over a block range sees every
// native USDC movement on the chain, which is what "discover unknown whales"
// actually requires. The two approaches are complementary, and this is the one
// the intelligence channel needs.
//
// WHAT IS DELIBERATELY NOT DONE HERE:
//
//   * Nothing is priced by guess. USDC is a dollar stablecoin, so amountUsd is
//     the token amount — but that identity is asserted once, in usdValue(), with
//     a depeg guard, rather than being spread implicitly through the file.
//   * A log's timestamp is never "now". eth_getLogs returns no time, and using
//     scan time is wrong the moment a scan covers more than one block or resumes
//     after downtime. Real block header times are read; a transfer whose time
//     cannot be established is dropped rather than dated wrongly.
//   * The cursor only advances on a clean scan. A partial scan that advanced the
//     cursor would skip that range permanently and nothing would ever say so.

import { cursors } from "../db/index.js";
import { usdcDb } from "../db/usdc.js";
import { evm } from "../providers/index.js";
import { env } from "../config/env.js";
import { makeLogger } from "../util/logger.js";
import { getEvmScanAssets, getUsdcAsset, isNativeUsdc, TOPIC_ERC20_TRANSFER } from "./registry.js";
import { classifyUsdcTransfer, isUsdcWhale } from "./classify.js";
import { resolveEntity } from "./entities.js";
import { recordScanRun } from "./scanRuns.js";
import { recordBlocks, recordCoverage } from "./blocks.js";
import { handleReorg } from "./finality.js";
import type { UsdcAsset, UsdcTransfer } from "./types.js";
import type { ChainRow } from "../types/index.js";

const log = makeLogger("usdc:scan");

/** The scanner name under which cursors are keyed, alongside "whale". */
export const SCANNER = "usdc";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Hard ceiling on blocks per chain per tick.
 *
 * A chain that has been unreachable for hours must not try to catch up in one
 * call — it would blow the log budget and starve every other chain in the same
 * tick. Falling behind and saying so beats a scan that never completes.
 */
const MAX_BLOCK_SPAN = 2_000;

/** eth_getLogs is priced per call but fails on response SIZE. Chunk wide spans. */
const LOGS_CHUNK_BLOCKS = 400;

/**
 * Block headers fetched per batched RPC call when reading timestamps.
 *
 * This is a CHUNK SIZE, not a ceiling on how far back we will look — the
 * distinction cost real data once already, see blockTimestamps(). A single batch
 * of thousands of eth_getBlockByNumber calls is refused by public endpoints, so
 * the range is walked in batches of this size instead of being truncated.
 */
const MAX_TIMESTAMP_BLOCKS = 60;

/**
 * How far back to look for the leg that fed a transfer.
 *
 * Long enough to catch a real relay chain — the measured $24.4M Coinbase Prime
 * chain moved three hops in under five minutes — and short enough that two
 * genuinely independent transfers of the same size between the same parties are not
 * merged. A flash loan's legs share a transaction and so are always inside it.
 *
 * Exported because the report's caveat quotes it; a window stated in prose that
 * disagrees with the code is worse than no window at all.
 */
export const PASS_THROUGH_WINDOW_MS = 15 * 60 * 1000;

/**
 * USDC trades at a dollar, but "trades at" is not "is". If the peg ever breaks
 * badly, valuing transfers one-for-one would misstate every figure in the daily
 * report, so the assumption is written down and bounded rather than assumed
 * silently. Outside this band a transfer is still recorded; it is the USD
 * valuation that becomes untrustworthy, and `usdValue` says so by returning null.
 */
const USDC_MIN_PRICE = 0.9;
const USDC_MAX_PRICE = 1.1;

export interface UsdcScanResult {
  chainSlug: string;
  fromBlock: number;
  toBlock: number;
  logsSeen: number;
  rowsNew: number;
  dropped: { notNativeUsdc: number; zeroAmount: number; noTimestamp: number };
  /** Transfers recognised as relayed money rather than new movement. */
  passThrough: number;
  /** Transfers invalidated because their block was reorganised away. */
  reorgedTransfers: number;
  /**
   * The block the cursor was actually left at. Lower than `toBlock` when the scan
   * held short of a block it could not date, so the next tick retries it.
   */
  checkpoint: number;
  /**
   * Set when a block was permanently skipped after repeated failures. A real hole
   * in coverage, surfaced rather than inferred.
   */
  skippedBlock: number | null;
  error: string | null;
}

/**
 * The USD value of a USDC amount.
 *
 * A one-line function with a long name because the alternative — writing
 * `amountUsd: amount` at each call site — hides a real assumption in a place
 * nobody would think to check during a depeg.
 */
export function usdValue(amount: number, priceUsd = 1): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (priceUsd < USDC_MIN_PRICE || priceUsd > USDC_MAX_PRICE) return null;
  return amount * priceUsd;
}

/**
 * Is this timestamp usable as the time a transfer happened?
 *
 * WHY THIS IS A SHARED FUNCTION RATHER THAN AN INLINE CHECK. A seconds/
 * milliseconds mix-up in the Solana adapter shipped once and dated every Solana
 * row to the year 58713 — HeliusProvider already multiplies the API's seconds by
 * 1000, so the adapter's own `* 1000` applied it twice. TypeScript cannot catch
 * that (both are `number`), no test caught it, and it produced no error: the rows
 * inserted cleanly and silently fell outside every 24-hour window, so the daily
 * report simply under-counted Solana without saying why.
 *
 * It was found by querying MAX(ts) after a real scan. Having the rule in one place
 * means both adapters enforce the same bound, and the bound is stated rather than
 * assumed.
 *
 * A future timestamp is always wrong — a block cannot be mined after now. The hour
 * of slack absorbs clock skew between us and an RPC node. The lower bound rejects a
 * value that is obviously in seconds rather than milliseconds: USDC launched in
 * 2018, so anything before 2015 in ms terms is a unit error, not old data.
 */
export function isUsableTimestamp(ms: number, now = Date.now()): boolean {
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (ms > now + 60 * 60 * 1000) return false;
  // 2015-01-01 in ms. A seconds-valued timestamp for any plausible date lands far
  // below this, which is exactly the mistake being guarded against.
  return ms >= 1_420_070_400_000;
}

/**
 * A minimal ChainRow for the EVM provider.
 *
 * The USDC registry carries its own endpoints so this tracker covers chains the
 * `chains` table has never heard of — Unichain, Sonic and World Chain are all
 * absent from the chain seed but all carry real native USDC. EvmProvider reads
 * only slug, alchemySubdomain and publicRpc off a ChainRow when routing a call,
 * which is why this projection is sufficient and why it is built here rather
 * than requiring a database row to exist first.
 */
export function chainRowFor(asset: UsdcAsset): ChainRow {
  return {
    slug: asset.chainSlug,
    name: asset.chainName,
    chainType: "evm",
    evmChainId: asset.chainId,
    alchemySubdomain: asset.alchemySubdomain,
    publicRpc: asset.publicRpc,
    explorerUrl: asset.explorerUrl,
    nativeDecimals: 18,
  } as ChainRow;
}

/**
 * Scale a raw uint256 token amount by its decimals.
 *
 * A NOTE ON PRECISION, because the obvious clever version does not work. This was
 * first written as a bigint split — integer part and fractional part scaled
 * separately — on the theory that it stayed exact past 2^53 where a plain double
 * does not. Measured, that theory is false twice over:
 *
 *   * At every realistic USDC magnitude the split and `Number(raw) / 1e6` produce
 *     the IDENTICAL double. They first diverge around 10^21 base units, i.e. a
 *     single transfer of $9 quadrillion.
 *   * The split does not even keep the whole-units part exact, because the final
 *     addition rounds: 999999999999999999999 base units came back as
 *     1000000000000000 from both routes.
 *
 * A double carries 15-16 significant digits. USDC's total supply is around
 * $7 x 10^10, so six decimals of it needs about 17 — meaning the last digit of a
 * supply-sized transfer rounds no matter how this is written, and everything
 * smaller than roughly $90bn is exact to the cent. That is the real guarantee, and
 * the straightforward expression delivers all of it.
 */
export function scaleAmount(raw: bigint, decimals: number): number {
  if (raw <= 0n) return 0;
  return Number(raw) / 10 ** decimals;
}

/**
 * Scan an EXPLICIT block range, without reading or writing the cursor.
 *
 * WHY THIS IS SEPARATE FROM THE CURSOR PATH. A gap backfill needs to re-read a
 * specific range that the cursor has already passed. Driving that through
 * `scanUsdcChain` would require either moving the cursor backwards — which would make
 * the forward scan redo everything after it — or a flag threaded through the whole
 * function. Splitting the "which range" decision from the "read this range" work
 * keeps both honest, and makes the backfill trivially resumable: a range is either
 * read cleanly or it is not, and the queue remembers which.
 *
 * Idempotent: re-reading a range is a no-op for rows already present, because the
 * dedupe key is (chain, tx, logIndex) and the insert is ON CONFLICT DO NOTHING.
 */
export async function scanRange(
  asset: UsdcAsset,
  fromBlock: number,
  toBlock: number
): Promise<UsdcScanResult> {
  const startedAt = Date.now();
  const result: UsdcScanResult = {
    chainSlug: asset.chainSlug,
    fromBlock,
    toBlock,
    logsSeen: 0,
    rowsNew: 0,
    dropped: { notNativeUsdc: 0, zeroAmount: 0, noTimestamp: 0 },
    passThrough: 0,
    reorgedTransfers: 0,
    checkpoint: 0,
    skippedBlock: null,
    error: null,
  };

  if (asset.kind !== "evm") {
    result.error = `${asset.chainSlug} is not an EVM chain`;
    return result;
  }
  if (toBlock < fromBlock) {
    result.error = `empty range ${fromBlock}-${toBlock}`;
    return result;
  }

  const chain = chainRowFor(asset);
  let transfers: Awaited<ReturnType<typeof evm.transferLogs>>;
  try {
    const collected: Awaited<ReturnType<typeof evm.transferLogs>> = [];
    for (let lo = fromBlock; lo <= toBlock; lo += LOGS_CHUNK_BLOCKS) {
      const hi = Math.min(toBlock, lo + LOGS_CHUNK_BLOCKS - 1);
      collected.push(...(await evm.transferLogs(chain, lo, hi, [asset.contractOrMint])));
    }
    transfers = collected;
  } catch (err) {
    result.error = `logs: ${(err as Error).message.slice(0, 140)}`;
    recordScanRun({ ...runMeta(asset, result, startedAt), scanner: "usdc-backfill" });
    return result;
  }

  result.logsSeen = transfers.length;
  const ing = await ingest(asset, transfers, chain);
  result.rowsNew = ing.stored;
  result.dropped = ing.dropped;
  result.passThrough = ing.passThrough;
  result.reorgedTransfers = ing.reorgedTransfers;
  result.checkpoint = toBlock;

  recordScanRun({ ...runMeta(asset, result, startedAt), scanner: "usdc-backfill" });
  log.info("backfilled range", {
    chain: asset.chainSlug,
    blocks: `${fromBlock}-${toBlock}`,
    logs: result.logsSeen,
    new: result.rowsNew,
    undated: result.dropped.noTimestamp || undefined,
  });
  return result;
}

/**
 * Normalise, classify and store a batch of raw transfer logs.
 *
 * Shared by the cursor scan and the range backfill so the two cannot diverge in how
 * they validate, date, classify or dedupe — which would mean a backfilled block
 * carried subtly different data from a live-scanned one.
 */
async function ingest(
  asset: UsdcAsset,
  transfers: Awaited<ReturnType<typeof evm.transferLogs>>,
  chain: ChainRow
): Promise<{
  stored: number;
  dropped: { notNativeUsdc: number; zeroAmount: number; noTimestamp: number };
  passThrough: number;
  lowestUndated: number | null;
  blockTimes: Map<number, number>;
  reorgedTransfers: number;
}> {
  const dropped = { notNativeUsdc: 0, zeroAmount: 0, noTimestamp: 0 };
  let stored = 0;
  let passThroughCount = 0;
  let lowestUndated: number | null = null;

  const blockTimes = new Map<number, number>();
  for (const t of transfers) {
    if (t.blockTimestamp !== null && !blockTimes.has(t.blockNumber)) {
      blockTimes.set(t.blockNumber, t.blockTimestamp);
    }
  }
  const undated = [...new Set(transfers.map((t) => t.blockNumber))].filter(
    (n) => !blockTimes.has(n)
  );
  if (undated.length > 0) {
    for (const [n, ts] of await blockTimestamps(chain, undated)) blockTimes.set(n, ts);
  }

  const source = evm.usingAlchemy(chain) ? "alchemy" : "rpc";

  for (const t of transfers) {
    if (!isNativeUsdc(asset.chainSlug, t.tokenAddress)) {
      dropped.notNativeUsdc += 1;
      continue;
    }
    const amount = scaleAmount(t.rawValue, asset.decimals);
    const amountUsd = usdValue(amount);
    if (amountUsd === null) {
      dropped.zeroAmount += 1;
      continue;
    }
    const ts = blockTimes.get(t.blockNumber);
    if (ts === undefined || !isUsableTimestamp(ts)) {
      dropped.noTimestamp += 1;
      if (lowestUndated === null || t.blockNumber < lowestUndated) lowestUndated = t.blockNumber;
      continue;
    }

    const built = buildTransfer(asset, {
      txHash: t.txHash,
      logIndex: t.logIndex,
      blockNumber: t.blockNumber,
      blockHash: t.blockHash,
      timestamp: ts,
      from: t.from,
      to: t.to,
      amount,
      amountUsd,
      source,
    });

    let passThrough: { kind: "reversal" | "hop"; predecessorId: number } | null = null;
    if (built.amountUsd >= env.usdcPassThroughMinUsd) {
      const prior = usdcDb.precedingLeg(built, PASS_THROUGH_WINDOW_MS);
      if (prior) {
        passThrough = { kind: prior.isReversal ? "reversal" : "hop", predecessorId: prior.id };
        passThroughCount += 1;
      }
    }

    if (usdcDb.insert(built, passThrough)) stored += 1;
  }

  // BLOCK LEDGER — recorded HERE, in the shared path, not in the cursor scan.
  //
  // It was originally written into `scanUsdcChain` only, which meant `scanRange` —
  // the gap-backfill path — stored transfers with a block hash but never recorded
  // their blocks. A backfilled range would then be invisible to the reorg audit,
  // which walks `usdc_blocks`: exactly the ranges most likely to need re-checking
  // would have been the ones never checked. Caught by querying the ledger after a
  // live scanRange and finding it empty.
  const byBlock = new Map<number, { hash: string; ts: number; count: number }>();
  for (const t of transfers) {
    if (!t.blockHash) continue;
    const e = byBlock.get(t.blockNumber);
    if (e) e.count += 1;
    else
      byBlock.set(t.blockNumber, {
        hash: t.blockHash,
        ts: blockTimes.get(t.blockNumber) ?? 0,
        count: 1,
      });
  }

  const { reorged } = recordBlocks(
    [...byBlock.entries()].map(([blockNumber, v]) => ({
      chainSlug: asset.chainSlug,
      blockNumber,
      blockHash: v.hash,
      timestamp: v.ts,
      usdcLogCount: v.count,
    }))
  );

  let reorgedTransfers = 0;
  for (const r of reorged) {
    reorgedTransfers += handleReorg(r.chainSlug, r.blockNumber, r.oldHash).transfersReorged;
  }

  return {
    stored,
    dropped,
    passThrough: passThroughCount,
    lowestUndated,
    blockTimes,
    reorgedTransfers,
  };
}

/**
 * Scan one EVM chain for native USDC transfers since the stored cursor.
 *
 * Every row written here has passed `isNativeUsdc`, carries a real block
 * timestamp, and records which endpoint served it.
 */
export async function scanUsdcChain(asset: UsdcAsset): Promise<UsdcScanResult> {
  const startedAt = Date.now();
  const result: UsdcScanResult = {
    chainSlug: asset.chainSlug,
    fromBlock: 0,
    toBlock: 0,
    logsSeen: 0,
    rowsNew: 0,
    dropped: { notNativeUsdc: 0, zeroAmount: 0, noTimestamp: 0 },
    passThrough: 0,
    reorgedTransfers: 0,
    checkpoint: 0,
    skippedBlock: null,
    error: null,
  };

  if (asset.kind !== "evm") {
    result.error = `${asset.chainSlug} is not an EVM chain — use the Solana adapter`;
    return result;
  }

  const chain = chainRowFor(asset);

  let head: number;
  try {
    head = await evm.blockNumber(chain);
  } catch (err) {
    result.error = (err as Error).message.slice(0, 160);
    recordScanRun({ ...runMeta(asset, result, startedAt) });
    return result;
  }

  const cursor = cursors.get(asset.chainSlug, SCANNER);
  const from = cursor.lastBlock
    ? cursor.lastBlock + 1
    : Math.max(1, head - coldStartBlocks(asset));

  if (from > head) {
    result.fromBlock = from;
    result.toBlock = head;
    return result;
  }

  const start = Math.max(from, head - MAX_BLOCK_SPAN);
  result.fromBlock = start;
  result.toBlock = head;

  // If MAX_BLOCK_SPAN forced a skip, that is a real gap in coverage and has to
  // be visible rather than inferred from a cursor jump.
  if (start > from) {
    log.warn("skipped blocks to stay inside the span cap", {
      chain: asset.chainSlug,
      skipped: start - from,
      requestedFrom: from,
      scanningFrom: start,
    });
  }

  /* --- Read logs -------------------------------------------------- */

  let transfers: Awaited<ReturnType<typeof evm.transferLogs>>;
  try {
    const collected: Awaited<ReturnType<typeof evm.transferLogs>> = [];
    for (let lo = start; lo <= head; lo += LOGS_CHUNK_BLOCKS) {
      const hi = Math.min(head, lo + LOGS_CHUNK_BLOCKS - 1);
      collected.push(...(await evm.transferLogs(chain, lo, hi, [asset.contractOrMint])));
    }
    transfers = collected;
  } catch (err) {
    result.error = `logs: ${(err as Error).message.slice(0, 140)}`;
    recordScanRun({ ...runMeta(asset, result, startedAt) });
    return result;
  }

  result.logsSeen = transfers.length;
  if (transfers.length === 0) {
    // No logs means nothing to date, so the whole range is genuinely complete — and
    // an empty range is still COVERED. Not recording it would leave a permanent
    // false gap for every quiet stretch on a low-traffic chain.
    cursors.set(asset.chainSlug, SCANNER, head, null);
    result.checkpoint = head;
    recordCoverage(asset.chainSlug, start, head);
    recordScanRun({ ...runMeta(asset, result, startedAt) });
    return result;
  }

  /* --- Normalise, classify, persist -------------------------------- */
  //
  // The SAME `ingest` the backfill path uses. Sharing it is the point: a duplicated
  // body meant the block ledger was written by one path and not the other, and the
  // divergence was invisible until the ledger was queried directly.

  const ing = await ingest(asset, transfers, chain);
  result.rowsNew = ing.stored;
  result.dropped = ing.dropped;
  result.passThrough = ing.passThrough;
  result.reorgedTransfers = ing.reorgedTransfers;
  const lowestUndated = ing.lowestUndated;

  /* --- Checkpoint --------------------------------------------------- */
  //
  // THE BUG THIS REPLACES. This line used to be an unconditional
  // `cursors.set(slug, SCANNER, head)`, which contradicted the invariant stated
  // at the top of this file — "the cursor only advances on a clean scan" — and
  // did so in the most damaging way available. A transfer dropped for an
  // unreadable block timestamp had its block stepped over, so it was never
  // rescanned and never appeared in any total. It was not an honest gap; it was
  // an avoidable one, and nothing reported it.
  //
  // Now the cursor stops one block short of the earliest block we could not
  // fully process, so the next tick re-reads it. Re-reading is free: the UNIQUE
  // index on (chain, tx, log_index) makes a repeat insert a no-op.
  result.checkpoint = advanceCursor(asset, start, head, lowestUndated, result);

  // COVERAGE IS CLAIMED ONLY UP TO THE CHECKPOINT. The cursor deliberately holds
  // short of a block whose transfers could not be dated, and claiming coverage to
  // `head` would paper over exactly the hole the checkpoint exists to preserve.
  if (result.checkpoint >= start) {
    recordCoverage(asset.chainSlug, start, result.checkpoint);
  }

  recordScanRun({ ...runMeta(asset, result, startedAt) });

  if (result.rowsNew || result.dropped.noTimestamp) {
    log.info("scanned", {
      chain: asset.chainSlug,
      blocks: `${start}-${head}`,
      logs: result.logsSeen,
      new: result.rowsNew,
      undated: result.dropped.noTimestamp || undefined,
      checkpoint: result.checkpoint,
      endpoint: evm.activeEndpoint(chain),
    });
  }
  return result;
}

/**
 * How many consecutive ticks may stall on the same block before we step over it.
 *
 * The poison-pill problem: if a block is permanently undatable — an endpoint that
 * will never serve that header — refusing to advance stops the chain dead, which
 * is worse than losing the transfers in it. So the stall is bounded, and when the
 * bound is reached the skip is logged at WARN with the block number, because a
 * skipped block is a real hole in coverage and has to be visible rather than
 * inferred.
 */
const MAX_STALLS_BEFORE_SKIP = 5;

/**
 * Advance the cursor no further than the last fully-processed block.
 *
 * Returns the block actually checkpointed, for the log and the scan-run row.
 *
 * Stall state rides in `scan_cursors.last_value`, which already exists as a TEXT
 * column — no migration needed for it. It is reset on every clean scan, so a
 * transient endpoint failure cannot accumulate toward the skip threshold across
 * unrelated ticks.
 */
function advanceCursor(
  asset: UsdcAsset,
  start: number,
  head: number,
  lowestUndated: number | null,
  result: UsdcScanResult,
): number {
  if (lowestUndated === null) {
    // Clean scan: take the whole range and clear any stall.
    cursors.set(asset.chainSlug, SCANNER, head, null);
    return head;
  }

  const prior = cursors.get(asset.chainSlug, SCANNER);
  const stall = parseStall(prior.lastValue);
  const sameBlock = stall !== null && stall.block === lowestUndated;
  const attempts = sameBlock ? stall.attempts + 1 : 1;

  if (attempts >= MAX_STALLS_BEFORE_SKIP) {
    log.warn("skipping a block whose timestamp cannot be read — COVERAGE HOLE", {
      chain: asset.chainSlug,
      block: lowestUndated,
      attempts,
      transfersLost: result.dropped.noTimestamp,
    });
    result.skippedBlock = lowestUndated;
    cursors.set(asset.chainSlug, SCANNER, head, null);
    return head;
  }

  // Stop one short of the problem block. If that is below where we started, the
  // cursor does not move at all and the same range is retried.
  const checkpoint = Math.max(start - 1, lowestUndated - 1);
  cursors.set(
    asset.chainSlug,
    SCANNER,
    checkpoint,
    JSON.stringify({ stallBlock: lowestUndated, attempts }),
  );
  log.debug("cursor held short of an undated block", {
    chain: asset.chainSlug,
    checkpoint,
    stallBlock: lowestUndated,
    attempts,
    willSkipAfter: MAX_STALLS_BEFORE_SKIP,
  });
  return checkpoint;
}

function parseStall(raw: string | null): { block: number; attempts: number } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { stallBlock?: unknown; attempts?: unknown };
    const block = Number(v.stallBlock);
    const attempts = Number(v.attempts);
    if (!Number.isFinite(block) || !Number.isFinite(attempts)) return null;
    return { block, attempts };
  } catch {
    // An unparseable value is treated as no stall. It can only come from an older
    // build, and forgetting it costs one extra retry rather than correctness.
    return null;
  }
}

/**
 * Cold-start look-back, in blocks.
 *
 * Derived from the configured backfill hours and the chain's real block time
 * rather than being a flat constant, because 240 blocks is four minutes on
 * Ethereum and under two minutes on Base. Capped hard: providers refuse archive
 * reads on the free tier past the recent window, so asking for more history than
 * is retrievable just produces failures.
 */
function coldStartBlocks(asset: UsdcAsset): number {
  const hours = Math.max(0, Math.min(env.usdcBackfillHours, 24));
  const perBlockSec = BLOCK_TIME_SEC[asset.chainSlug] ?? 2;
  const wanted = Math.ceil((hours * 3600) / perBlockSec);
  return Math.min(wanted, MAX_BLOCK_SPAN);
}

/**
 * Measured average block times, used only to turn a backfill window in hours
 * into a block count. Approximate by nature — a wrong value here changes how far
 * back a cold start reaches, nothing that is reported as fact.
 */
const BLOCK_TIME_SEC: Record<string, number> = {
  ethereum: 12,
  avalanche: 2,
  optimism: 2,
  arbitrum: 0.25,
  base: 2,
  polygon: 2,
  unichain: 1,
  linea: 2,
  sonic: 1,
  worldchain: 2,
  celo: 5,
  zksync: 1,
};

interface TransferInput {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  /**
   * The hash of the block this log came from.
   *
   * Load-bearing for reorg handling: a transfer is invalidated by matching its block
   * hash, so a row without one cannot be distinguished from its replacement when a
   * block is replayed. Optional only because rows predating migration 0016 have none.
   */
  blockHash?: string | null;
  timestamp: number;
  from: string;
  to: string;
  amount: number;
  amountUsd: number;
  source: string;
}

/**
 * Turn a raw log into a classified transfer.
 *
 * Exported because the Solana adapter and the tests both need the identical
 * entity-resolution and classification path — a second copy would be a second
 * place for the mint/burn or FurlPay rules to drift.
 */
export function buildTransfer(asset: UsdcAsset, i: TransferInput): UsdcTransfer {
  const fromEntity = resolveEntity(asset.chainSlug, i.from);
  const toEntity = resolveEntity(asset.chainSlug, i.to);

  const isMint = i.from === ZERO_ADDRESS;
  const isBurn = i.to === ZERO_ADDRESS;

  // A transfer out of the zero address is Circle issuing USDC and one into it is
  // Circle redeeming it. Both are real and both matter, but neither is a payment
  // and neither is a whale moving funds, so they are classified before the
  // general rules get a chance to call them a WHALE_TRANSFER.
  const classification = isMint
    ? "MINT"
    : isBurn
      ? "BURN"
      : classifyUsdcTransfer(fromEntity, toEntity, i.from, i.to, i.amountUsd);

  return {
    chainSlug: asset.chainSlug,
    tokenAddress: asset.contractOrMint,
    txHash: i.txHash,
    logIndex: i.logIndex,
    blockNumber: i.blockNumber,
    timestamp: i.timestamp,
    fromAddress: i.from,
    toAddress: i.to,
    amount: i.amount,
    amountUsd: i.amountUsd,
    fromLabel: isMint ? "Circle: issuance" : fromEntity.label,
    toLabel: isBurn ? "Circle: redemption" : toEntity.label,
    fromCategory: fromEntity.category,
    toCategory: toEntity.category,
    fromEntity: isMint ? "Circle" : fromEntity.entity,
    toEntity: isBurn ? "Circle" : toEntity.entity,
    classification,
    isWhale: isUsdcWhale(i.amountUsd) && !isMint && !isBurn,
    isExchange: classification === "EXCHANGE_DEPOSIT" || classification === "EXCHANGE_WITHDRAWAL",
    // Set by the CCTP scanner when a burn/mint pair is correlated. A plain
    // Transfer log cannot know it was part of a cross-chain movement, and
    // guessing from the counterparty would mislabel ordinary transfers.
    isCctp: false,
    isFurlPay: fromEntity.isFurlPay || toEntity.isFurlPay,
    cctpNonce: null,
    source: i.source,
    blockHash: i.blockHash ?? null,
    finality: "observed",
    removed: false,
    explorerUrl: `${asset.txUrlPrefix}${i.txHash}`,
    alerted: false,
    createdAt: Date.now(),
  };
}

/**
 * Real header timestamps for blocks whose logs arrived without one.
 *
 * Thin now, deliberately. It used to walk the whole block range in windows and
 * silently lose every block in any window the endpoint refused — which on Arbitrum
 * cost 4,371 real transfers in a single scan. The batching, the retry and the
 * sparse-list handling all belong to the provider, where every caller gets them.
 *
 * Returns whatever it could read. The caller drops transfers whose block is still
 * missing rather than substituting scan time.
 */
async function blockTimestamps(chain: ChainRow, blockNumbers: number[]): Promise<Map<number, number>> {
  if (blockNumbers.length === 0) return new Map();
  return evm.blockTimestampsFor(chain, blockNumbers);
}

function describeDrops(d: UsdcScanResult["dropped"]): string | null {
  const parts: string[] = [];
  if (d.zeroAmount) parts.push(`zero-value=${d.zeroAmount}`);
  if (d.noTimestamp) parts.push(`no-timestamp=${d.noTimestamp}`);
  if (d.notNativeUsdc) parts.push(`not-native-usdc=${d.notNativeUsdc}`);
  return parts.length ? parts.join(" ") : null;
}

function runMeta(asset: UsdcAsset, r: UsdcScanResult, startedAt: number) {
  return {
    chainSlug: asset.chainSlug,
    scanner: SCANNER,
    fromBlock: r.fromBlock,
    toBlock: r.toBlock,
    logsSeen: r.logsSeen,
    rowsNew: r.rowsNew,
    dropped: r.dropped.notNativeUsdc + r.dropped.zeroAmount + r.dropped.noTimestamp,
    droppedDetail: describeDrops(r.dropped),
    endpoint: null as string | null,
    error: r.error,
    startedAt,
    finishedAt: Date.now(),
  };
}

/**
 * Scan every EVM chain the registry says we can read.
 *
 * Sequential on purpose. Running twelve chains concurrently against a shared
 * rate limiter produces timeouts that open the circuit breaker, which costs more
 * coverage than the latency saved — the same reasoning the provider's log
 * bisection already follows.
 */
export async function scanAllEvmChains(
  /**
   * Checked between chains. Returning false stops the sweep — used to renew and
   * verify the tick's lease, so a run that lost it does not keep writing.
   */
  keepAlive: () => boolean = () => true
): Promise<UsdcScanResult[]> {
  const out: UsdcScanResult[] = [];
  for (const asset of getEvmScanAssets()) {
    // Between chains, not mid-chain: a chain's scan is a unit that ends by writing
    // its cursor, and abandoning it halfway would leave the range half-ingested with
    // the cursor unmoved — correct, but it wastes the work.
    if (!keepAlive()) {
      log.warn("stopping the sweep early — lease lost", { after: out.length, of: getEvmScanAssets().length });
      break;
    }
    try {
      out.push(await scanUsdcChain(asset));
    } catch (err) {
      out.push({
        chainSlug: asset.chainSlug,
        fromBlock: 0,
        toBlock: 0,
        logsSeen: 0,
        rowsNew: 0,
        dropped: { notNativeUsdc: 0, zeroAmount: 0, noTimestamp: 0 },
        passThrough: 0,
        reorgedTransfers: 0,
        checkpoint: 0,
        skippedBlock: null,
        error: (err as Error).message.slice(0, 160),
      });
    }
  }
  return out;
}

/**
 * Confirm on chain that a registry entry is what it claims to be.
 *
 * Reads `symbol()` and `decimals()` from the contract. This is the check that
 * would have caught the wrong-contract class of error at source instead of
 * letting it show up as a chain that reports no transfers — and it is why the
 * registry's decimals are verified rather than trusted.
 */
export async function verifyAsset(asset: UsdcAsset): Promise<{
  chainSlug: string;
  ok: boolean;
  symbol: string | null;
  decimals: number | null;
  detail: string;
}> {
  if (asset.kind !== "evm") {
    return {
      chainSlug: asset.chainSlug,
      ok: true,
      symbol: null,
      decimals: null,
      detail: "non-EVM — not checkable this way",
    };
  }
  const chain = chainRowFor(asset);
  try {
    const meta = await evm.tokenMeta(chain, asset.contractOrMint);
    const symbolOk = meta.symbol !== null && /usdc/i.test(meta.symbol);
    const decimalsOk = meta.decimals === asset.decimals;
    return {
      chainSlug: asset.chainSlug,
      ok: symbolOk && decimalsOk,
      symbol: meta.symbol,
      decimals: meta.decimals,
      detail:
        symbolOk && decimalsOk
          ? `${meta.symbol} / ${meta.decimals}dp`
          : `expected USDC/${asset.decimals}dp, chain says ${meta.symbol ?? "?"}/${meta.decimals ?? "?"}dp`,
    };
  } catch (err) {
    return {
      chainSlug: asset.chainSlug,
      ok: false,
      symbol: null,
      decimals: null,
      detail: `unreachable: ${(err as Error).message.slice(0, 80)}`,
    };
  }
}

export { getUsdcAsset, TOPIC_ERC20_TRANSFER, MAX_BLOCK_SPAN, ZERO_ADDRESS };
