// ---------------------------------------------------------------------------
// Velocity and intent drift — the sequence-level controls.
//
// THE FAILURE THIS FILE EXISTS FOR. An agent holds a mandate: $50 per
// transaction, $500 per day, one approved vendor, human approval above $100. It
// enters an unhandled loop and makes ten payments of $49.50 to that vendor.
//
//     Per-transaction cap:  every payment passes.
//     Daily cap:            $495 of $500 — passes.
//     Merchant allowlist:   passes.
//     Approval threshold:   never reached, so no human is ever asked.
//
// Every individual check says ALLOW and the outcome is the budget drained on
// redundant infrastructure. The mandate was not violated; the INTENT was. No
// per-transaction control can see this, because the defect is not in any one
// payment — it is in the shape of the sequence.
//
// WHAT THIS IS NOT. It is not a model, and it must never become one. An LLM
// scoring "does this look like what the user meant" is a component that can be
// argued out of its answer by the same prompt injection that produced the
// payment, and it is non-reproducible: the same sequence scored twice gives two
// answers, so a denial cannot be explained to the customer or defended to a
// regulator. Everything here is arithmetic over a payment history, with the
// thresholds as explicit configuration. If semantic analysis is added later it
// arrives as one more SIGNAL with a weight, never as the decision.
//
// EVERY RATIO IS INTEGER BASIS POINTS. `bps(a, b)` is bigint division, so two
// instances computing the same ratio get the same integer. A float ratio
// compared against a float threshold is a decision that can differ between two
// machines on the same input, which for an authorization boundary is disqualifying.
//
// THE THRESHOLD-AVOIDANCE SIGNAL IS THE ONE THAT MATTERS MOST. A sequence that
// repeatedly lands just under the approval threshold is either a coincidence or
// the precise behaviour the threshold was placed there to catch, and there is no
// third possibility. It is weighted accordingly.
// ---------------------------------------------------------------------------

import { mustParseAtomic, parseAtomic, type Atomic } from "./units";

/** One historical payment, as the drift engine needs to see it. */
export interface SequenceEntry {
  readonly paymentId: string;
  readonly atMs: number;
  readonly amountAtomic: Atomic;
  /** Stable recipient key — wallet address, beneficiary ref, or merchant id. */
  readonly recipientKey: string;
  readonly merchantDomain?: string;
  readonly category?: string;
  readonly railId?: string;
  /** Whether this one actually moved value. Declines must not inflate a
   *  velocity signal, or an attacker locks a victim out by stacking failures. */
  readonly settled: boolean;
}

/** The payment being assessed. Not yet in the history. */
export interface CandidatePayment {
  readonly amountAtomic: Atomic;
  readonly recipientKey: string;
  readonly merchantDomain?: string;
  readonly category?: string;
  readonly railId?: string;
}

export interface DriftConfig {
  /** Window the sequence is measured over. */
  readonly windowSeconds: number;
  /** Cumulative ceiling for the window, atomic. Usually the mandate's. */
  readonly cumulativeCapAtomic: Atomic;
  /** Approval threshold, atomic, when the mandate sets one. */
  readonly approvalThresholdAtomic?: Atomic;
  /** Max settled payments in the window before frequency is a signal. */
  readonly maxPaymentsPerWindow: number;
  /** Max distinct recipients in the window before fan-out is a signal. */
  readonly maxDistinctRecipients: number;
  /**
   * How close to the approval threshold counts as "just under", in bps.
   *
   * 8000 = within 80–100% of the threshold. Wider catches more structuring and
   * more honest traffic; this is the knob an operator tunes per organization.
   */
  readonly nearThresholdFloorBps: number;
  /** Near-threshold payments in the window before avoidance is a signal. */
  readonly nearThresholdCount: number;
  /** Identical-amount repetitions before repetition is a signal. */
  readonly repeatedAmountCount: number;
  /** Exposure, in bps of the cap, above which exposure itself is a signal. */
  readonly exposureWarnBps: number;
  /** Score at or above which the verdict becomes HOLD. */
  readonly holdScore: number;
  /** Score at or above which the verdict becomes DENY. */
  readonly denyScore: number;
}

/**
 * Defaults, each one chosen against the scenario in the header.
 *
 * `nearThresholdCount: 3` is the tightest of them: three payments in a row
 * landing in the top fifth of the approval threshold is the signature of a loop
 * or an adversary probing the boundary, and by the third one the cheapest
 * correct action is to ask a human. Two is too easily a coincidence — a
 * legitimate agent buying the same $95 instance type twice.
 */
export const DEFAULT_DRIFT_CONFIG: Omit<DriftConfig, "cumulativeCapAtomic"> = {
  windowSeconds: 86_400,
  maxPaymentsPerWindow: 20,
  maxDistinctRecipients: 8,
  nearThresholdFloorBps: 8_000,
  nearThresholdCount: 3,
  repeatedAmountCount: 4,
  exposureWarnBps: 8_000,
  holdScore: 40,
  denyScore: 80,
};

export type DriftSignalId =
  | "exposure_near_cap"
  | "exposure_exceeds_cap"
  | "frequency_exceeded"
  | "recipient_fanout"
  | "recipient_concentration_new"
  | "repeated_identical_amounts"
  | "approval_threshold_avoidance"
  | "threshold_avoidance_cumulative"
  | "rail_switching"
  | "category_outside_sequence";

export interface DriftSignal {
  readonly id: DriftSignalId;
  /** Integer points. Summed — no floats in the score. */
  readonly weight: number;
  readonly detail: string;
  /** The measured value and the bound it was compared against. */
  readonly observed: string;
  readonly bound: string;
}

/**
 * Weights.
 *
 * `exposure_exceeds_cap` is 100 on its own, which is above `denyScore`: a
 * payment that would take the window past its cumulative cap is not a risk
 * signal, it is a limit breach, and the drift engine must not be the component
 * that lets one through with a middling score.
 */
const WEIGHTS: Record<DriftSignalId, number> = {
  exposure_exceeds_cap: 100,
  approval_threshold_avoidance: 55,
  threshold_avoidance_cumulative: 45,
  repeated_identical_amounts: 30,
  frequency_exceeded: 25,
  recipient_fanout: 25,
  recipient_concentration_new: 20,
  exposure_near_cap: 15,
  rail_switching: 10,
  category_outside_sequence: 10,
};

export type DriftVerdict = "ALLOW" | "HOLD" | "DENY";

export interface DriftAssessment {
  readonly verdict: DriftVerdict;
  readonly score: number;
  readonly signals: readonly DriftSignal[];
  readonly measured: {
    readonly windowSeconds: number;
    readonly settledCount: number;
    readonly exposureBeforeAtomic: Atomic;
    readonly exposureAfterAtomic: Atomic;
    readonly exposureAfterBps: number;
    readonly distinctRecipients: number;
    readonly nearThresholdCount: number;
    readonly maxIdenticalAmountRun: number;
  };
}

/** Integer basis points of `a` relative to `b`. 0 when `b` is 0. */
export function bps(a: bigint, b: bigint): number {
  if (b === 0n) return 0;
  return Number((a * 10_000n) / b);
}

export interface AssessDriftInput {
  readonly candidate: CandidatePayment;
  /** Payment history. Entries outside the window are ignored, not an error. */
  readonly history: readonly SequenceEntry[];
  readonly config: DriftConfig;
  readonly nowMs: number;
}

/**
 * Score the sequence this payment would create.
 *
 * DETERMINISTIC AND ORDER-INDEPENDENT: the history is filtered and aggregated,
 * never traversed in a way that depends on its arrival order, so two callers
 * holding the same set of payments in different orders reach the same verdict.
 * That property is what lets the payer-side gate and the control plane run this
 * function and agree.
 */
export function assessDrift(input: AssessDriftInput): DriftAssessment {
  const { candidate, config, nowMs } = input;
  const since = nowMs - config.windowSeconds * 1000;

  // FUTURE-DATED ENTRIES ARE COUNTED, NOT DROPPED.
  //
  // The obvious filter is `atMs >= since && atMs <= nowMs`, and it has an
  // evasion in it: an entry stamped in the future falls outside the window and
  // leaves the exposure sum entirely. Any influence over a timestamp — a
  // provider-supplied `occurredAt`, clock skew between two instances, a
  // backfill that writes tomorrow's date — then becomes a way to hide spend
  // from the cumulative cap, which is the one control the $49-sequence case
  // depends on.
  //
  // Excluding is the attacker-favourable direction, so it is not the one taken.
  // A post-dated entry is either our own clock skew (harmless to count) or an
  // attempt to hide spend (essential to count), and both resolve correctly by
  // including it. Only entries genuinely older than the window are dropped.
  const window = input.history.filter((e) => e.settled && e.atMs >= since);

  const amount = mustParseAtomic(candidate.amountAtomic, "candidate.amountAtomic");
  const cap = mustParseAtomic(config.cumulativeCapAtomic, "cumulativeCapAtomic");

  let exposureBefore = 0n;
  for (const e of window) exposureBefore += mustParseAtomic(e.amountAtomic, "history amount");
  const exposureAfter = exposureBefore + amount;

  const signals: DriftSignal[] = [];
  const add = (id: DriftSignalId, detail: string, observed: string, bound: string) =>
    signals.push({ id, weight: WEIGHTS[id], detail, observed, bound });

  // ── Exposure ────────────────────────────────────────────────────────────
  const exposureAfterBps = bps(exposureAfter, cap);
  if (exposureAfter > cap) {
    add(
      "exposure_exceeds_cap",
      "this payment would take window exposure past the cumulative cap",
      exposureAfter.toString(),
      cap.toString()
    );
  } else if (exposureAfterBps >= config.exposureWarnBps) {
    add(
      "exposure_near_cap",
      `window exposure would reach ${(exposureAfterBps / 100).toFixed(2)}% of the cumulative cap`,
      `${exposureAfterBps}bps`,
      `${config.exposureWarnBps}bps`
    );
  }

  // ── Frequency ───────────────────────────────────────────────────────────
  // `> max` not `>=`: the cap is the number of payments permitted, so the
  // (max+1)th is the first one that exceeds it.
  if (window.length + 1 > config.maxPaymentsPerWindow) {
    add(
      "frequency_exceeded",
      "settled-payment count in the window exceeds the configured maximum",
      String(window.length + 1),
      String(config.maxPaymentsPerWindow)
    );
  }

  // ── Recipient shape ─────────────────────────────────────────────────────
  const recipients = new Set(window.map((e) => e.recipientKey));
  const distinctAfter = new Set([...recipients, candidate.recipientKey]).size;
  if (distinctAfter > config.maxDistinctRecipients) {
    add(
      "recipient_fanout",
      "distinct recipients in the window exceed the configured maximum, which is the shape of a drain rather than a task",
      String(distinctAfter),
      String(config.maxDistinctRecipients)
    );
  }

  // The opposite risk to fan-out: a large share of the window's value heading
  // to a recipient that has no history at all. Concentration alone is normal —
  // one vendor, many invoices — so it only counts when the recipient is NEW.
  const isNewRecipient = !recipients.has(candidate.recipientKey);
  if (isNewRecipient && exposureBefore > 0n) {
    const shareBps = bps(amount, exposureAfter);
    if (shareBps >= 5_000) {
      add(
        "recipient_concentration_new",
        "a previously unseen recipient would take the majority of this window's value",
        `${shareBps}bps to ${candidate.recipientKey}`,
        "5000bps"
      );
    }
  }

  // ── Repetition ──────────────────────────────────────────────────────────
  // The $49.50 × 10 case. Counted on the EXACT amount, because a loop repeats
  // an amount exactly and a human making ten similar purchases does not.
  const byAmount = new Map<string, number>();
  for (const e of window) {
    const key = mustParseAtomic(e.amountAtomic, "history amount").toString();
    byAmount.set(key, (byAmount.get(key) ?? 0) + 1);
  }
  const candidateKey = amount.toString();
  byAmount.set(candidateKey, (byAmount.get(candidateKey) ?? 0) + 1);
  let maxRun = 0;
  for (const count of byAmount.values()) maxRun = Math.max(maxRun, count);
  if ((byAmount.get(candidateKey) ?? 0) >= config.repeatedAmountCount) {
    add(
      "repeated_identical_amounts",
      "this exact amount has repeated enough times in the window to indicate an automated loop rather than distinct decisions",
      String(byAmount.get(candidateKey)),
      String(config.repeatedAmountCount)
    );
  }

  // ── Approval-threshold avoidance ────────────────────────────────────────
  let nearCount = 0;
  const threshold = config.approvalThresholdAtomic
    ? parseAtomic(config.approvalThresholdAtomic)
    : null;
  if (threshold !== null && threshold > 0n) {
    const floor = (threshold * BigInt(config.nearThresholdFloorBps)) / 10_000n;
    const isNear = (v: bigint) => v >= floor && v <= threshold;
    let nearSum = 0n;
    for (const e of window) {
      const v = mustParseAtomic(e.amountAtomic, "history amount");
      if (isNear(v)) {
        nearCount += 1;
        nearSum += v;
      }
    }
    if (isNear(amount)) {
      nearCount += 1;
      nearSum += amount;
    }

    if (nearCount >= config.nearThresholdCount) {
      add(
        "approval_threshold_avoidance",
        "repeated payments landing just below the human-approval threshold; the threshold exists to catch exactly this shape, and a sequence that hugs it has bypassed the control without breaking any single rule",
        `${nearCount} payments in [${floor}, ${threshold}]`,
        String(config.nearThresholdCount)
      );
    }
    // Two sub-threshold payments summing past the threshold have moved more
    // value than any single payment a human would have been asked about. That
    // is structuring whether or not the count signal fired.
    if (nearCount >= 2 && nearSum > threshold) {
      add(
        "threshold_avoidance_cumulative",
        "sub-threshold payments cumulatively exceed the amount that would have required approval",
        nearSum.toString(),
        threshold.toString()
      );
    }
  }

  // ── Route and category coherence ────────────────────────────────────────
  if (candidate.railId) {
    const rails = new Set(window.map((e) => e.railId).filter((r): r is string => !!r));
    if (rails.size > 0 && !rails.has(candidate.railId)) {
      add(
        "rail_switching",
        "this payment would use a rail this sequence has not used, which is how a policy tuned on one rail is sidestepped on another",
        candidate.railId,
        [...rails].join(",")
      );
    }
  }
  if (candidate.category) {
    const categories = new Set(window.map((e) => e.category).filter((c): c is string => !!c));
    if (categories.size > 0 && !categories.has(candidate.category)) {
      add(
        "category_outside_sequence",
        "this payment's category does not appear in the current sequence",
        candidate.category,
        [...categories].join(",")
      );
    }
  }

  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  const verdict: DriftVerdict =
    score >= config.denyScore ? "DENY" : score >= config.holdScore ? "HOLD" : "ALLOW";

  return {
    verdict,
    score,
    signals,
    measured: {
      windowSeconds: config.windowSeconds,
      settledCount: window.length,
      exposureBeforeAtomic: exposureBefore.toString(),
      exposureAfterAtomic: exposureAfter.toString(),
      exposureAfterBps,
      distinctRecipients: distinctAfter,
      nearThresholdCount: nearCount,
      maxIdenticalAmountRun: maxRun,
    },
  };
}

/** Build a config from a mandate's scope plus organization overrides. */
export function driftConfigFor(input: {
  readonly cumulativeCapAtomic: Atomic;
  readonly windowSeconds: number;
  readonly approvalThresholdAtomic?: Atomic;
  readonly overrides?: Partial<DriftConfig>;
}): DriftConfig {
  return {
    ...DEFAULT_DRIFT_CONFIG,
    cumulativeCapAtomic: input.cumulativeCapAtomic,
    windowSeconds: input.windowSeconds,
    approvalThresholdAtomic: input.approvalThresholdAtomic,
    ...(input.overrides ?? {}),
  };
}
