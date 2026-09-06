import {
  REASONS,
  type ObservedReason,
  type ReasonCategory,
  type ReasonCode,
  type ReasonSeverity,
} from "./reasons";

// ---------------------------------------------------------------------------
// The Trust Score.
//
// WHAT REPLACES WHAT. The previous engine added fixed points per signal and
// clamped at 100:  automation +75, emulator +40, vpn +20, newDevice +15.
// Three failures follow from that shape, and this module exists to fix them:
//
//   1. SATURATION. Two signals reach the block threshold, so a device that is
//      merely new and on a VPN scores the same as a confirmed card-testing
//      ring. Once the ceiling is hit the score stops carrying information at
//      exactly the point where the decision matters most.
//
//   2. NO CONFIDENCE. A score from two weak signals and a score from thirty
//      corroborating ones are indistinguishable. That is the difference
//      between "block this" and "we do not know enough to block anyone".
//
//   3. NO TIME. A signal from six months ago counted the same as one from ten
//      seconds ago, so a customer could never recover from a bad day.
//
// THE MODEL. Within a category, evidence combines by NOISY-OR:
//
//     combined = 1 - Π(1 - pᵢ)
//
// which treats each reason as an independent piece of evidence for the same
// conclusion. Two weak signals reinforce; ten weak signals approach but never
// reach the strength of one certain signal. That is the correct shape, and it
// is why "three mediums" cannot outweigh "one critical" by arithmetic accident.
//
// Categories are then weighted and summed, because they are NOT independent
// evidence for one another: a shared device and a sanctions match say different
// things and must both be able to move the score on their own.
//
// A SCORE IS NEVER THE WHOLE DECISION. `TrustAssessment` cannot be constructed
// without its reasons, and `recommendedAction` refuses to block on low
// confidence however high the score. A number with no explanation is not a
// decision anyone can defend to a customer or a regulator.
// ---------------------------------------------------------------------------

export const SCORE_MIN = 0;
export const SCORE_MAX = 1000;

export type RiskBand = "trusted" | "low" | "medium" | "high" | "critical";

/** Band boundaries, inclusive lower bound. */
export const BANDS: readonly { band: RiskBand; min: number; max: number }[] = [
  { band: "trusted", min: 0, max: 199 },
  { band: "low", min: 200, max: 399 },
  { band: "medium", min: 400, max: 599 },
  { band: "high", min: 600, max: 799 },
  { band: "critical", min: 800, max: 1000 },
];

export function bandFor(score: number): RiskBand {
  const found = BANDS.find((b) => score >= b.min && score <= b.max);
  // Unreachable for a clamped score; a band table with a gap is a bug worth
  // failing loudly on rather than defaulting to "trusted".
  if (!found) throw new Error(`No band covers score ${score}`);
  return found.band;
}

/**
 * Evidence strength per severity, as a probability in 0..1.
 *
 * `critical` is 0.85 and not 1.0 on purpose: nothing observed from a client is
 * certain. Reserving the top of the range means a genuinely certain server-side
 * fact (a sanctions match) can still outrank the strongest inferred signal.
 */
const SEVERITY_STRENGTH: Record<ReasonSeverity, number> = {
  informational: 0.0,
  low: 0.15,
  medium: 0.35,
  high: 0.6,
  critical: 0.85,
};

/**
 * Category weights, in score points.
 *
 * These are the maximum a category can contribute when its evidence is
 * certain. They encode a policy, not a measurement, and are the first thing to
 * retune once real outcome data exists — which is why they are one table and
 * not scattered through the code.
 *
 * Compliance is highest because the obligation is legal rather than economic.
 * Network is lowest because IP-derived signals have the worst false-positive
 * profile of anything here: they fire on travellers, on corporate VPNs, and on
 * privacy-conscious customers, which is to say on people who are not fraudsters.
 */
const CATEGORY_WEIGHT: Record<ReasonCategory, number> = {
  compliance: 650,
  graph: 550,
  payment: 500,
  velocity: 450,
  identity: 420,
  device: 380,
  behavior: 280,
  account: 280,
  network: 180,
};

// CALIBRATION, and the defect that produced these numbers.
//
// The first pass weighted categories so that their SUM could not overshoot the
// scale. The arithmetic consequence went unnoticed until a test wrote it down:
// a 12-account ring sharing two devices and two cards, one of them linked to
// confirmed fraud, scored 212 — the "low" band — and auto-approved. No single
// category could reach even "medium", so the engine could only ever act when
// three unrelated categories agreed, which in practice means it rarely acts.
//
// The weights are now set so that ONE fully-corroborated category lands in
// medium (verify, do not refuse), TWO reach high, and three or more saturate
// into critical. Overshoot is expected and clamped: overwhelming evidence
// across many categories SHOULD peg the scale.
//
// Network stays lowest by a wide margin. Even certain evidence there reaches
// only 180, so an IP-derived signal can never on its own push a customer past
// "trusted" — which is the intended outcome for a control whose false
// positives land on travellers and VPN users.

/** Half-life in days per category — how fast evidence stops mattering. */
const DECAY_HALF_LIFE_DAYS: Record<ReasonCategory, number> = {
  // Confirmed fraud links and compliance facts age slowly; a sanctions match
  // from last month is still a sanctions match.
  compliance: 3650,
  graph: 365,
  payment: 180,
  identity: 180,
  account: 90,
  velocity: 7,
  // Session-scoped evidence. Automation observed last week says nothing about
  // this session, and carrying it forward punishes a customer indefinitely for
  // one bad signal.
  device: 30,
  behavior: 3,
  network: 3,
};

/** Multiplier in 0..1 for how much this evidence still counts. */
export function decayFactor(
  category: ReasonCategory,
  observedAt: string,
  now: number = Date.now()
): number {
  const at = Date.parse(observedAt);
  // An unparseable timestamp is treated as fully decayed rather than fully
  // fresh: unknown provenance must not be the strongest evidence in the set.
  if (!Number.isFinite(at)) return 0;

  const ageDays = Math.max(0, (now - at) / 86_400_000);
  const halfLife = DECAY_HALF_LIFE_DAYS[category];
  return Math.pow(0.5, ageDays / halfLife);
}

export interface CategoryContribution {
  readonly category: ReasonCategory;
  /** Points added (positive) or removed (negative). */
  readonly points: number;
  /** Combined evidence strength for this category, 0..1. */
  readonly strength: number;
  readonly reasons: readonly ObservedReason[];
}

export interface TrustAssessment {
  readonly score: number;
  readonly band: RiskBand;
  /**
   * How much evidence backed this score, 0..1.
   *
   * Not a probability of fraud. It answers "did we look at enough to justify
   * acting?", and it is why a high score on thin evidence routes to review
   * rather than to a decline.
   */
  readonly confidence: number;
  readonly contributions: readonly CategoryContribution[];
  /** Every reason considered, highest impact first. */
  readonly reasons: readonly ObservedReason[];
  /** Codes that alone justify refusal, if any fired. */
  readonly standaloneTriggers: readonly ReasonCode[];
  readonly assessedAt: string;
}

/** Noisy-OR: independent evidence for one conclusion. */
function combineIndependent(probabilities: readonly number[]): number {
  let complement = 1;
  for (const p of probabilities) complement *= 1 - Math.max(0, Math.min(1, p));
  return 1 - complement;
}

/** Per-reason effective strength: severity × confidence × decay. */
function effectiveStrength(reason: ObservedReason, now: number): number {
  const def = REASONS[reason.code];
  const base = SEVERITY_STRENGTH[def.severity];
  const confidence = Math.max(0, Math.min(1, reason.confidence));
  return base * confidence * decayFactor(def.category, reason.observedAt, now);
}

/**
 * Confidence in the assessment as a whole.
 *
 * Driven by how much NON-DECAYED evidence there is and how many distinct
 * categories corroborate. One category shouting is less trustworthy than three
 * categories agreeing, and that is exactly the difference between a brittle
 * single-signal decline and a defensible one.
 */
function assessmentConfidence(
  reasons: readonly ObservedReason[],
  now: number
): number {
  const live = reasons.filter((r) => effectiveStrength(r, now) > 0.01);
  if (live.length === 0) return 0;

  const categories = new Set(live.map((r) => REASONS[r.code].category));
  // Saturating curves rather than linear: the fifth reason adds much less than
  // the second, and beyond three categories more breadth adds little.
  const volume = 1 - Math.pow(0.6, live.length);
  const breadth = 1 - Math.pow(0.5, categories.size);
  return Math.max(0, Math.min(1, 0.55 * volume + 0.45 * breadth));
}

/**
 * Score a set of observed reasons.
 *
 * Deterministic and pure: the same inputs at the same `now` always produce the
 * same score. A risk decision that cannot be reproduced cannot be audited, and
 * "why was this customer declined in March" must be answerable in September.
 */
export function assessTrust(
  reasons: readonly ObservedReason[],
  now: number = Date.now()
): TrustAssessment {
  const byCategory = new Map<ReasonCategory, ObservedReason[]>();
  for (const reason of reasons) {
    const category = REASONS[reason.code].category;
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(reason);
    else byCategory.set(category, [reason]);
  }

  const contributions: CategoryContribution[] = [];
  let total = 0;

  for (const [category, categoryReasons] of byCategory) {
    const raising = categoryReasons.filter((r) => REASONS[r.code].direction === "raises_risk");
    const lowering = categoryReasons.filter((r) => REASONS[r.code].direction === "lowers_risk");

    const riskStrength = combineIndependent(raising.map((r) => effectiveStrength(r, now)));
    const trustStrength = combineIndependent(lowering.map((r) => effectiveStrength(r, now)));

    // Net within the category. Trust evidence offsets risk evidence for the
    // SAME category only: a long-tenured device should quiet device risk, and
    // must not quiet a sanctions match.
    const net = riskStrength - trustStrength;
    const points = net * CATEGORY_WEIGHT[category];

    contributions.push({
      category,
      points: Math.round(points),
      strength: Number(net.toFixed(4)),
      reasons: categoryReasons,
    });
    total += points;
  }

  // ── The critical floor ────────────────────────────────────────────────
  //
  // A defect the tests caught. Category weighting means single-category
  // evidence cannot reach a high band by arithmetic: PAY.CARD_TESTING alone
  // scores 0.85 × 240 = 204, which lands in "low" and AUTO-APPROVES a detected
  // card-testing run. That is precisely backwards.
  //
  // The noisy-OR maths is right and should not be distorted to fix it — raising
  // category weights until one signal reaches 600 would make three ordinary
  // signals reach 900. Instead, a critical-severity reason with real strength
  // FLOORS the band at high. It does not force a decline: confidence still
  // governs that, so a lone critical signal goes to a human rather than
  // refusing a customer on one input.
  const criticalPresent = reasons.some(
    (r) => REASONS[r.code].severity === "critical" &&
      REASONS[r.code].direction === "raises_risk" &&
      effectiveStrength(r, now) >= CRITICAL_FLOOR_MIN_STRENGTH
  );
  const floor = criticalPresent ? CRITICAL_SEVERITY_FLOOR : SCORE_MIN;

  const score = Math.max(floor, Math.min(SCORE_MAX, Math.round(Math.max(SCORE_MIN, total))));

  const standaloneTriggers = reasons
    .filter((r) => REASONS[r.code].sufficientAlone && effectiveStrength(r, now) > 0)
    .map((r) => r.code);

  return {
    score,
    band: bandFor(score),
    confidence: Number(assessmentConfidence(reasons, now).toFixed(4)),
    contributions: contributions.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    reasons: [...reasons].sort((a, b) => effectiveStrength(b, now) - effectiveStrength(a, now)),
    standaloneTriggers,
    assessedAt: new Date(now).toISOString(),
  };
}

// ── Action ─────────────────────────────────────────────────────────────────

export type TrustAction =
  | "approve"
  | "step_up"
  | "manual_review"
  | "hold"
  | "decline";

export interface ActionDecision {
  readonly action: TrustAction;
  /** Machine-readable justification for the action itself. */
  readonly basis:
    | "standalone_trigger"
    | "band"
    | "low_confidence_guard"
    | "insufficient_evidence";
  readonly explanation: string;
}

/**
 * Minimum confidence before an automated DECLINE is permitted.
 *
 * The most important constant in this file. A high score on thin evidence is
 * the shape of a false positive, and declining on it means the customers who
 * are wrongly refused are disproportionately the ones about whom we know least
 * — new, foreign, privacy-conscious, thin-file. Those declines are also the
 * ones a customer cannot argue with, because nobody looked.
 */
export const MIN_CONFIDENCE_TO_DECLINE = 0.6;

/**
 * Band floor imposed by any critical-severity reason.
 *
 * Set to the bottom of the "high" band, not "critical": a single critical
 * detection is enough to guarantee a human looks, and not enough to refuse a
 * customer outright. The distinction is the difference between a system that
 * catches card testing and one that declines a legitimate customer on one
 * noisy input.
 */
export const CRITICAL_SEVERITY_FLOOR = 600;

/**
 * Strength a critical reason needs before it floors the band.
 *
 * 0.3 admits a confirmed-fraud link two hops out through a strong edge type
 * (a shared card discounts to ~0.38) while still excluding the genuinely weak
 * case — the same link reached through an IP discounts to ~0.13 and does not
 * floor anything. Distance and link quality are supposed to matter; the floor
 * must not erase them.
 */
export const CRITICAL_FLOOR_MIN_STRENGTH = 0.3;

/**
 * Map an assessment to an action.
 *
 * Order matters. A standalone compliance trigger outranks everything, because
 * a sanctions obligation does not weigh confidence. Below that, a high score
 * with thin evidence is routed to a HUMAN rather than declined — the system
 * says "this needs a person", not "this person is a fraudster".
 */
export function recommendedAction(assessment: TrustAssessment): ActionDecision {
  if (assessment.standaloneTriggers.length > 0) {
    return {
      action: "decline",
      basis: "standalone_trigger",
      explanation:
        `Refused on ${assessment.standaloneTriggers.join(", ")}, which is dispositive on its own ` +
        "and is not weighed against convenience.",
    };
  }

  const band = assessment.band;

  if (band === "critical" || band === "high") {
    if (assessment.confidence < MIN_CONFIDENCE_TO_DECLINE) {
      return {
        action: "manual_review",
        basis: "low_confidence_guard",
        explanation:
          `Score ${assessment.score} (${band}) but confidence is ${assessment.confidence.toFixed(2)}, ` +
          `below the ${MIN_CONFIDENCE_TO_DECLINE} required to decline automatically. A high score on ` +
          "thin evidence is the shape of a false positive, so this goes to a person.",
      };
    }
    return band === "critical"
      ? {
          action: "decline",
          basis: "band",
          explanation: `Score ${assessment.score} is critical with sufficient corroborating evidence.`,
        }
      : {
          action: "hold",
          basis: "band",
          explanation: `Score ${assessment.score} is high; funds held pending verification.`,
        };
  }

  if (band === "medium") {
    return {
      action: "step_up",
      basis: "band",
      explanation: `Score ${assessment.score} warrants additional verification rather than refusal.`,
    };
  }

  return {
    action: "approve",
    basis: "band",
    explanation: `Score ${assessment.score} is within normal range.`,
  };
}

/**
 * The full explanation of a decision, for an analyst or an audit record.
 *
 * Contains the score, the band, the confidence, the action and every reason
 * with its contribution. This is the artefact that answers "on what basis",
 * and it is produced for EVERY decision including approvals — a system that
 * only explains its refusals cannot show that its approvals were considered.
 */
export interface DecisionRecord {
  readonly assessment: TrustAssessment;
  readonly decision: ActionDecision;
  readonly topFactors: readonly {
    code: ReasonCode;
    category: ReasonCategory;
    severity: ReasonSeverity;
    effect: string;
    explanation: string;
    detail?: string;
  }[];
}

export function explainDecision(
  assessment: TrustAssessment,
  now: number = Date.now()
): DecisionRecord {
  const topFactors = assessment.reasons.slice(0, 8).map((reason) => {
    const def = REASONS[reason.code];
    const strength = effectiveStrength(reason, now);
    return {
      code: reason.code,
      category: def.category,
      severity: def.severity,
      effect:
        strength < 0.01
          ? "decayed to negligible"
          : `${def.direction === "raises_risk" ? "+" : "-"}${(strength * 100).toFixed(0)}% strength`,
      explanation: def.analystExplanation,
      detail: reason.detail,
    };
  });

  return { assessment, decision: recommendedAction(assessment), topFactors };
}
