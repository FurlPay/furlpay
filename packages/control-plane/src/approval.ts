// ---------------------------------------------------------------------------
// Human approval decisions: the step that lets a PENDING_APPROVAL payment move.
//
// WHY THIS IS ITS OWN FUNCTION. The lifecycle already has the APPROVE, RELEASE
// and DENY edges, and `cp_approvals` already gets a row for every decision that
// required a human. Until this existed, nothing could act on that row, so a
// payment that needed approval waited forever. This is the one place that turns
// "a human answered" into a phase transition, and like the rest of the package
// it is a pure function of values handed to it: the caller reads the approval
// row, the authorization's phase and the clock, and this decides.
//
// THE RULES, each of which a test attacks:
//
//   1. An approval is decided at most once. A second answer, even the same one,
//      is not a new fact. The store reports a same-actor, same-decision repeat
//      as a replay; this function refuses everything else.
//   2. Only PENDING_APPROVAL and HOLD are waiting on a human. Approving an
//      EXECUTING, SETTLED or DENIED payment is refused rather than recorded.
//   3. A late APPROVE is refused when the timeout action is DENY. "Nobody
//      answered in time" must not turn into ALLOW because somebody answered
//      after the deadline. A late APPROVE under onTimeout HOLD is accepted,
//      because HOLD means "keep waiting for a human" and this is that human.
//   4. DENY is always accepted while the payment is still waiting. Refusing a
//      denial would keep a payment alive that a human has said must not run.
// ---------------------------------------------------------------------------

import { canTransitionPhase, resolveEscalation, type ApprovalTimeoutAction, type PaymentPhase, type PaymentPhaseEvent } from "./lifecycle";
import type { EvidenceBundle } from "./evidence";

export type ApprovalDecision = "APPROVE" | "DENY";

/** The stored approval row, as the caller read it. */
export interface PendingApprovalState {
  readonly approvalId: string;
  readonly authorizationId: string;
  readonly approverRole: string;
  readonly requestedAt: string;
  readonly timeoutSeconds: number;
  readonly onTimeout: ApprovalTimeoutAction;
  readonly approvedAt?: string | null;
  readonly deniedAt?: string | null;
}

export interface ApprovalDecisionRequest {
  readonly approval: PendingApprovalState;
  /** The authorization's current phase, read in the same request. */
  readonly phase: PaymentPhase;
  readonly decision: ApprovalDecision;
  readonly nowMs: number;
}

export type ApprovalRefusal =
  | "already_decided"
  | "not_awaiting_approval"
  | "approval_timed_out";

export type ApprovalResolution =
  | {
      readonly ok: true;
      readonly event: Extract<PaymentPhaseEvent, "APPROVE" | "RELEASE" | "DENY">;
      readonly from: PaymentPhase;
      readonly to: PaymentPhase;
    }
  | {
      readonly ok: false;
      readonly code: ApprovalRefusal;
      readonly detail: string;
      /**
       * Set when the refusal is a timeout whose action is DENY. The caller
       * should record it, so the payment stops looking like it is waiting.
       */
      readonly timeoutTransition?: { readonly event: "DENY"; readonly to: "DENIED" };
    };

const TARGET: Record<"APPROVE" | "RELEASE" | "DENY", PaymentPhase> = {
  APPROVE: "APPROVED",
  RELEASE: "APPROVED",
  DENY: "DENIED",
};

export function resolveApprovalDecision(req: ApprovalDecisionRequest): ApprovalResolution {
  const { approval, phase, decision, nowMs } = req;

  if (approval.approvedAt || approval.deniedAt) {
    return {
      ok: false,
      code: "already_decided",
      detail: approval.approvedAt
        ? `approval ${approval.approvalId} was already approved at ${approval.approvedAt}`
        : `approval ${approval.approvalId} was already denied at ${approval.deniedAt}`,
    };
  }

  if (phase !== "PENDING_APPROVAL" && phase !== "HOLD") {
    return {
      ok: false,
      code: "not_awaiting_approval",
      detail: `a payment in phase ${phase} is not waiting on a human decision`,
    };
  }

  if (decision === "APPROVE") {
    const escalation = resolveEscalation(
      {
        requestedAt: approval.requestedAt,
        policy: {
          approverRole: approval.approverRole,
          timeoutSeconds: approval.timeoutSeconds,
          onTimeout: approval.onTimeout,
        },
      },
      nowMs
    );
    if (escalation.action === "DENY") {
      return {
        ok: false,
        code: "approval_timed_out",
        detail: escalation.detail,
        timeoutTransition: { event: "DENY", to: "DENIED" },
      };
    }
  }

  const event: "APPROVE" | "RELEASE" | "DENY" =
    decision === "DENY" ? "DENY" : phase === "HOLD" ? "RELEASE" : "APPROVE";

  // The lifecycle owns legality. Every pair reaching here is legal today; this
  // keeps it that way if an edge is ever removed.
  if (!canTransitionPhase(phase, event)) {
    return {
      ok: false,
      code: "not_awaiting_approval",
      detail: `the lifecycle has no ${event} edge from ${phase}`,
    };
  }

  return { ok: true, event, from: phase, to: TARGET[event] };
}

/**
 * The evidence record for a human decision.
 *
 * It is the authorization's own bundle, carried forward with the approval
 * section filled in and a new chain position. Reusing the original bundle means
 * the existing evidence reader and `verifyLeaf` handle it unchanged, and that an
 * auditor reading the approval sees the exact amount, recipient and mandate the
 * human was shown, not a summary of them.
 */
export function approvalEvidenceBundle(input: {
  readonly original: EvidenceBundle;
  readonly decision: ApprovalDecision;
  readonly actor: string;
  readonly at: string;
  readonly sequence: number;
  readonly previousLeafHash: string | null;
  readonly requestId: string;
  /** Hash of the step-up proof, never the proof itself. */
  readonly stepUpEvidenceHash?: string;
}): EvidenceBundle {
  const { original } = input;
  return {
    ...original,
    event: "approval_decision",
    sequence: input.sequence,
    previousLeafHash: input.previousLeafHash,
    approval: {
      ...original.approval,
      required: true,
      ...(input.decision === "APPROVE"
        ? { approvedBy: input.actor, approvedAt: input.at }
        : { deniedBy: input.actor, deniedAt: input.at }),
      approvalEvidenceHash: input.stepUpEvidenceHash,
    },
    trace: { requestId: input.requestId },
  };
}
