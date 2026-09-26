// Turning a transaction into measurements.
//
// Everything here is computed from the transaction itself plus, optionally,
// the confirmation height of the transactions that funded it. Nothing is
// inferred about who owns anything: the outputs of this file are structural
// facts ("83 inputs, one address, 1.02 sat/vB"), and the interpretation of
// them lives in score.ts and classify.ts where it can be argued with.
//
// The worked example throughout is the Liquid Network peg-out of 2026-09-06,
// which is kept as a fixture and used as a test. Fetched from chain:
//
//   4,019.44 BTC, 83 inputs -> 13 outputs, every input spending one address,
//   34,097 sats of fee on 33,576 vbytes = 1.02 sat/vB, block 965783.
//
// A $317M transfer paying the floor fee rate while emptying a single address
// across 83 inputs. Each of those clauses is a feature below, and none of them
// requires knowing that the address belonged to a sidechain federation.

import { normalisedEntropy } from "./stats.js";

/** Anything with fewer satoshis than this is uneconomic to ever spend. */
export const DUST_SATS = 546;

/** An input is "dormant" once it has sat unspent for this long. */
export const DORMANT_DAYS = 365;

/** nSequence at or above this disables replaceability signalling (BIP125). */
export const RBF_SEQUENCE_CEILING = 0xfffffffe;

export interface TxInput {
  txid?: string;
  vout?: number;
  is_coinbase?: boolean;
  sequence?: number;
  prevout: { value: number; scriptpubkey_address?: string } | null;
}

export interface TxOutput {
  value: number;
  scriptpubkey_address?: string;
  scriptpubkey_type?: string;
}

export interface RawTx {
  txid: string;
  vin: TxInput[];
  vout: TxOutput[];
  fee?: number;
  size?: number;
  weight?: number;
  status?: { confirmed: boolean; block_height?: number; block_time?: number };
}

/** When each funding transaction confirmed, for coin-age maths. */
export type AgeLookup = (txid: string) => { blockTime: number } | null | undefined;

export interface TxFeatures {
  txid: string;
  computedAt: number;
  valueSats: number;
  inputSats: number;
  feeSats: number | null;
  vsize: number | null;
  feeRate: number | null;
  nIn: number;
  nOut: number;

  /** Distinct addresses funding the transaction. */
  inputAddresses: number;
  /** Share of input value coming from the single busiest address. */
  topInputAddrFrac: number | null;
  /** The address that funded most of it, when there is one. */
  topInputAddr: string | null;
  topOutputAddr: string | null;
  topOutFrac: number | null;

  /** Satoshi-days destroyed. Null when no input age could be resolved. */
  coinDays: number | null;
  meanAgeDays: number | null;
  oldestAgeDays: number | null;
  /** Share of input VALUE untouched for over a year. */
  dormantFrac: number | null;
  /** How many inputs had an age. A partial answer must not read as a whole one. */
  inputsAged: number;

  outEntropy: number | null;
  dustOuts: number;
  /** Inputs signalling BIP125 replaceability. Zero extra requests: it is nSequence. */
  rbfSignalled: number;

  /**
   * Value moved per satoshi of fee.
   *
   * The single sharpest signal in the Liquid transaction: 4,019 BTC moved for
   * 34,097 sats, a ratio of 1.18e7. Ordinary large transfers pay a fee that
   * scales with urgency, not with value — but a ratio this extreme means
   * somebody moved a fortune at the cheapest possible rate, which is either
   * carelessness or an automated process that never priced the transfer.
   */
  valuePerFeeSat: number | null;
}

/** Measure a transaction. Pure — no network, no database. */
export function extractFeatures(tx: RawTx, ageOf?: AgeLookup, now = Date.now()): TxFeatures {
  const nowSec = now / 1000;

  let valueSats = 0;
  let topOutSats = 0;
  let topOutputAddr: string | null = null;
  let dustOuts = 0;
  const outValues: number[] = [];
  for (const o of tx.vout) {
    const v = Number(o.value) || 0;
    valueSats += v;
    outValues.push(v);
    if (v > 0 && v < DUST_SATS) dustOuts += 1;
    if (v > topOutSats) {
      topOutSats = v;
      topOutputAddr = o.scriptpubkey_address ?? null;
    }
  }

  let inputSats = 0;
  let rbfSignalled = 0;
  let coinDays: number | null = null;
  let agedValue = 0;
  let dormantValue = 0;
  let oldestAgeDays: number | null = null;
  let inputsAged = 0;
  const byAddress = new Map<string, number>();

  for (const i of tx.vin) {
    if (i.is_coinbase) continue;
    const v = Number(i.prevout?.value) || 0;
    inputSats += v;
    if (typeof i.sequence === "number" && i.sequence < RBF_SEQUENCE_CEILING) rbfSignalled += 1;

    const addr = i.prevout?.scriptpubkey_address;
    if (addr) byAddress.set(addr, (byAddress.get(addr) ?? 0) + v);

    // Coin age, when the funding transaction's confirmation time is known.
    const funded = i.txid ? ageOf?.(i.txid) : null;
    if (funded && Number.isFinite(funded.blockTime) && v > 0) {
      const ageDays = Math.max(0, (nowSec - funded.blockTime) / 86_400);
      coinDays = (coinDays ?? 0) + (v / 1e8) * ageDays;
      agedValue += v;
      if (ageDays >= DORMANT_DAYS) dormantValue += v;
      if (oldestAgeDays === null || ageDays > oldestAgeDays) oldestAgeDays = ageDays;
      inputsAged += 1;
    }
  }

  let topInputAddr: string | null = null;
  let topInputSats = 0;
  for (const [addr, v] of byAddress) {
    if (v > topInputSats) {
      topInputSats = v;
      topInputAddr = addr;
    }
  }

  const feeSats = Number.isFinite(tx.fee) ? (tx.fee as number) : null;
  // vsize from weight is exact for segwit and correct for legacy too, where
  // weight is defined as 4x the base size.
  const vsize = Number.isFinite(tx.weight) ? Math.ceil((tx.weight as number) / 4) : (tx.size ?? null);

  return {
    txid: tx.txid,
    computedAt: now,
    valueSats,
    inputSats,
    feeSats,
    vsize,
    feeRate: feeSats !== null && vsize ? feeSats / vsize : null,
    nIn: tx.vin.length,
    nOut: tx.vout.length,
    inputAddresses: byAddress.size,
    topInputAddrFrac: inputSats > 0 ? topInputSats / inputSats : null,
    topInputAddr,
    topOutputAddr,
    topOutFrac: valueSats > 0 ? topOutSats / valueSats : null,
    coinDays,
    // Value-weighted, and weighted only by the value whose age is KNOWN —
    // dividing by total input value would silently treat unresolved inputs as
    // brand new and drag every average toward zero.
    meanAgeDays: coinDays !== null && agedValue > 0 ? (coinDays * 1e8) / agedValue : null,
    oldestAgeDays,
    dormantFrac: agedValue > 0 ? dormantValue / agedValue : null,
    inputsAged,
    outEntropy: normalisedEntropy(outValues),
    dustOuts,
    rbfSignalled,
    valuePerFeeSat: feeSats && feeSats > 0 ? valueSats / feeSats : null,
  };
}

/** Fraction of inputs whose age was resolved — how much to trust age features. */
export function ageCoverage(f: TxFeatures): number {
  const spendable = Math.max(1, f.nIn);
  return f.inputsAged / spendable;
}
