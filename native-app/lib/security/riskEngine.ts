import type { RiskAction } from "./riskPolicy";

// ---------------------------------------------------------------------------
// Deterministic risk evaluation.
//
// DESIGN CONSTRAINTS, taken from the brief and not negotiable:
//
//   1. RULES FIRST, NOT A MODEL. Every decision below is a named rule with a
//      threshold you can read. No score comes from anything opaque, and no
//      irreversible financial decision is made by a model.
//   2. EXPLAINABLE. A decision carries the list of rules that fired, each with
//      the value that tripped it. "Blocked" without a reason is not shippable
//      for money.
//   3. MINIMAL COLLECTION. The signals below are all things the app ALREADY
//      knows from the user's own local history and the device-integrity check
//      it already runs. Deliberately absent: location, IP reputation, contact
//      scraping, installed-app enumeration, SIM identifiers. RedotPay ships
//      three device-fingerprinting stacks; copying that would be a privacy
//      regression sold as a security feature.
//
// This is ADVISORY. It runs before the server, to decide how hard to make the
// user work and what to warn them about. The server independently authorizes
// every action and can refuse regardless of what this returns.
// ---------------------------------------------------------------------------

export type RiskDecision = "ALLOW" | "STEP_UP" | "REVIEW" | "BLOCK";

/** A rule that fired, in the words the user or a support agent would read. */
export interface FiredRule {
  id: string;
  /** What tripped, stated with the actual value. */
  detail: string;
  contributes: RiskDecision;
}

export interface RiskAssessment {
  decision: RiskDecision;
  /** Every rule that fired, most severe first. Empty when decision is ALLOW. */
  rules: FiredRule[];
  /** Non-blocking notes worth putting in front of the user before they commit. */
  warnings: string[];
}

/**
 * Everything the engine is allowed to look at.
 *
 * All of it is either already on the device or already computed for another
 * purpose. Adding a field here should require justifying the collection.
 */
export interface RiskSignals {
  action: RiskAction;
  amountUsd: number;

  /** From lib/security/deviceIntegrity.ts. */
  deviceCompromised?: boolean;
  /** Play Integrity / attestation could not be evaluated at all. */
  integrityUnknown?: boolean;

  /** Has the user ever sent to this destination before? */
  knownBeneficiary?: boolean;
  /** Destination is in the user's own address book. */
  inAddressBook?: boolean;

  /** Successful payments by this user in the last 24h (local history). */
  transactionsLast24h?: number;
  /** Total USD moved in the last 24h (local history). */
  amountLast24hUsd?: number;
  /** The user's typical payment size, from their own history. */
  medianTransactionUsd?: number;

  /** Consecutive failed authentication attempts this session. */
  failedAuthAttempts?: number;
  /** Days since this account was created. */
  accountAgeDays?: number;
  /** True when this install has not been seen before (fresh keystore). */
  newDevice?: boolean;
}

/** Severity ordering, so the strictest rule wins. */
const SEVERITY: Record<RiskDecision, number> = {
  ALLOW: 0,
  STEP_UP: 1,
  REVIEW: 2,
  BLOCK: 3,
};

// --- thresholds -------------------------------------------------------------
// Named constants, not magic numbers buried in a condition, so the policy can
// be reviewed without reading the implementation.

const THRESHOLDS = {
  /** Above this, a first-time destination is worth a second look. */
  newBeneficiaryUsd: 250,
  /** A single payment this many times the user's own median is unusual. */
  anomalyMultiple: 10,
  /** …but only once we have a median worth trusting. */
  anomalyMinHistory: 5,
  /** Payments in 24h beyond which velocity looks automated. */
  velocityCount24h: 20,
  /** Total moved in 24h beyond which we ask for a step-up. */
  velocityAmount24hUsd: 5_000,
  /** Failed auth attempts before we stop asking and start refusing. */
  maxFailedAuth: 5,
  /** An account younger than this is treated as unestablished. */
  youngAccountDays: 7,
  /** Large payment from a young account. */
  youngAccountUsd: 500,
} as const;

/**
 * Evaluate.
 *
 * Pure and synchronous: the caller gathers signals, this decides. That keeps it
 * exhaustively testable, which for a rule set that can block a payment is the
 * whole point.
 */
export function assessRisk(s: RiskSignals): RiskAssessment {
  const rules: FiredRule[] = [];
  const warnings: string[] = [];

  const fire = (id: string, detail: string, contributes: RiskDecision) =>
    rules.push({ id, detail, contributes });

  // --- device integrity ----------------------------------------------------
  // A compromised device is the one signal that BLOCKS outright: on a rooted
  // phone the app's own prompts can be bypassed, so asking harder achieves
  // nothing.
  if (s.deviceCompromised) {
    fire(
      "device_compromised",
      "This device appears to be rooted or modified.",
      isMoneyMoving(s.action) ? "BLOCK" : "REVIEW"
    );
  } else if (s.integrityUnknown && isMoneyMoving(s.action)) {
    // Unknown is not the same as compromised. Ask for proof, do not refuse —
    // integrity checks fail on plenty of legitimate devices (no Play Services,
    // custom ROM, offline).
    fire("integrity_unknown", "We could not verify this device.", "STEP_UP");
  }

  // --- authentication ------------------------------------------------------
  if ((s.failedAuthAttempts ?? 0) >= THRESHOLDS.maxFailedAuth) {
    fire(
      "auth_failures",
      `${s.failedAuthAttempts} failed authentication attempts.`,
      "BLOCK"
    );
  } else if ((s.failedAuthAttempts ?? 0) > 0 && isMoneyMoving(s.action)) {
    fire("recent_auth_failure", "A recent authentication attempt failed.", "STEP_UP");
  }

  // --- beneficiary ---------------------------------------------------------
  if (isMoneyMoving(s.action) && s.knownBeneficiary === false) {
    if (s.amountUsd >= THRESHOLDS.newBeneficiaryUsd) {
      fire(
        "new_beneficiary_large",
        `First payment to this destination, for ${usd(s.amountUsd)}.`,
        "STEP_UP"
      );
    }
    // Always warn, whatever the amount. Sending to the wrong address is the
    // most common way people lose money in this app, and it is irreversible.
    warnings.push(
      s.inAddressBook
        ? "You have not paid this destination before."
        : "First time paying this destination, and it is not in your address book."
    );
  }

  // --- amount anomaly ------------------------------------------------------
  // Only meaningful once the user has enough history to have a normal.
  if (
    isMoneyMoving(s.action) &&
    s.medianTransactionUsd !== undefined &&
    s.medianTransactionUsd > 0 &&
    (s.transactionsLast24h ?? 0) >= 0 &&
    (s.accountAgeDays ?? 0) >= THRESHOLDS.anomalyMinHistory &&
    s.amountUsd > s.medianTransactionUsd * THRESHOLDS.anomalyMultiple
  ) {
    fire(
      "amount_anomaly",
      `${usd(s.amountUsd)} is more than ${THRESHOLDS.anomalyMultiple}× your usual ${usd(
        s.medianTransactionUsd
      )}.`,
      "STEP_UP"
    );
  }

  // --- velocity ------------------------------------------------------------
  if ((s.transactionsLast24h ?? 0) > THRESHOLDS.velocityCount24h) {
    fire(
      "velocity_count",
      `${s.transactionsLast24h} payments in the last 24 hours.`,
      "REVIEW"
    );
  }
  if ((s.amountLast24hUsd ?? 0) + s.amountUsd > THRESHOLDS.velocityAmount24hUsd) {
    fire(
      "velocity_amount",
      `This would take you over ${usd(THRESHOLDS.velocityAmount24hUsd)} in 24 hours.`,
      "STEP_UP"
    );
  }

  // --- account standing ----------------------------------------------------
  if (
    s.accountAgeDays !== undefined &&
    s.accountAgeDays < THRESHOLDS.youngAccountDays &&
    s.amountUsd >= THRESHOLDS.youngAccountUsd &&
    isMoneyMoving(s.action)
  ) {
    fire(
      "young_account_large_amount",
      `${usd(s.amountUsd)} from an account opened ${s.accountAgeDays} day(s) ago.`,
      "REVIEW"
    );
  }

  if (s.newDevice && isMoneyMoving(s.action)) {
    fire("new_device", "This is the first payment from this device.", "STEP_UP");
  }

  // Strictest wins. Ties keep the order rules fired in.
  const decision = rules.reduce<RiskDecision>(
    (worst, r) => (SEVERITY[r.contributes] > SEVERITY[worst] ? r.contributes : worst),
    "ALLOW"
  );

  rules.sort((a, b) => SEVERITY[b.contributes] - SEVERITY[a.contributes]);

  return { decision, rules, warnings };
}

/** Actions where a wrong decision costs the user money. */
export function isMoneyMoving(a: RiskAction): boolean {
  return (
    a === "send_funds" ||
    a === "withdraw" ||
    a === "swap" ||
    a === "bank_transfer" ||
    a === "authorize_agent_spend" ||
    a === "approve_agent_transaction"
  );
}

/**
 * One sentence explaining a non-ALLOW decision.
 *
 * Leads with the most severe rule. Never says "for security reasons" — that
 * tells the user nothing and trains them to click through warnings.
 */
export function explainAssessment(a: RiskAssessment): string | null {
  if (a.decision === "ALLOW" || a.rules.length === 0) return null;
  const top = a.rules[0];
  switch (a.decision) {
    case "BLOCK":
      return `We can't complete this: ${lower(top.detail)}`;
    case "REVIEW":
      return `We need to check this first: ${lower(top.detail)}`;
    case "STEP_UP":
      return `Confirm it's you: ${lower(top.detail)}`;
    default:
      return null;
  }
}

/** Does this assessment demand authentication even for a normally-medium action? */
export function forcesStepUp(a: RiskAssessment): boolean {
  return a.decision === "STEP_UP" || a.decision === "REVIEW";
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
