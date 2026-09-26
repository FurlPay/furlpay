// Finding large Bitcoin transactions.
//
// Two scanners, and the difference between them is the most important thing in
// this module:
//
//   walkBlock()    enumerates EVERY transaction in a block. Measured on block
//                  966016: 4,552 transactions, 183 requests, 52s, zero 429s
//                  against blockstream.info, 28 transactions at or above 50
//                  BTC. The whale set it returns is COMPLETE — a count from it
//                  is a real count.
//
//   sampleMempool() reads /mempool/recent, which exposes only the ten most
//                  recent entries. Measured at a 2s poll: 8 of 29 polls came
//                  back with ten entirely new txids, meaning the window had
//                  already overflowed and transactions had been missed. So
//                  this is a SAMPLE. It is fast — it sees a whale before it
//                  confirms — and it is incomplete, and both halves of that
//                  are permanent properties of the endpoint, not bugs to fix.
//
// Nothing in this file ever adds the two together. `discovery` travels with
// every row so the digest can report them apart.

import type { BitcoinClient } from "./client.js";
import type { BlockScan, BtcWhaleTx } from "./types.js";
import { makeLogger } from "../util/logger.js";

const log = makeLogger("btc-whales");

export const SATS_PER_BTC = 100_000_000;

/** Esplora's transaction shape, restricted to the fields used here. */
export interface EsploraTx {
  txid: string;
  vin: Array<{
    is_coinbase?: boolean;
    prevout: { value: number; scriptpubkey_address?: string } | null;
  }>;
  vout: Array<{ value: number; scriptpubkey_address?: string }>;
  size: number;
  weight: number;
  fee: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

interface EsploraBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
}

/** /mempool/recent's much thinner shape — no addresses, no inputs, no outputs. */
interface RecentTx {
  txid: string;
  fee: number;
  vsize: number;
  value: number;
}

export interface ScanOptions {
  /**
   * Minimum output total for the WHALE DIGEST, in satoshis.
   *
   * This is a PRESENTATION threshold and nothing more. It decides which
   * transactions appear in the human-facing "largest movements" list, where
   * ranking by size is what a reader expects.
   *
   * It is NOT an intelligence gate. Behavioural analysis is admitted by
   * `onTriage` below, which uses percentiles and address history rather than an
   * absolute quantity of bitcoin — because a value gate here is what made the
   * whole engine blind to a small anomaly, no matter how sharply it scored.
   */
  minSats: number;
  /** BTC/USD used to price a find. Null when no price was readable. */
  priceUsd: number | null;
  /** OFAC-listed addresses. Screening costs nothing extra during a walk. */
  sanctioned: ReadonlySet<string>;
  /** Requests to spend before abandoning a block; a partial walk is recorded as partial. */
  maxRequests?: number;
  /**
   * Called for EVERY transaction walked, whale or not.
   *
   * This is what feeds the statistical baselines, and it has to see the whole
   * block. Sampling only the whales would compute a median over transactions
   * already filtered to 50 BTC and above — around 80 BTC — against which every
   * whale then measures as unremarkable.
   */
  onSample?: (tx: { valueSats: number; feeRate: number | null; nIn: number; nOut: number }) => void;
  /**
   * Called with the RAW transaction for each whale found.
   *
   * The returned `BtcWhaleTx` is a summary — counts and a top address — which
   * is all the digest needs but not enough to build a behavioural profile.
   * Profiles need every input and output address, so they are fed from here
   * rather than by re-fetching transactions the walk already had in hand.
   */
  onWhaleTx?: (tx: EsploraTx) => void;
  /**
   * Called for every NON-COINBASE transaction, whatever its size.
   *
   * This is the intelligence path. It is separate from `onWhaleTx` on purpose:
   * the whale list is a presentation concern ranked by value, while this is the
   * analytical stream and must not be filtered by value at all.
   */
  onTriage?: (tx: EsploraTx) => void;
  signal?: AbortSignal;
}

/* ------------------------------------------------------------------ */
/* Block enumeration — complete                                        */
/* ------------------------------------------------------------------ */

/**
 * Walk every transaction in one block.
 *
 * Esplora pages block transactions 25 at a time from a start index, so the cost
 * is ceil(tx_count / 25) requests. The coinbase transaction is skipped: it
 * "pays" the subsidy plus fees to the miner and would otherwise show up as a
 * 3-BTC whale in every single block, which is noise, not a movement of money.
 */
export async function walkBlock(
  client: BitcoinClient,
  hash: string,
  opts: ScanOptions,
): Promise<{ scan: BlockScan; whales: BtcWhaleTx[] }> {
  const started = Date.now();
  const { data: block } = await client.fetchJson<EsploraBlock>("esplora", `/block/${hash}`);
  const cap = opts.maxRequests ?? Math.ceil(block.tx_count / 25) + 4;

  const whales: BtcWhaleTx[] = [];
  let walked = 0;
  let requests = 1;
  let index = 0;
  let complete = false;

  while (walked < block.tx_count && requests < cap) {
    if (opts.signal?.aborted) break;
    let page: EsploraTx[];
    try {
      const res = await client.fetchJson<EsploraTx[]>("esplora", `/block/${hash}/txs/${index}`);
      page = res.data;
      requests += 1;
    } catch (err) {
      log.warn("block page failed", {
        height: block.height,
        index,
        err: (err as Error).message.slice(0, 160),
      });
      break;
    }
    if (!page.length) {
      // Esplora returns an empty page past the end. Reaching it means every
      // transaction the block claims to hold was actually seen.
      complete = true;
      break;
    }
    for (const tx of page) {
      walked += 1;
      if (opts.onSample && !tx.vin.some((v) => v.is_coinbase)) {
        // The coinbase is excluded from the population too: it exists in every
        // block, always pays no fee, and would drag the fee-rate median toward
        // zero once per block for no informational gain.
        const vsize = Number.isFinite(tx.weight) ? Math.ceil(tx.weight / 4) : null;
        opts.onSample({
          valueSats: tx.vout.reduce((s, o) => s + (Number(o.value) || 0), 0),
          feeRate: vsize && Number.isFinite(tx.fee) ? tx.fee / vsize : null,
          nIn: tx.vin.length,
          nOut: tx.vout.length,
        });
      }
      // The analytical stream sees everything; the whale list sees the tail.
      if (opts.onTriage && !tx.vin.some((v) => v.is_coinbase)) opts.onTriage(tx);

      const w = classify(tx, opts, block);
      if (w) {
        whales.push(w);
        opts.onWhaleTx?.(tx);
      }
    }
    index += page.length;
  }
  if (walked >= block.tx_count) complete = true;

  const scan: BlockScan = {
    height: block.height,
    hash: block.id,
    blockTime: block.timestamp,
    txCount: block.tx_count,
    txsWalked: walked,
    whalesFound: whales.length,
    requests,
    durationMs: Date.now() - started,
    complete,
    scannedAt: Date.now(),
  };

  log.info("block walked", {
    height: block.height,
    txs: `${walked}/${block.tx_count}`,
    whales: whales.length,
    requests,
    ms: scan.durationMs,
    complete,
  });
  return { scan, whales };
}

/**
 * Turn one Esplora transaction into a whale record, or null when it is not one.
 *
 * "Value" is the sum of outputs, which is what block explorers display. Note
 * what that figure is NOT: it is not the amount that changed hands. A wallet
 * consolidating its own coins produces a large output total while nothing moved
 * between parties, so `selfSpend` records when the largest output pays an
 * address that also funded the inputs, and the embeds label those rather than
 * presenting them as transfers.
 */
export function classify(
  tx: EsploraTx,
  opts: ScanOptions,
  block?: { height: number; timestamp: number },
): BtcWhaleTx | null {
  // The coinbase mints the block subsidy. It is issuance, not a transfer.
  if (tx.vin.some((v) => v.is_coinbase)) return null;

  let valueSats = 0;
  let topOutAddr: string | null = null;
  let topOutSats = 0;
  for (const o of tx.vout) {
    const v = Number(o.value) || 0;
    valueSats += v;
    if (v > topOutSats) {
      topOutSats = v;
      topOutAddr = o.scriptpubkey_address ?? null;
    }
  }
  if (valueSats < opts.minSats) return null;

  let topInAddr: string | null = null;
  let topInSats = 0;
  const inputAddrs = new Set<string>();
  for (const i of tx.vin) {
    const p = i.prevout;
    if (!p) continue;
    const v = Number(p.value) || 0;
    if (p.scriptpubkey_address) inputAddrs.add(p.scriptpubkey_address);
    if (v > topInSats) {
      topInSats = v;
      topInAddr = p.scriptpubkey_address ?? null;
    }
  }

  // Screening is a set lookup over addresses already in hand — no extra request.
  let sanctionedAddr: string | null = null;
  if (opts.sanctioned.size) {
    for (const a of inputAddrs) {
      if (opts.sanctioned.has(a)) { sanctionedAddr = a; break; }
    }
    if (!sanctionedAddr) {
      for (const o of tx.vout) {
        const a = o.scriptpubkey_address;
        if (a && opts.sanctioned.has(a)) { sanctionedAddr = a; break; }
      }
    }
  }

  const btc = valueSats / SATS_PER_BTC;
  const height = tx.status?.block_height ?? block?.height ?? null;
  const blockTime = tx.status?.block_time ?? block?.timestamp ?? null;

  return {
    txid: tx.txid,
    // A confirmed transaction is dated by its block, not by when we happened
    // to look at it — otherwise a catch-up run would stamp yesterday's whales
    // with today's timestamp and the 24h digest would count them twice over.
    firstSeen: blockTime ? blockTime * 1000 : Date.now(),
    valueSats,
    feeSats: Number.isFinite(tx.fee) ? tx.fee : null,
    vsize: Number.isFinite(tx.weight) ? Math.ceil(tx.weight / 4) : null,
    nIn: tx.vin.length,
    nOut: tx.vout.length,
    topInAddr,
    topInSats: topInSats || null,
    topOutAddr,
    topOutSats: topOutSats || null,
    selfSpend: Boolean(topOutAddr && inputAddrs.has(topOutAddr)),
    blockHeight: height,
    blockTime,
    priceUsd: opts.priceUsd,
    valueUsd: opts.priceUsd === null ? null : btc * opts.priceUsd,
    discovery: "block",
    sanctioned: sanctionedAddr !== null,
    sanctionedAddr,
  };
}

/* ------------------------------------------------------------------ */
/* Mempool sampling — fast, and incomplete                             */
/* ------------------------------------------------------------------ */

/**
 * Read the ten most recent mempool entries and keep the large ones.
 *
 * /mempool/recent carries value, fee and vsize but NO addresses and no
 * input/output breakdown, so a hit here cannot be screened against the
 * sanctions list and cannot be told apart from a self-spend. Those fields stay
 * null until the transaction confirms and the block walk fills them in, which
 * is exactly what `btcWhales.upsert` is built to do.
 */
export async function sampleMempool(
  client: BitcoinClient,
  opts: ScanOptions,
): Promise<{ whales: BtcWhaleTx[]; seen: number; host: string }> {
  const { data, host } = await client.fetchJson<RecentTx[]>("esplora", "/mempool/recent");
  const list = Array.isArray(data) ? data : [];
  const now = Date.now();
  const whales: BtcWhaleTx[] = [];

  for (const t of list) {
    const valueSats = Number(t.value) || 0;
    if (valueSats < opts.minSats) continue;
    const btc = valueSats / SATS_PER_BTC;
    whales.push({
      txid: t.txid,
      firstSeen: now,
      valueSats,
      feeSats: Number.isFinite(t.fee) ? t.fee : null,
      vsize: Number.isFinite(t.vsize) ? t.vsize : null,
      nIn: null,
      nOut: null,
      topInAddr: null,
      topInSats: null,
      topOutAddr: null,
      topOutSats: null,
      selfSpend: false,
      blockHeight: null,
      blockTime: null,
      priceUsd: opts.priceUsd,
      valueUsd: opts.priceUsd === null ? null : btc * opts.priceUsd,
      discovery: "mempool",
      // Cannot be screened: this endpoint returns no addresses at all.
      sanctioned: false,
      sanctionedAddr: null,
    });
  }
  return { whales, seen: list.length, host };
}

/* ------------------------------------------------------------------ */
/* Block discovery                                                     */
/* ------------------------------------------------------------------ */

/**
 * Hashes of blocks after `afterHeight`, oldest first, at most `limit`.
 *
 * `/blocks/:startHeight` returns the ten blocks ending at that height, so
 * catching up after downtime walks backwards in pages of ten and then reverses
 * — a gap is filled oldest-first so a crash mid-catch-up leaves a contiguous
 * scanned range rather than islands.
 */
export async function blocksSince(
  client: BitcoinClient,
  afterHeight: number | null,
  limit: number,
): Promise<Array<{ height: number; hash: string; timestamp: number; txCount: number }>> {
  const { data: tipRaw } = await client.fetchText("esplora", "/blocks/tip/height");
  const tip = Number(tipRaw);
  if (!Number.isFinite(tip)) throw new Error(`tip height was not a number: ${tipRaw.slice(0, 40)}`);

  const from = afterHeight === null ? tip : afterHeight + 1;
  if (from > tip) return [];

  const wanted: Array<{ height: number; hash: string; timestamp: number; txCount: number }> = [];
  let cursor = tip;
  while (cursor >= from && wanted.length < limit) {
    const { data: page } = await client.fetchJson<EsploraBlock[]>("esplora", `/blocks/${cursor}`);
    if (!page.length) break;
    for (const b of page) {
      if (b.height >= from && b.height <= tip && wanted.length < limit) {
        wanted.push({ height: b.height, hash: b.id, timestamp: b.timestamp, txCount: b.tx_count });
      }
    }
    const lowest = Math.min(...page.map((b) => b.height));
    if (!Number.isFinite(lowest) || lowest <= 0) break;
    cursor = lowest - 1;
  }
  // Oldest first.
  return wanted.sort((a, b) => a.height - b.height);
}

/** Satoshis → "2,437.5709 BTC". */
export function btcStr(sats: number): string {
  const btc = sats / SATS_PER_BTC;
  return `${btc.toLocaleString("en-US", {
    minimumFractionDigits: btc >= 1000 ? 2 : 4,
    maximumFractionDigits: btc >= 1000 ? 2 : 4,
  })} BTC`;
}
