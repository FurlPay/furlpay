// ---------------------------------------------------------------------------
// The control-plane payment lifecycle.
//
// WHY A SEPARATE STATE MACHINE FROM lib/paymentStateMachine.ts. That one models
// a SETTLEMENT (created → pending → processing → completed): the states a
// transaction passes through once it has been decided. This one models the
// DECISION, which has states the settlement machine has no vocabulary for —
// PENDING_APPROVAL, HOLD, DENIED — and which must exist before any rail is
// touched. Collapsing the two is how "waiting for a human" ends up encoded as
// "pending", at which point nothing distinguishes a payment waiting for an
// approver from one waiting for a block.
//
// THE INVARIANT THIS FILE EXISTS TO MAKE UNREPRESENTABLE:
//
//     A payment that required human approval can never settle without it.
//
// Edges alone cannot express that. `AUTHORIZED → EXECUTING` is a legal edge and
// must stay one, so a payment that skipped PENDING_APPROVAL while requiring
// approval would traverse only legal edges to SETTLED. The guard is therefore on
// the RECORD, not the edge: `applyEvent` refuses EXECUTE on a payment whose
// `approvalRequired` flag is set and whose `approvedAt` is not. Both halves are
// enforced here so no call site can be the one that forgets.
//
// TIMEOUT IS FAIL-CLOSED, AND THE TYPE SAYS SO. `onTimeout` is `"HOLD" | "DENY"`
// — there is no third option, so an approval that nobody answered cannot resolve
// to ALLOW by any code path, including a future one written by someone who has
// not read this comment.
//
// PURE. Timestamps are passed in. Every branch is testable without a clock.
// ---------------------------------------------------------------------------

/** The decision states, exactly as the architecture specifies them. */
export type PaymentPhase =
  /** Authorization passed; no human needed; not yet executed. */
  | "AUTHORIZED"
  /** A policy rule requires a human; the clock is running. */
  | "PENDING_APPROVAL"
  /** A human said yes. */
  | "APPROVED"
  /** Refused. Terminal. */
  | "DENIED"
  /** The authorization window closed before execution. Terminal. */
  | "EXPIRED"
  /** Parked: risk or an unanswered approval. Recoverable by a human. */
  | "HOLD"
  /** Handed to the signing plane and the rail. */
  | "EXECUTING"
  /** Settled on a rail and recorded. Terminal except for reversal. */
  | "SETTLED"
  /** Execution failed without moving value. Terminal. */
  | "FAILED"
  /** Settled and then compensated. Terminal. */
  | "REVERSED";

export type PaymentPhaseEvent =
  | "AUTHORIZE"
  | "REQUIRE_APPROVAL"
  | "APPROVE"
  | "DENY"
  | "HOLD"
  | "RELEASE"
  | "EXPIRE"
  | "EXECUTE"
  | "SETTLE"
  | "FAIL"
  | "REVERSE";

/**
 * Legal edges. Anything absent is illegal and throws.
 *
 * Read the two rows that carry the weight:
 *
 *   PENDING_APPROVAL has APPROVE, DENY, HOLD and EXPIRE — and no EXECUTE. A
 *   payment waiting on a human cannot be executed from that state at all.
 *
 *   HOLD has RELEASE (to APPROVED, which records that a human acted), DENY and
 *   EXPIRE — and no EXECUTE either. Releasing a hold is a human decision that
 *   lands in APPROVED, so the approval guard downstream sees it.
 */
const EDGES: Record<PaymentPhase, Partial<Record<PaymentPhaseEvent, PaymentPhase>>> = {
  AUTHORIZED: { EXECUTE: "EXECUTING", EXPIRE: "EXPIRED", HOLD: "HOLD", DENY: "DENIED" },
  PENDING_APPROVAL: { APPROVE: "APPROVED", DENY: "DENIED", HOLD: "HOLD", EXPIRE: "EXPIRED" },
  APPROVED: { EXECUTE: "EXECUTING", EXPIRE: "EXPIRED", DENY: "DENIED" },
  HOLD: { RELEASE: "APPROVED", DENY: "DENIED", EXPIRE: "EXPIRED" },
  EXECUTING: { SETTLE: "SETTLED", FAIL: "FAILED" },
  SETTLED: { REVERSE: "REVERSED" },
  DENIED: {},
  EXPIRED: {},
  FAILED: {},
  REVERSED: {},
};

const TERMINAL: ReadonlySet<PaymentPhase> = new Set(["DENIED", "EXPIRED", "FAILED", "REVERSED"]);

export function isTerminalPhase(phase: PaymentPhase): boolean {
  return TERMINAL.has(phase);
}

export function canTransitionPhase(from: PaymentPhase, event: PaymentPhaseEvent): boolean {
  return EDGES[from]?.[event] !== undefined;
}

export class LifecycleError extends Error {
  constructor(
    message: string,
    readonly code:
      | "illegal_transition"
      | "approval_not_satisfied"
      | "approval_timeout_would_allow"
      | "already_settled"
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}

export interface PhaseTransition {
  readonly event: PaymentPhaseEvent;
  readonly from: PaymentPhase;
  readonly to: PaymentPhase;
  readonly at: string;
  readonly actor: string;
  readonly reason?: string;
}

/** The part of a payment this machine reads and writes. */
export interface LifecycleRecord {
  phase: PaymentPhase;
  /** Set at authorization time when a policy rule demanded a human. */
  readonly approvalRequired: boolean;
  approvedAt?: string;
  approvedBy?: string;
  deniedAt?: string;
  history: PhaseTransition[];
  updatedAt: string;
}

export interface ApplyEventInput {
  readonly record: LifecycleRecord;
  readonly event: PaymentPhaseEvent;
  readonly at: string;
  readonly actor: string;
  readonly reason?: string;
}

/**
 * Advance a payment. Throws on an illegal transition or a violated invariant.
 *
 * Mutates and returns the record, matching lib/paymentStateMachine.ts so the two
 * read the same way at call sites.
 */
export function applyPhaseEvent(input: ApplyEventInput): LifecycleRecord {
  const { record, event, at, actor } = input;
  const from = record.phase;
  const to = EDGES[from]?.[event];
  if (!to) {
    throw new LifecycleError(
      `Illegal control-plane transition: ${from} + ${event}`,
      "illegal_transition"
    );
  }

  // THE RECORD-LEVEL GUARD. An approval-requiring payment must carry evidence a
  // human acted before it may be executed. `approvedAt` is set only by the
  // APPROVE and RELEASE edges below, both of which name an actor.
  if (event === "EXECUTE" && record.approvalRequired && !record.approvedAt) {
    throw new LifecycleError(
      "This payment required human approval and none is recorded. Execution is refused: " +
        "a missing approval must never resolve to ALLOW.",
      "approval_not_satisfied"
    );
  }

  if (event === "APPROVE" || event === "RELEASE") {
    record.approvedAt = at;
    record.approvedBy = actor;
  }
  if (event === "DENY") {
    record.deniedAt = at;
  }

  record.history.push({ event, from, to, at, actor, reason: input.reason });
  record.phase = to;
  record.updatedAt = at;
  return record;
}

// ── Approval escalation ────────────────────────────────────────────────────

/**
 * What happens when nobody answers.
 *
 * TWO VALUES, NEITHER OF THEM ALLOW. This is the type-level expression of the
 * fail-closed rule, and it is more durable than a comment: there is no
 * `"ALLOW"` to select, so no future edit can select it by accident.
 */
export type ApprovalTimeoutAction = "HOLD" | "DENY";

export interface EscalationPolicy {
  readonly approverRole: string;
  readonly timeoutSeconds: number;
  readonly onTimeout: ApprovalTimeoutAction;
}

export interface EscalationState {
  readonly requestedAt: string;
  readonly policy: EscalationPolicy;
  readonly notifiedAt?: string;
}

export type EscalationOutcome =
  | { readonly action: "wait"; readonly remainingSeconds: number }
  | { readonly action: "HOLD"; readonly detail: string }
  | { readonly action: "DENY"; readonly detail: string };

/**
 * Resolve an outstanding approval against the clock.
 *
 * An unparseable `requestedAt` resolves to the configured timeout action rather
 * than to `wait`. A corrupt timestamp must not produce an approval request that
 * waits forever, because "forever" is where a payment sits un-acted-upon while
 * both the customer and the approver believe the other is handling it.
 */
export function resolveEscalation(state: EscalationState, nowMs: number): EscalationOutcome {
  const requested = Date.parse(state.requestedAt);
  if (!Number.isFinite(requested)) {
    return {
      action: state.policy.onTimeout,
      detail: `approval requestedAt is unparseable (${state.requestedAt}); applying the fail-closed timeout action`,
    };
  }
  const deadline = requested + state.policy.timeoutSeconds * 1000;
  if (nowMs < deadline) {
    return { action: "wait", remainingSeconds: Math.ceil((deadline - nowMs) / 1000) };
  }
  return {
    action: state.policy.onTimeout,
    detail:
      `no ${state.policy.approverRole} answered within ${state.policy.timeoutSeconds}s; ` +
      `resolving to ${state.policy.onTimeout} because an unanswered approval is not an approval`,
  };
}

/** The event that carries a timeout outcome into the machine. */
export function eventForTimeout(action: ApprovalTimeoutAction): PaymentPhaseEvent {
  return action === "HOLD" ? "HOLD" : "DENY";
}

/** A fresh record in the phase the authorization decision produced. */
export function newLifecycleRecord(input: {
  readonly phase: Extract<PaymentPhase, "AUTHORIZED" | "PENDING_APPROVAL" | "HOLD" | "DENIED">;
  readonly approvalRequired: boolean;
  readonly at: string;
  readonly actor: string;
  readonly reason?: string;
}): LifecycleRecord {
  return {
    phase: input.phase,
    approvalRequired: input.approvalRequired,
    updatedAt: input.at,
    history: [
      {
        event:
          input.phase === "AUTHORIZED"
            ? "AUTHORIZE"
            : input.phase === "PENDING_APPROVAL"
              ? "REQUIRE_APPROVAL"
              : input.phase === "HOLD"
                ? "HOLD"
                : "DENY",
        from: input.phase,
        to: input.phase,
        at: input.at,
        actor: input.actor,
        reason: input.reason,
      },
    ],
  };
}

/** Project a control-plane phase onto the settlement machine's vocabulary, for
 *  surfaces that already speak it. Lossy by design — see the module header. */
export function toSettlementStatus(phase: PaymentPhase): "pending" | "processing" | "settled" | "failed" {
  switch (phase) {
    case "EXECUTING":
      return "processing";
    case "SETTLED":
      return "settled";
    case "DENIED":
    case "EXPIRED":
    case "FAILED":
    case "REVERSED":
      return "failed";
    default:
      return "pending";
  }
}
