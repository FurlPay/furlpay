// Staged triage: deciding what deserves how much analysis.
//
// THE BUG THIS EXISTS TO FIX. Ingestion used to gate on absolute value —
// anything under 50 BTC was discarded before any analysis ran. The behavioural
// engine could prove a 4 BTC drain scores identically to a 4,000 BTC one, and a
// test asserts exactly that, but a 4 BTC drain never arrived. The system was
// therefore a large-transaction detector wearing a behavioural engine, and no
// amount of work on the engine could change that.
//
// The fix is not a smaller number. Replacing 50 with 1 keeps the same mistake
// and merely moves the blind spot. What follows instead is a cost ladder, where
// every gate is either adaptive or free:
//
//   STAGE 0  every transaction. Cheap arithmetic on fields already in hand,
//            no database, no network. Feeds the baselines, so the population
//            statistics describe the whole chain rather than its tail.
//
//   STAGE 1  transactions that trip at least one cheap signal. Every gate is a
//            PERCENTILE against the live distribution, not a constant, so what
//            counts as unusual moves with the chain. On a real block this
//            admits a few percent of traffic.
//
//   STAGE 2  behavioural analysis against address history. Costs a database
//            read per address, which is why Stage 1 exists.
//
//   STAGE 3  graph expansion, flows, cross-chain. Reserved for transactions
//            that already carry evidence.
//
// A transaction reaches Stage 1 on ANY of the signals below. Value is one of
// them — a genuinely enormous transaction should be looked at — but it is one
// of nine, and eight of the nine are indifferent to size. That is the property
// that lets a 0.2 BTC dormancy break through a gate that a routine 80 BTC
// exchange payout does not trip.

import type { Baseline } from "./stats.js";
import { exceedanceFraction, percentileOf } from "./stats.js";

export type Stage = 0 | 1 | 2 | 3;

/** Cheap features — computed from the transaction alone, no lookups. */
export interface CheapFeatures {
  txid: string;
  valueSats: number;
  nIn: number;
  nOut: number;
  feeSats: number | null;
  vsize: number | null;
  feeRate: number | null;
  /** Distinct addresses funding it. */
  inputAddresses: number;
  /** Largest single input address, when there is one. */
  topInputAddr: string | null;
  /** Every address the transaction pays. */
  outputAddrs: string[];
  /** Outputs below the dust limit. */
  dustOuts: number;
  /** Inputs signalling BIP125 replaceability — free, it is nSequence. */
  rbfSignalled: number;
  /** Largest output as a share of total value. */
  topOutFrac: number | null;
  isCoinbase: boolean;
}

export interface TriageResult {
  stage: Stage;
  /** Which cheap signals fired, in plain language. */
  reasons: string[];
  cheap: CheapFeatures;
}

/** The live distributions Stage 1 measures against. All may be absent. */
export interface TriageBaselines {
  value?: Baseline | null;
  feeRate?: Baseline | null;
  nIn?: Baseline | null;
  nOut?: Baseline | null;
  /** Sorted recent values, for percentile ranking. */
  sortedValues?: readonly number[];
  /**
   * Sorted recent input and output counts.
   *
   * Needed because these distributions are DISCRETE and heavily concentrated:
   * measured live, 99% of Bitcoin transactions have exactly one input, so the
   * 99th-percentile VALUE is 1 and a naive `nIn > p99` test admits everything
   * with two or more inputs — 63% of a real block. Ranking the observation
   * inside the sample answers the intended question ("what share of traffic is
   * at or below this?") and stays correct however concentrated the data is.
   */
  sortedNIn?: readonly number[];
  sortedNOut?: readonly number[];
  /** Sorted recent fee rates — same discrete-tail hazard as the counts. */
  sortedFeeRate?: readonly number[];
}

export interface TriageConfig {
  /**
   * Percentile above which a transaction is admitted on size alone.
   *
   * An OPERATIONAL limit, not a detection rule: it caps how much traffic
   * reaches Stage 2, and it is expressed against the live distribution so it
   * means the same thing on a quiet day and a busy one. Nothing about it
   * encodes "large equals suspicious" — it encodes "we cannot afford to run
   * history lookups on every transaction, so start with the tail".
   */
  valuePercentile: number;
  /** Structural percentile above which shape alone admits a transaction. */
  structurePercentile: number;
  /** Fee-rate percentiles outside which a transaction is admitted. */
  feeLowPercentile: number;
  feeHighPercentile: number;
  /** Risk from Stage 2 above which Stage 3 runs. */
  stage3Risk: number;
  /**
   * Cap on Stage-2 admissions per block.
   *
   * A safety valve against a pathological block, not a filter. Measured cost is
   * ~1ms per admitted transaction, so a whole 5,500-transaction block costs
   * about 5.5s against a 600s block interval — the cap only has to stop an
   * unbounded stall, not keep the work small.
   */
  maxStage2PerBlock: number;
}

export const DEFAULT_TRIAGE: TriageConfig = {
  valuePercentile: 99,
  structurePercentile: 99,
  feeLowPercentile: 2,
  feeHighPercentile: 98,
  stage3Risk: 0.5,
  maxStage2PerBlock: 6000,
};

export function triageConfigFromEnv(): TriageConfig {
  const num = (k: string, d: number): number => {
    const v = process.env[k]?.trim();
    if (!v) return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    valuePercentile: num("BTC_TRIAGE_VALUE_PCT", DEFAULT_TRIAGE.valuePercentile),
    structurePercentile: num("BTC_TRIAGE_STRUCTURE_PCT", DEFAULT_TRIAGE.structurePercentile),
    feeLowPercentile: num("BTC_TRIAGE_FEE_LOW_PCT", DEFAULT_TRIAGE.feeLowPercentile),
    feeHighPercentile: num("BTC_TRIAGE_FEE_HIGH_PCT", DEFAULT_TRIAGE.feeHighPercentile),
    stage3Risk: num("BTC_TRIAGE_STAGE3_RISK", DEFAULT_TRIAGE.stage3Risk),
    maxStage2PerBlock: num("BTC_TRIAGE_MAX_STAGE2", DEFAULT_TRIAGE.maxStage2PerBlock),
  };
}

export const DUST_SATS = 546;
const RBF_CEILING = 0xfffffffe;

/** Minimal shape triage needs — a subset of what Esplora returns. */
export interface TriageTx {
  txid: string;
  vin: Array<{
    is_coinbase?: boolean;
    sequence?: number;
    prevout: { value: number; scriptpubkey_address?: string } | null;
  }>;
  vout: Array<{ value: number; scriptpubkey_address?: string }>;
  fee?: number;
  weight?: number;
}

/**
 * Stage 0: cheap features for every transaction.
 *
 * One pass over inputs and outputs. No allocation beyond the address list, no
 * database, no network — this runs 7,000+ times per block and has to stay
 * proportional to the transaction's own size.
 */
export function cheapFeatures(tx: TriageTx): CheapFeatures {
  let valueSats = 0;
  let topOutSats = 0;
  let dustOuts = 0;
  const outputAddrs: string[] = [];
  for (const o of tx.vout) {
    const v = Number(o.value) || 0;
    valueSats += v;
    if (v > topOutSats) topOutSats = v;
    if (v > 0 && v < DUST_SATS) dustOuts += 1;
    if (o.scriptpubkey_address) outputAddrs.push(o.scriptpubkey_address);
  }

  let rbfSignalled = 0;
  let isCoinbase = false;
  let topInSats = 0;
  let topInputAddr: string | null = null;
  const inputAddrs = new Set<string>();
  for (const i of tx.vin) {
    if (i.is_coinbase) { isCoinbase = true; continue; }
    if (typeof i.sequence === "number" && i.sequence < RBF_CEILING) rbfSignalled += 1;
    const a = i.prevout?.scriptpubkey_address;
    if (a) {
      inputAddrs.add(a);
      const v = Number(i.prevout?.value) || 0;
      if (v > topInSats) { topInSats = v; topInputAddr = a; }
    }
  }

  const vsize = Number.isFinite(tx.weight) ? Math.ceil((tx.weight as number) / 4) : null;
  const feeSats = Number.isFinite(tx.fee) ? (tx.fee as number) : null;

  return {
    txid: tx.txid,
    valueSats,
    nIn: tx.vin.length,
    nOut: tx.vout.length,
    feeSats,
    vsize,
    feeRate: feeSats !== null && vsize ? feeSats / vsize : null,
    inputAddresses: inputAddrs.size,
    topInputAddr,
    outputAddrs,
    dustOuts,
    rbfSignalled,
    topOutFrac: valueSats > 0 ? topOutSats / valueSats : null,
    isCoinbase,
  };
}

/**
 * Stage 1: does this transaction deserve a history lookup?
 *
 * `knownAddress` answers "have we ever profiled this address" and is expected
 * to be a set built ONCE PER BLOCK by a batched query — asking the database
 * per transaction would reintroduce the cost Stage 1 exists to avoid.
 *
 * Note what is deliberately absent: any absolute quantity of bitcoin. Every
 * threshold is a percentile of what this chain is doing now, so the same code
 * behaves sensibly whether the median transaction is 0.001 BTC or 10.
 */
export function stage1(
  c: CheapFeatures,
  base: TriageBaselines,
  cfg: TriageConfig = DEFAULT_TRIAGE,
  knownAddress?: (addr: string) => boolean,
): { admit: boolean; reasons: string[] } {
  // Signals are STRONG or WEAK, and the distinction came from measurement.
  //
  // Run against real block 966049 (6,402 transactions), an earlier version that
  // admitted on any single signal took 42.9% of the block — useless as a
  // filter. The breakdown showed why: dust outputs alone fired 1,997 times and
  // fee-rate extremes 637 more. Dust is a BASE RATE on Bitcoin, not an
  // anomaly; inscriptions, batching and exchange change all produce it
  // routinely, and the fee distribution has fat tails by nature.
  //
  // So a common signal no longer admits on its own. It must co-occur with
  // another, which is the ordinary evidentiary rule that one unremarkable
  // observation is not a finding while two together might be.
  const strong: string[] = [];
  const weak: string[] = [];
  const tailShare = (100 - cfg.structurePercentile) / 100;

  // The coinbase is issuance, not a transfer. It appears in every block and
  // would occupy a Stage-2 slot 144 times a day for no information.
  if (c.isCoinbase) return { admit: false, reasons: [] };

  /* ---------------- strong: rare enough to stand alone ---------------- */

  // 1. Size, as a percentile of the live distribution — never a fixed amount.
  if (base.sortedValues?.length) {
    const ex = exceedanceFraction(c.valueSats, base.sortedValues);
    if (ex !== null && ex < (100 - cfg.valuePercentile) / 100) {
      const p = percentileOf(c.valueSats, base.sortedValues);
      strong.push(`value at the ${(p ?? 0).toFixed(1)}th percentile of recent traffic`);
    }
  }

  // 2 & 3. Structure, likewise by percentile rather than by a fixed count.
  // Ranked inside the sample, not compared against a percentile value — see
  // the note on `sortedNIn`. On a discrete, concentrated distribution the
  // difference is 63% of a block versus a fraction of one.
  if (base.sortedNIn?.length) {
    const ex = exceedanceFraction(c.nIn, base.sortedNIn);
    // Strictly above the median as well, so the mode of a concentrated
    // distribution can never qualify however thin its upper tail is.
    if (ex !== null && ex < tailShare && base.nIn && c.nIn > base.nIn.median) {
      strong.push(`${c.nIn} inputs — only ${(ex * 100).toFixed(2)}% of traffic has more`);
    }
  }
  if (base.sortedNOut?.length) {
    const ex = exceedanceFraction(c.nOut, base.sortedNOut);
    if (ex !== null && ex < tailShare && base.nOut && c.nOut > base.nOut.median) {
      strong.push(`${c.nOut} outputs — only ${(ex * 100).toFixed(2)}% of traffic has more`);
    }
  }

  // 4. THE GATE THAT MAKES SMALL TRANSACTIONS VISIBLE. An address we have
  //    profiled is one we can say something about, at any value. This is how a
  //    0.2 BTC movement from a wallet with six years of history gets analysed
  //    while a routine 80 BTC exchange payout does not.
  // History makes an address ANALYSABLE, and that is the whole question Stage 1
  // is asking: could Stage 2 possibly say anything about this transaction?
  //
  // This gate fires on roughly a third of a block once the profile store has
  // warmed up, and that was briefly mistaken for a leak. It is not. Stage 2
  // costs ~1ms per transaction (measured: 400 in 404ms), so even admitting
  // 3,500 of a 5,500-transaction block spends ~3.5s against a 600s block
  // interval. The expensive thing to avoid is a profile lookup that can only
  // ever return null; a lookup that returns real history is the work paying off.
  //
  // Demoting this to a weak signal was tried and broke the case the whole
  // redesign exists for: a 0.01 BTC movement from a dormant wallet is
  // structurally ordinary, so it has no companion signal to pair with. Spending
  // a millisecond on it is exactly right.
  if (knownAddress) {
    if (c.topInputAddr && knownAddress(c.topInputAddr)) {
      strong.push("spends from an address with recorded history");
    } else if (c.outputAddrs.some(knownAddress)) {
      weak.push("pays an address with recorded history");
    }
  }

  // 5. A sweep: several inputs in, nothing kept. Size-independent and rare.
  if (c.nOut === 1 && c.nIn >= 3) {
    strong.push(`${c.nIn} inputs swept into a single output with no change`);
  }

  /* ---------------- weak: common, so they need company ---------------- */

  // 6. Fee rate at either extreme. Measured at 637 hits in one block, so this
  //    describes the tails of an ordinary distribution rather than an anomaly.
  // By exceedance, for the same reason as the structural gates. The fee
  // distribution is extremely tight around the floor — measured median 0.314
  // sat/vB against a p95 of 0.345 — so "above p95" caught 1,865 transactions in
  // one block. Asking how much of the chain pays MORE is stable whether the
  // distribution is tight or wide.
  if (c.feeRate !== null && base.sortedFeeRate?.length && base.feeRate) {
    const ex = exceedanceFraction(c.feeRate, base.sortedFeeRate);
    if (ex !== null && ex < tailShare && c.feeRate > base.feeRate.median) {
      weak.push(`fee rate ${c.feeRate.toFixed(1)} sat/vB — only ${(ex * 100).toFixed(2)}% of traffic pays more`);
    } else if (ex !== null && ex > 1 - tailShare && c.feeRate < base.feeRate.median) {
      weak.push(`fee rate ${c.feeRate.toFixed(2)} sat/vB — ${(ex * 100).toFixed(1)}% of traffic pays more`);
    }
  }

  // 7. Dust. A single dust output is unremarkable — 1,997 transactions in one
  //    measured block had one. A HANDFUL of them is a different shape, so the
  //    count is what carries information, not the presence.
  if (c.dustOuts >= 3) {
    strong.push(`${c.dustOuts} outputs below the dust limit`);
  } else if (c.dustOuts > 0) {
    weak.push(`${c.dustOuts} output${c.dustOuts === 1 ? "" : "s"} below the dust limit`);
  }

  // 8. Value concentrated in one output across many inputs.
  if (c.topOutFrac !== null && c.topOutFrac > 0.99 && c.nIn >= 5) {
    weak.push(`${c.nIn} inputs collapse into one output holding ${(c.topOutFrac * 100).toFixed(1)}% of value`);
  }

  // 9. Replaceability with an unusual input count. RBF alone is far too common
  //    to admit — most of the chain signals it.
  // RBF paired with a genuinely unusual input count. The earlier form compared
  // against `p99 / 2`, and with a discrete p99 of 1 that reduced to "has at
  // least one input" — it fired on 2,724 of 5,501 transactions.
  if (c.rbfSignalled > 0 && base.sortedNIn?.length) {
    const ex = exceedanceFraction(c.nIn, base.sortedNIn);
    if (ex !== null && ex < tailShare * 5) {
      weak.push(`signals replaceability with ${c.nIn} inputs, an unusual count`);
    }
  }

  const reasons = [...strong, ...weak];
  return { admit: strong.length > 0 || weak.length >= 2, reasons };
}

/**
 * Triage one transaction.
 *
 * Returns the stage it earned. Stage 0 means measured and unremarkable — which
 * is a finding, not a discard: it still fed the baselines that make the next
 * transaction's percentile meaningful.
 */
export function triage(
  tx: TriageTx,
  base: TriageBaselines,
  cfg: TriageConfig = DEFAULT_TRIAGE,
  knownAddress?: (addr: string) => boolean,
): TriageResult {
  const cheap = cheapFeatures(tx);
  const { admit, reasons } = stage1(cheap, base, cfg, knownAddress);
  return { stage: admit ? 1 : 0, reasons, cheap };
}

/**
 * Every address a transaction touches — the batch-lookup key set.
 *
 * Collected across a whole block and resolved in one query, because the
 * alternative is one database round trip per transaction and that is precisely
 * the cost the staging exists to avoid.
 */
export function addressesOf(c: CheapFeatures): string[] {
  const out = c.topInputAddr ? [c.topInputAddr] : [];
  return [...new Set([...out, ...c.outputAddrs])];
}

/** Counters for one block's pass, reported so the ladder stays observable. */
export interface TriageStats {
  seen: number;
  stage0: number;
  stage1: number;
  stage2: number;
  stage3: number;
  /** Reasons that admitted transactions, by frequency. */
  byReason: Record<string, number>;
}

export function newTriageStats(): TriageStats {
  return { seen: 0, stage0: 0, stage1: 0, stage2: 0, stage3: 0, byReason: {} };
}

export function recordTriage(stats: TriageStats, r: TriageResult): void {
  stats.seen += 1;
  if (r.stage === 0) { stats.stage0 += 1; return; }
  stats.stage1 += 1;
  for (const reason of r.reasons) {
    // Bucket by the leading phrase so the counter stays readable rather than
    // accumulating one key per distinct number.
    const key = reason.replace(/[\d.,]+/g, "N").slice(0, 60);
    stats.byReason[key] = (stats.byReason[key] ?? 0) + 1;
  }
}
