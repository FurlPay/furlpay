// The missing link: one call that turns a transaction into an assessment.
//
// THE BUG THIS FIXES, and it is the largest one in the project.
//
// Every piece of the intelligence engine existed and was tested — feature
// extraction, address profiles, live baselines, fourteen behavioural
// detectors, noisy-OR combination, risk and confidence as separate axes. None
// of it was CALLED. The live pipeline ran
//
//     transaction -> triage -> address profile -> baselines -> stop
//
// building history every block and then discarding it, while the Discord alert
// path decided what to post with `valueSats >= alertMinSats`. So the deployed
// behaviour was still a whale bot: an engine that could prove a 4 BTC drain
// scores like a 4,000 BTC one, wired to an alert rule that only ever saw the
// 4,000.
//
// This module is the join. It assembles every input the detectors need,
// including the ones that require a lookup, and returns a single assessment
// the alert path can act on. Nothing here decides policy — it measures, and
// `run.ts` decides what is worth posting.
//
// COST. Everything except `balanceOf` is a memory or SQLite read. The balance
// lookup is a network call, so it is optional and injected: the caller spends
// it only on transactions that already look interesting, which keeps the
// expensive question ("what share of this address's balance just left?") off
// the hot path.

import { extractFeatures, type RawTx, type AgeLookup } from "./features.js";
import { classify, shapeLabel, type Classification } from "./classify.js";
import {
  detectPatterns, assess, type Assessment, type AddressProfile, type PatternHit,
} from "./patterns.js";
import { profileFor, countNovelDestinations } from "./addressProfile.js";
import { loadBaselines, sortedValues, sampleOf } from "./baselines.js";
import { parseMessages, messageAnomaly, type OnChainMessage } from "./messageParser.js";
import { indexWatchlist, loadWatchlist, detectDrain, matchFlagged, type DrainFinding } from "./reserves.js";
import type { Baseline } from "./stats.js";

/** Everything known about one transaction after analysis. */
export interface Analysis {
  txid: string;
  /** 0..1 — how abnormal the behaviour is. */
  risk: number;
  /** 0..1 — how much evidence backs that. Independent of risk, always. */
  confidence: number;
  severity: Severity;
  patterns: PatternHit[];
  reasons: string[];
  classification: Classification;
  shape: string;
  features: ReturnType<typeof extractFeatures>;
  /** Null when this address has never been observed — not an empty profile. */
  profile: AddressProfile | null;
  messages: OnChainMessage[];
  /** A watched reserve losing a share of its balance, when one applies. */
  drain: DrainFinding | null;
  /** An address on the transaction matched a watchlist. */
  flagged: { label: string; side: "input" | "output" } | null;
  /** Which inputs were available, so a reader can weigh the conclusion. */
  coverage: {
    hasProfile: boolean;
    hasBaselines: boolean;
    hasBalance: boolean;
    ageResolved: number;
  };
}

/**
 * Severity bands.
 *
 * Derived from risk AND confidence together, because acting on either alone is
 * wrong in a different direction. High risk with no evidence is a lead, not a
 * finding; high confidence in ordinary behaviour is not news.
 *
 * The two categorical overrides sit above the arithmetic: a watchlist match and
 * a majority drain of a watched reserve are findings in their own right, and
 * they do not become less serious because the rest of the transaction looked
 * unremarkable.
 */
export type Severity = "INFO" | "WATCH" | "SUSPICIOUS" | "HIGH" | "CRITICAL";

export function severityOf(
  risk: number,
  confidence: number,
  opts: { flagged?: boolean; drainFraction?: number | null } = {},
): Severity {
  if (opts.flagged) return "CRITICAL";
  if (opts.drainFraction !== null && opts.drainFraction !== undefined) {
    if (opts.drainFraction >= 0.5) return "CRITICAL";
    if (opts.drainFraction >= 0.2) return "HIGH";
  }
  // Risk sets the ceiling; confidence decides how far up it we are willing to
  // go. A 0.95 risk on a single observation lands at SUSPICIOUS, not CRITICAL.
  const weighted = risk * (0.55 + 0.45 * confidence);
  if (weighted >= 0.75) return "HIGH";
  if (weighted >= 0.5) return "SUSPICIOUS";
  if (weighted >= 0.3) return "WATCH";
  return "INFO";
}

export interface AnalyseContext {
  now?: number;
  /** Post-spend balance of an address, when the caller can afford the lookup. */
  balanceOf?: (address: string) => number | null;
  /** Confirmation times of funding transactions, for coin age. */
  ageOf?: AgeLookup;
  /** Flow position, when this transaction belongs to a tracked chain. */
  flow?: { hops: number; forwardRatio: number | null; forwardDelayMs: number | null } | null;
  /** Pre-loaded baselines, so a block-sized batch loads them once. */
  baselines?: LoadedBaselines;
}

export interface LoadedBaselines {
  value: Baseline | null;
  feeRate: Baseline | null;
  nIn: Baseline | null;
  nOut: Baseline | null;
  sortedValues: readonly number[];
}

/**
 * Load the chain-relative baselines once.
 *
 * Called per BLOCK, not per transaction: `sortedValues()` reads and sorts up to
 * 12,000 samples, which is fine once and ruinous seven thousand times.
 */
export function loadAnalysisBaselines(): LoadedBaselines {
  const b = loadBaselines();
  return {
    value: b.value,
    feeRate: b.feeRate,
    nIn: b.nIn,
    nOut: b.nOut,
    sortedValues: sortedValues(),
  };
}

/** Sorted count samples, for the exceedance tests inside triage. */
export function loadSortedCounts(): { nIn: number[]; nOut: number[]; feeRate: number[] } {
  return {
    nIn: sampleOf("nIn").sort((a, b) => a - b),
    nOut: sampleOf("nOut").sort((a, b) => a - b),
    feeRate: sampleOf("feeRate").sort((a, b) => a - b),
  };
}

/**
 * Analyse one transaction.
 *
 * Pure with respect to the network — every lookup it performs is either a
 * SQLite read or supplied by the caller. Safe to run over a whole block.
 */
export function analyse(tx: RawTx, ctx: AnalyseContext = {}): Analysis {
  const now = ctx.now ?? Date.now();
  const features = extractFeatures(tx, ctx.ageOf, now);
  const classification = classify(features);
  const baselines = ctx.baselines ?? loadAnalysisBaselines();

  // Sender history. Null when never observed, which the detectors read as
  // "unknown" and answer with lower confidence — never as "ordinary".
  const profile = features.topInputAddr ? profileFor(features.topInputAddr) : null;

  // Destination novelty, measured against who this address has paid before.
  const destinations = tx.vout
    .map((o) => o.scriptpubkey_address)
    .filter((a): a is string => Boolean(a));
  const novelty = features.topInputAddr
    ? countNovelDestinations(features.topInputAddr, destinations)
    : { novel: 0, total: 0 };

  // Watchlists. Re-read each call, but the loader caches on file mtime so this
  // is a map lookup after the first.
  const list = loadWatchlist();
  const index = indexWatchlist(list);
  const flaggedHit = matchFlagged(features, tx, index);

  let drain: DrainFinding | null = null;
  let balanceBefore: number | null = null;
  if (ctx.balanceOf) {
    const found = detectDrain(tx, index, ctx.balanceOf);
    drain = found[0] ?? null;
    if (features.topInputAddr) {
      const after = ctx.balanceOf(features.topInputAddr);
      if (after !== null) {
        // Pre-spend balance is what remains plus what left. Reading the
        // post-spend figure as the pre-spend one turns a 95% drain into 2,040%.
        let spent = 0;
        for (const v of tx.vin) {
          if (v.prevout?.scriptpubkey_address === features.topInputAddr) {
            spent += Number(v.prevout.value) || 0;
          }
        }
        balanceBefore = after + spent;
      }
    }
  }

  // Message layer. Structural only — novelty and burst, never content.
  const messages = parseMessages(
    tx.vout as Array<{ scriptpubkey_asm?: string; scriptpubkey_type?: string }>,
  );
  let message: { novelty: number; burst: number; confidence: number; linksAddressInTx: boolean } | null = null;
  if (messages.length) {
    const m = messages[0]!;
    const paid = new Set(destinations);
    const a = messageAnomaly({
      seenBefore: 0,
      publisherHistory: profile?.observations ?? 0,
      recentFromPublisher: messages.length,
      medianPerPublisher: null,
    });
    message = {
      ...a,
      linksAddressInTx: m.embeddedAddresses.some((addr) => paid.has(addr)),
    };
  }

  const patterns = detectPatterns({
    tx,
    features,
    now,
    senderProfile: profile,
    balanceBefore,
    valueBaseline: baselines.value,
    feeRateBaseline: baselines.feeRate,
    nInBaseline: baselines.nIn,
    nOutBaseline: baselines.nOut,
    novelDestinations: novelty.novel,
    totalDestinations: novelty.total,
    forwardRatio: ctx.flow?.forwardRatio ?? null,
    forwardDelayMs: ctx.flow?.forwardDelayMs ?? null,
    flowHops: ctx.flow?.hops,
    message,
  });

  const a: Assessment = assess(patterns);

  return {
    txid: features.txid,
    risk: a.risk,
    confidence: a.confidence,
    severity: severityOf(a.risk, a.confidence, {
      flagged: Boolean(flaggedHit),
      drainFraction: drain?.fractionOfBalance ?? null,
    }),
    patterns: a.patterns,
    reasons: a.reasons,
    classification,
    shape: shapeLabel(classification),
    features,
    profile,
    messages,
    drain,
    flagged: flaggedHit ? { label: flaggedHit.entry.label, side: flaggedHit.side } : null,
    coverage: {
      hasProfile: profile !== null && profile.observations > 0,
      hasBaselines: baselines.value !== null,
      hasBalance: balanceBefore !== null,
      ageResolved: features.inputsAged,
    },
  };
}

/**
 * Is this worth a Discord message?
 *
 * The replacement for `valueSats >= alertMinSats`, and the whole point of the
 * exercise: nothing here reads an amount. A 0.2 BTC transaction that drains a
 * dormant wallet to an unseen destination clears this; a routine 4,000 BTC
 * exchange payout does not.
 *
 * `minRisk` and `minConfidence` are OPERATIONAL knobs — how much noise the
 * channel tolerates — not detection thresholds. The detection already happened.
 */
export function isAlertWorthy(
  a: Analysis,
  opts: { minRisk?: number; minConfidence?: number } = {},
): boolean {
  // Categorical findings always post, whatever the arithmetic says.
  if (a.flagged) return true;
  if (a.drain && a.drain.fractionOfBalance >= a.drain.entry.alertFraction) return true;

  const minRisk = opts.minRisk ?? 0.75;
  const minConfidence = opts.minConfidence ?? 0.35;
  return a.risk >= minRisk && a.confidence >= minConfidence;
}

/** Rank for the digest: severity first, then evidence-weighted risk. */
export function rankOf(a: Analysis): number {
  const bands: Record<Severity, number> = {
    CRITICAL: 5, HIGH: 4, SUSPICIOUS: 3, WATCH: 2, INFO: 1,
  };
  return bands[a.severity] * 1000 + a.risk * a.confidence * 100;
}
