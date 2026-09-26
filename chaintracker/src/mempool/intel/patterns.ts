// The pattern engine: generic behavioural primitives.
//
// This file contains NO incident-specific logic and no absolute BTC amounts.
// It cannot recognise the Liquid drain or the Silk Road movement by name,
// size, address or structure. It recognises the behaviours those events
// happened to exhibit, which is the only way a future incident with a
// different shape gets caught.
//
// Two mathematical decisions carry the design:
//
// COMBINATION IS NOISY-OR:  S = 1 - Π(1 - sᵢ)
//
//   Additive scoring lets one saturated component reach the alert threshold on
//   its own, and it treats six weak agreeing signals as worth less than one
//   strong one. Noisy-OR does the opposite, which matches how evidence
//   actually works: six independent observations at 0.5 combine to 0.98, while
//   any single one of them stays at 0.5. Every term is bounded, so nothing can
//   run away.
//
// RISK AND CONFIDENCE ARE SEPARATE AXES.
//
//   The bug this fixes: a component that could not be measured used to score
//   zero, which is the value meaning "measured, and normal". Unknown is not
//   normal. A brand-new address with no history moving everything it has is
//   high risk and low confidence — "this looks wrong, but we do not know this
//   address well enough to be sure" — and collapsing that into one number
//   loses precisely the information an analyst needs.

import type { TxFeatures } from "./features.js";
import type { RawTx } from "./features.js";
import { deviationFrom, robustZ, squash, type Baseline } from "./stats.js";

export type PatternKind =
  | "DORMANCY_BREAK"
  | "BALANCE_DRAIN"
  | "AMOUNT_ANOMALY"
  | "STRUCTURE_ANOMALY"
  | "FAN_IN"
  | "FAN_OUT"
  | "NEAR_TOTAL_FORWARD"
  | "RAPID_FORWARD"
  | "NEW_COUNTERPARTY"
  | "FEE_ANOMALY"
  | "MESSAGE_NOVELTY"
  | "MESSAGE_BURST"
  | "MESSAGE_FUND_LINK"
  | "MULTI_HOP";

export interface PatternHit {
  kind: PatternKind;
  /** How abnormal, 0..1. */
  strength: number;
  /** How well-evidenced, 0..1. Low means "we lack the history to be sure". */
  confidence: number;
  /** The measurement that produced it, in plain language. */
  evidence: string;
}

/**
 * What is known about an address's past behaviour.
 *
 * Every field may be null, and null means "never observed" — which lowers
 * confidence rather than being treated as a zero.
 */
export interface AddressProfile {
  address: string;
  /** Median and MAD of this address's historical spend sizes, in sats. */
  spendBaseline: Baseline | null;
  /** Median and MAD of the gaps between its spends, in ms. */
  gapBaseline: Baseline | null;
  /** Median and MAD of the share of balance it removes per spend. */
  drainBaseline: Baseline | null;
  /** Mean inputs and outputs of its past spends. */
  meanNIn: number | null;
  meanNOut: number | null;
  /** Time of its last observed spend. */
  lastSpendAt: number | null;
  /** Distinct addresses it has paid before. */
  counterparties: number;
  /** How many spends the profile is built from. */
  observations: number;
}

export interface PatternInput {
  tx: RawTx;
  features: TxFeatures;
  now: number;
  /** Profile of the address that funded most of the value, when known. */
  senderProfile?: AddressProfile | null;
  /** Balance of the sender before this transaction, in sats. */
  balanceBefore?: number | null;
  /** Chain-wide baselines. */
  valueBaseline?: Baseline | null;
  feeRateBaseline?: Baseline | null;
  nInBaseline?: Baseline | null;
  nOutBaseline?: Baseline | null;
  /** Destination addresses this sender has never paid before. */
  novelDestinations?: number;
  totalDestinations?: number;
  /** Share of received value this transaction forwards onward. */
  forwardRatio?: number | null;
  /** Milliseconds between receiving the funds and spending them. */
  forwardDelayMs?: number | null;
  /** Typical forward delay observed on the chain, for comparison. */
  forwardDelayBaseline?: Baseline | null;
  /** Hops in the flow this transaction belongs to. */
  flowHops?: number;
  /** Message-layer observations. */
  message?: { novelty: number; burst: number; confidence: number; linksAddressInTx: boolean } | null;
}

/* ------------------------------------------------------------------ */
/* Detectors                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every pattern present in a transaction.
 *
 * Each detector returns null when it has nothing to say, so the absence of a
 * pattern is never confused with a pattern of strength zero.
 */
export function detectPatterns(i: PatternInput): PatternHit[] {
  const hits: PatternHit[] = [];
  const push = (h: PatternHit | null) => { if (h && h.strength > 0.01) hits.push(h); };

  push(dormancyBreak(i));
  push(balanceDrain(i));
  push(amountAnomaly(i));
  push(structureAnomaly(i));
  push(fanIn(i));
  push(fanOut(i));
  push(nearTotalForward(i));
  push(rapidForward(i));
  push(newCounterparty(i));
  push(feeAnomaly(i));
  push(multiHop(i));
  for (const m of messagePatterns(i)) push(m);

  return hits.sort((a, b) => b.strength * b.confidence - a.strength * a.confidence);
}

/**
 * An address active again after a gap that is long FOR THAT ADDRESS.
 *
 * Not "dormant for over a year". A payment processor silent for a week is
 * unusual; a cold wallet silent for a year is not. The comparison is against
 * the address's own distribution of gaps between spends.
 */
export function dormancyBreak(i: PatternInput): PatternHit | null {
  const p = i.senderProfile;
  if (!p?.lastSpendAt) {
    // Fall back to coin age, which needs no address history at all. Weaker
    // evidence, and the confidence says so.
    const age = i.features.meanAgeDays;
    if (age === null || age < 180) return null;
    const strength = clamp01((age / 365 - 0.5) / 5);
    return strength <= 0 ? null : {
      kind: "DORMANCY_BREAK",
      strength,
      confidence: 0.45,
      evidence:
        `inputs averaged ${fmtAge(age)} old; no spending history for this address, ` +
        `so this is coin age rather than address dormancy`,
    };
  }

  const gap = i.now - p.lastSpendAt;
  if (!p.gapBaseline || p.observations < 4) {
    // Known address, too little history to say what "long" means for it.
    const days = gap / 86_400_000;
    const strength = clamp01((days / 365 - 0.5) / 5);
    return strength <= 0 ? null : {
      kind: "DORMANCY_BREAK",
      strength,
      confidence: 0.4,
      evidence: `silent for ${fmtAge(days)}, but only ${p.observations} prior spends to compare against`,
    };
  }

  const d = deviationFrom(gap, p.gapBaseline);
  if (!d || d.score <= 0) return null;
  // A ratio-derived deviation comes from an address with no spread in its
  // history. That is real evidence — "always 300 days apart, now 690" — but it
  // rests on a narrower measurement than a MAD-derived one, so it carries a
  // slightly lower confidence and says which method produced it.
  const strength = d.method === "mad" ? squash(d.score, 3) : clamp01(d.score / 4);
  return strength <= 0.01 ? null : {
    kind: "DORMANCY_BREAK",
    strength,
    confidence: Math.min(d.method === "mad" ? 0.95 : 0.8, 0.5 + p.observations / 40),
    evidence:
      `silent for ${fmtAge(gap / 86_400_000)} against a usual gap of ` +
      `${fmtAge(p.gapBaseline.median / 86_400_000)}` +
      (d.method === "mad"
        ? ` — ${fmtSigma(d.score)}`
        : ` — ${fmtMultiple(d.multiple)} its invariant interval`),
  };
}

/**
 * A large share of an address's balance leaving at once.
 *
 * The ratio, not the amount. Emptying a 4 BTC wallet and emptying a 4,000 BTC
 * one are the same event structurally, and the second is only more newsworthy
 * because of the size — which `amountAnomaly` already scores separately.
 *
 * Compared against the address's own drain history where it exists: a hot
 * wallet that sweeps itself daily should not trip this every day.
 */
export function balanceDrain(i: PatternInput): PatternHit | null {
  const before = i.balanceBefore;
  if (before === null || before === undefined || before <= 0) return null;

  const spent = spentFromSender(i);
  if (spent <= 0) return null;
  const ratio = Math.min(1, spent / before);

  const p = i.senderProfile;
  if (p?.drainBaseline && p.observations >= 4) {
    const d = deviationFrom(ratio, p.drainBaseline);
    if (d && d.score > 0) {
      // An invariant drain history is strong evidence, not absent evidence: an
      // address that has removed 0.05% of its balance on every one of forty
      // spends and now removes 20% has departed from its own habit sharply.
      const strength = d.method === "mad" ? squash(d.score, 3) : clamp01(d.score / 5);
      if (strength > 0.01) {
        return {
          kind: "BALANCE_DRAIN",
          strength,
          confidence: Math.min(d.method === "mad" ? 0.95 : 0.8, 0.55 + p.observations / 40),
          evidence:
            `${pct(ratio)} of balance removed against a usual ${pct(p.drainBaseline.median)}` +
            (d.method === "mad"
              ? ` — ${fmtSigma(d.score)}`
              : ` — ${fmtMultiple(d.multiple)} its invariant share`),
        };
      }
    }
    // Below its own habit, but an extreme absolute ratio still stands on its own.
    const absolute = ratio >= 0.9 ? clamp01((ratio - 0.9) / 0.1) * 0.6 : 0;
    return absolute <= 0.01 ? null : {
      kind: "BALANCE_DRAIN",
      strength: absolute,
      confidence: 0.6,
      evidence: `${pct(ratio)} of balance removed`,
    };
  }

  // No drain history: fall back to the ratio itself, at lower confidence.
  const strength = clamp01((ratio - 0.5) / 0.45);
  return strength <= 0.01 ? null : {
    kind: "BALANCE_DRAIN",
    strength,
    confidence: 0.5,
    evidence: `${pct(ratio)} of the address's balance removed; no drain history to compare against`,
  };
}

/** Value unusual against the chain, and against this address if known. */
export function amountAnomaly(i: PatternInput): PatternHit | null {
  const v = i.features.valueSats;
  const p = i.senderProfile;

  if (p?.spendBaseline && p.observations >= 4) {
    const d = deviationFrom(v, p.spendBaseline);
    if (d && d.score > 0) {
      const strength = d.method === "mad" ? squash(d.score, 3) : clamp01(d.score / 8);
      if (strength > 0.01) {
        return {
          kind: "AMOUNT_ANOMALY",
          strength,
          confidence: Math.min(d.method === "mad" ? 0.95 : 0.8, 0.55 + p.observations / 40),
          evidence:
            `${btc(v)} against this address's usual ${btc(p.spendBaseline.median)}` +
            (d.method === "mad"
              ? ` — ${fmtSigma(d.score)}`
              : ` — ${fmtMultiple(d.multiple)} its invariant size`),
        };
      }
    }
  }
  if (!i.valueBaseline) return null;
  const z = robustZ(v, i.valueBaseline);
  if (z === null || z <= 0) return null;
  return {
    kind: "AMOUNT_ANOMALY",
    strength: squash(z, 5),
    confidence: 0.55,
    evidence: `${btc(v)} against a chain median of ${btc(i.valueBaseline.median)} — ${fmtSigma(z)}`,
  };
}

/** Input/output shape unusual for this address, or for the chain. */
export function structureAnomaly(i: PatternInput): PatternHit | null {
  const f = i.features;
  const p = i.senderProfile;

  if (p && p.meanNIn !== null && p.meanNOut !== null && p.observations >= 4) {
    const dIn = Math.abs(f.nIn - p.meanNIn) / Math.max(1, p.meanNIn);
    const dOut = Math.abs(f.nOut - p.meanNOut) / Math.max(1, p.meanNOut);
    const strength = clamp01((Math.max(dIn, dOut) - 1) / 8);
    if (strength > 0.01) {
      return {
        kind: "STRUCTURE_ANOMALY",
        strength,
        confidence: Math.min(0.9, 0.5 + p.observations / 40),
        evidence:
          `${f.nIn} in / ${f.nOut} out against this address's usual ` +
          `${p.meanNIn.toFixed(0)} / ${p.meanNOut.toFixed(0)}`,
      };
    }
    return null;
  }

  if (!i.nInBaseline && !i.nOutBaseline) return null;
  const zIn = i.nInBaseline ? robustZ(f.nIn, i.nInBaseline) : null;
  const zOut = i.nOutBaseline ? robustZ(f.nOut, i.nOutBaseline) : null;
  const z = Math.max(zIn ?? 0, zOut ?? 0);
  if (z <= 0) return null;
  return {
    kind: "STRUCTURE_ANOMALY",
    strength: squash(z, 6),
    confidence: 0.5,
    evidence: `${f.nIn} in / ${f.nOut} out — ${fmtSigma(z)} of transaction shapes on this chain`,
  };
}

/** Many inputs collapsing into few outputs, relative to the chain. */
export function fanIn(i: PatternInput): PatternHit | null {
  const f = i.features;
  const ratio = f.nIn / Math.max(1, f.nOut);
  if (f.nIn < 5 || ratio < 2) return null;
  // Scaled against the observed distribution of input counts when available,
  // so "many" means many for this chain rather than many by assertion.
  const p99 = i.nInBaseline?.p99 ?? null;
  const strength = p99 && p99 > 0
    ? clamp01(Math.log2(f.nIn / p99 + 1) / 3)
    : clamp01((Math.log2(f.nIn) - 2) / 6);
  return strength <= 0.01 ? null : {
    kind: "FAN_IN",
    strength,
    confidence: p99 ? 0.8 : 0.5,
    evidence:
      `${f.nIn} inputs into ${f.nOut} outputs` +
      (p99 ? ` — the chain's 99th percentile is ${p99.toFixed(0)} inputs` : ""),
  };
}

/** Few inputs spreading into many outputs. */
export function fanOut(i: PatternInput): PatternHit | null {
  const f = i.features;
  const ratio = f.nOut / Math.max(1, f.nIn);
  if (f.nOut < 5 || ratio < 2) return null;
  const p99 = i.nOutBaseline?.p99 ?? null;
  const strength = p99 && p99 > 0
    ? clamp01(Math.log2(f.nOut / p99 + 1) / 3)
    : clamp01((Math.log2(f.nOut) - 2) / 6);
  return strength <= 0.01 ? null : {
    kind: "FAN_OUT",
    strength,
    confidence: p99 ? 0.8 : 0.5,
    evidence:
      `${f.nOut} outputs from ${f.nIn} input${f.nIn === 1 ? "" : "s"}` +
      (p99 ? ` — the chain's 99th percentile is ${p99.toFixed(0)} outputs` : ""),
  };
}

/**
 * Almost everything received being passed straight on.
 *
 * The pass-through signature. Verified on the Liquid first hop, which received
 * 3,996.02 BTC and forwarded 3,996.02 BTC, and on the Silk Road movement,
 * where the second transaction forwarded 99.999% of the first.
 */
export function nearTotalForward(i: PatternInput): PatternHit | null {
  const r = i.forwardRatio;
  if (r === null || r === undefined || r < 0.9) return null;
  // 0.90 → 0, 1.00 → 1. Keeping change is normal; keeping nothing is not.
  const strength = clamp01((r - 0.9) / 0.1);
  return {
    kind: "NEAR_TOTAL_FORWARD",
    strength,
    confidence: 0.85,
    evidence: `${pct(r)} of the value received was forwarded onward`,
  };
}

/** Funds spent again very soon after arriving. */
export function rapidForward(i: PatternInput): PatternHit | null {
  const d = i.forwardDelayMs;
  if (d === null || d === undefined || d < 0) return null;
  if (i.forwardDelayBaseline) {
    const z = robustZ(-d, { median: -i.forwardDelayBaseline.median, mad: i.forwardDelayBaseline.mad });
    if (z !== null && z > 0) {
      return {
        kind: "RAPID_FORWARD",
        strength: squash(z, 3),
        confidence: 0.8,
        evidence:
          `forwarded after ${fmtDur(d)} against a usual ${fmtDur(i.forwardDelayBaseline.median)}`,
      };
    }
  }
  // Without a baseline, one block is the natural reference: funds spent inside
  // a single confirmation interval were spent as fast as Bitcoin allows.
  const blocks = d / 600_000;
  const strength = clamp01((2 - blocks) / 2);
  return strength <= 0.01 ? null : {
    kind: "RAPID_FORWARD",
    strength,
    confidence: 0.6,
    evidence: `forwarded after ${fmtDur(d)}, inside ${blocks.toFixed(1)} block intervals`,
  };
}

/** Paying destinations this sender has never paid before. */
export function newCounterparty(i: PatternInput): PatternHit | null {
  const novel = i.novelDestinations;
  const total = i.totalDestinations;
  if (novel === undefined || total === undefined || total <= 0) return null;
  const frac = novel / total;
  const p = i.senderProfile;
  if (frac <= 0) return null;

  // An address that has never paid anyone has no basis for "new".
  if (!p || p.counterparties === 0) {
    return {
      kind: "NEW_COUNTERPARTY",
      strength: clamp01(frac) * 0.5,
      confidence: 0.3,
      evidence: `${novel} of ${total} destinations unseen, but this address has no payment history`,
    };
  }
  // Measured against how often this address ADDS a counterparty, not against
  // how many it has.
  //
  // An earlier version scaled strength up with the counterparty count, which
  // is exactly backwards and made an exchange hot wallet — 5,000 known payees,
  // adding new ones every block — score 0.5 for the most routine thing it
  // does. An address that meets someone new on every spend is not surprising
  // when it meets someone new. An address that has paid the same six people
  // for years is.
  const expectedNewPerSpend = p.counterparties / Math.max(1, p.observations);
  const ratio = novel / Math.max(expectedNewPerSpend, 0.05);
  const strength = clamp01((ratio - 1) / 8) * clamp01(frac);
  return strength <= 0.01 ? null : {
    kind: "NEW_COUNTERPARTY",
    strength,
    confidence: Math.min(0.9, 0.5 + p.observations / 40),
    evidence:
      `${novel} of ${total} destinations never paid before; this address normally ` +
      `adds ${expectedNewPerSpend.toFixed(2)} new counterparties per spend`,
  };
}

/** Fee rate far from the chain's, in either direction. */
export function feeAnomaly(i: PatternInput): PatternHit | null {
  const f = i.features;
  if (f.feeRate === null || !i.feeRateBaseline) return null;
  const z = robustZ(f.feeRate, i.feeRateBaseline);
  if (z === null) return null;
  // Both directions matter: overpaying signals urgency, underpaying on a large
  // transfer signals a process that never priced it.
  const strength = squash(Math.abs(z), 4);
  return strength <= 0.01 ? null : {
    kind: "FEE_ANOMALY",
    strength,
    confidence: 0.7,
    evidence:
      `${f.feeRate.toFixed(2)} sat/vB against a chain median of ` +
      `${i.feeRateBaseline.median.toFixed(2)} — ${fmtSigma(z)}`,
  };
}

/** Part of a chain of forwards rather than a single movement. */
export function multiHop(i: PatternInput): PatternHit | null {
  const hops = i.flowHops;
  if (!hops || hops < 2) return null;
  const strength = clamp01((hops - 1) / 5);
  return {
    kind: "MULTI_HOP",
    strength,
    confidence: 0.75,
    evidence: `hop ${hops} of a tracked chain of forwards`,
  };
}

/**
 * Message-layer patterns.
 *
 * Never keyed on content. The signals are that a payload has not been seen
 * before, that an address publishing none suddenly publishes several, and that
 * a message names an address the same transaction moves money to.
 */
export function messagePatterns(i: PatternInput): PatternHit[] {
  const m = i.message;
  if (!m) return [];
  const out: PatternHit[] = [];

  if (m.novelty > 0.5) {
    out.push({
      kind: "MESSAGE_NOVELTY",
      strength: clamp01((m.novelty - 0.5) * 2),
      confidence: m.confidence,
      evidence: "an embedded message with a payload not previously observed",
    });
  }
  if (m.burst > 0.2) {
    out.push({
      kind: "MESSAGE_BURST",
      strength: m.burst,
      confidence: m.confidence,
      evidence: "message activity on this address is far above its own history",
    });
  }
  if (m.linksAddressInTx) {
    out.push({
      kind: "MESSAGE_FUND_LINK",
      strength: 0.7,
      confidence: 0.8,
      evidence: "the embedded message names an address this transaction pays",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Combination                                                         */
/* ------------------------------------------------------------------ */

export interface Assessment {
  /** 0..1 — how abnormal the behaviour is. */
  risk: number;
  /** 0..1 — how much history backs that judgement. */
  confidence: number;
  patterns: PatternHit[];
  /** Patterns ranked by contribution, for the "why" list. */
  reasons: string[];
}

/**
 * Combine pattern hits into a risk, by noisy-OR.
 *
 *   S = 1 - Π(1 - sᵢ · cᵢ)
 *
 * Each hit is discounted by its own confidence before combining, so a strong
 * pattern resting on thin history contributes less than a strong pattern
 * resting on a hundred observations. The product form gives diminishing
 * returns automatically and can never exceed 1, so no component can dominate
 * by saturating.
 *
 * Confidence is the VALUE-WEIGHTED MEAN of the contributing confidences, not
 * their product: three independent observations each 70% certain make the
 * conclusion more certain, not 34% certain.
 */
export function assess(hits: PatternHit[]): Assessment {
  if (!hits.length) {
    return { risk: 0, confidence: 0, patterns: [], reasons: [] };
  }
  let inverse = 1;
  let weighted = 0;
  let weight = 0;
  for (const h of hits) {
    const s = clamp01(h.strength) * clamp01(h.confidence);
    inverse *= 1 - s;
    weighted += h.confidence * h.strength;
    weight += h.strength;
  }
  const risk = 1 - inverse;
  const confidence = weight > 0 ? weighted / weight : 0;

  const ranked = hits
    .slice()
    .sort((a, b) => b.strength * b.confidence - a.strength * a.confidence);

  return {
    risk: round3(risk),
    confidence: round3(confidence),
    patterns: ranked,
    reasons: ranked.slice(0, 5).map((h) => `${label(h.kind)}: ${h.evidence}`),
  };
}

export function label(k: PatternKind): string {
  const map: Record<PatternKind, string> = {
    DORMANCY_BREAK: "Dormancy break",
    BALANCE_DRAIN: "Balance drain",
    AMOUNT_ANOMALY: "Amount anomaly",
    STRUCTURE_ANOMALY: "Structure anomaly",
    FAN_IN: "Fan-in",
    FAN_OUT: "Fan-out",
    NEAR_TOTAL_FORWARD: "Near-total forward",
    RAPID_FORWARD: "Rapid forward",
    NEW_COUNTERPARTY: "New counterparty",
    FEE_ANOMALY: "Fee anomaly",
    MESSAGE_NOVELTY: "Novel message",
    MESSAGE_BURST: "Message burst",
    MESSAGE_FUND_LINK: "Message names a paid address",
    MULTI_HOP: "Multi-hop",
  };
  return map[k];
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function spentFromSender(i: PatternInput): number {
  const addr = i.features.topInputAddr;
  if (!addr) return 0;
  let sum = 0;
  for (const v of i.tx.vin) {
    if (v.prevout?.scriptpubkey_address === addr) sum += Number(v.prevout.value) || 0;
  }
  return sum;
}


/**
 * Render a z-score for a human.
 *
 * Bitcoin value distributions produce genuinely enormous z-scores — the Silk
 * Road movement measures 11,767,990σ against the chain median, which is
 * arithmetically correct and communicates nothing. Past about 6σ the number
 * has stopped being a scale and started being a way of saying "off the chart",
 * so that is what it says. Printing the raw figure invites a reader to treat a
 * presentation artefact as precision.
 */
/** "14x" / "0.3x" — a multiple, for deviations measured against an invariant. */
export function fmtMultiple(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return "a departure from";
  return m >= 10 ? `${Math.round(m)}x` : `${m.toFixed(1)}x`;
}

export function fmtSigma(z: number): string {
  if (!Number.isFinite(z)) return "immeasurable";
  const a = Math.abs(z);
  if (a >= 1000) return "beyond any observed range";
  if (a >= 6) return `${z > 0 ? "far above" : "far below"} anything in the sample`;
  return `${z > 0 ? "+" : ""}${z.toFixed(1)}σ`;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

function btc(sats: number): string {
  const v = sats / 1e8;
  return v >= 1
    ? `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} BTC`
    : `${v.toFixed(6)} BTC`;
}

function fmtAge(days: number): string {
  if (days < 2) return `${(days * 24).toFixed(0)}h`;
  if (days < 60) return `${days.toFixed(0)} days`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

function fmtDur(ms: number): string {
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(0)}s`;
  if (s < 5400) return `${(s / 60).toFixed(0)}m`;
  if (s < 172800) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}
