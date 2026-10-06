import { randomUUID } from "crypto";
import {
  approvalEvidenceBundle,
  evidenceLeafHash,
  resolveApprovalDecision,
  type ApprovalDecision,
  type EvidenceBundle,
  type PaymentPhase,
} from "@furlpay/control-plane";
import { log } from "@/lib/log";
import { AUTHORIZATION_TTL_SECONDS } from "./authorize";
import {
  findApproval,
  findAuthorization,
  findAuthorizations,
  findDecisionEvidence,
  listPendingApprovals,
  nextEvidenceSlot,
  recordApprovalDecision,
  type ApprovalRow,
  type AuthorizationRow,
} from "./store";

// ---------------------------------------------------------------------------
// Human approval of a held payment: read, decide, write as one fact.
//
// WHO MAY CALL THIS. Only a route that has authenticated a HUMAN (a session
// with a fresh step-up), never an API key. The agent that asked for the payment
// holds the API key; an approval it could grant itself is decoration.
//
// WHAT THIS ADDS TO THE PURE RULES. The rules are resolveApprovalDecision in
// @furlpay/control-plane. This file reads what they need, builds the evidence
// record from the bundle the payment was decided with, and writes through
// cp_decide_approval (migration 0030), retrying only the one failure that is
// safe to retry: a concurrent write took the evidence slot the hash commits to.
// ---------------------------------------------------------------------------

/** The actor recorded when the clock, not a person, denies a payment. */
export const TIMEOUT_ACTOR = "system:approval_timeout";

const SLOT_RETRIES = 3;

export type DecideOutcome =
  | {
      ok: true;
      replayed: boolean;
      authorizationId: string;
      phase: PaymentPhase;
      evidenceId?: string;
      executableUntil?: string;
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "already_decided"
        | "not_awaiting_approval"
        | "approval_timed_out"
        | "phase_changed"
        | "control_plane_unavailable"
        | "evidence_unavailable";
      detail: string;
    };

export async function decideApproval(input: {
  organizationId: string;
  approvalId: string;
  decision: ApprovalDecision;
  actor: string;
  stepUpHash: string | null;
  requestId: string;
  nowMs?: number;
}): Promise<DecideOutcome> {
  const nowMs = input.nowMs ?? Date.now();
  const org = input.organizationId;

  const approval = await findApproval(org, input.approvalId);
  if (!approval) return { ok: false, code: "not_found", detail: "no approval with that id" };

  // A repeat of an answer that already landed, by the same person: the client
  // lost the response. Report what is stored rather than an error.
  const repeat =
    (input.decision === "APPROVE" && approval.approved_by === input.actor) ||
    (input.decision === "DENY" && approval.denied_by === input.actor);
  if (repeat) {
    const auth = await findAuthorization(org, approval.authorization_id);
    return {
      ok: true,
      replayed: true,
      authorizationId: approval.authorization_id,
      phase: (auth?.phase ?? (input.decision === "APPROVE" ? "APPROVED" : "DENIED")) as PaymentPhase,
    };
  }

  const auth = await findAuthorization(org, approval.authorization_id);
  if (!auth) {
    return { ok: false, code: "control_plane_unavailable", detail: "the authorization behind this approval could not be read" };
  }

  const resolution = resolveApprovalDecision({
    approval: toPending(approval),
    phase: auth.phase as PaymentPhase,
    decision: input.decision,
    nowMs,
  });

  if (!resolution.ok) {
    if (resolution.timeoutTransition) {
      // The deadline passed under onTimeout DENY. Record the denial the clock
      // already made, attributed to the clock, so the payment stops appearing to
      // wait. A failure here does not change the answer to this caller.
      await write({
        org,
        approval,
        auth,
        decision: "DENY",
        actor: TIMEOUT_ACTOR,
        from: auth.phase,
        to: "DENIED",
        stepUpHash: null,
        requestId: input.requestId,
        nowMs,
      }).catch((e) =>
        log.warn("approval timeout denial not recorded", { approvalId: approval.id, error: (e as Error).message })
      );
    }
    return { ok: false, code: resolution.code, detail: resolution.detail };
  }

  const written = await write({
    org,
    approval,
    auth,
    decision: input.decision,
    actor: input.actor,
    from: resolution.from,
    to: resolution.to,
    stepUpHash: input.stepUpHash,
    requestId: input.requestId,
    nowMs,
  });
  if (!written.ok) return written;

  log.info("control-plane approval decided", {
    approvalId: approval.id,
    authorizationId: auth.id,
    organizationId: org,
    decision: input.decision,
    phase: resolution.to,
    requestId: input.requestId,
  });

  return {
    ok: true,
    replayed: written.replayed,
    authorizationId: auth.id,
    phase: resolution.to,
    evidenceId: written.evidenceId,
    executableUntil: written.executableUntil,
  };
}

async function write(args: {
  org: string;
  approval: ApprovalRow;
  auth: AuthorizationRow;
  decision: ApprovalDecision;
  actor: string;
  from: string;
  to: PaymentPhase;
  stepUpHash: string | null;
  requestId: string;
  nowMs: number;
}): Promise<
  | { ok: true; replayed: boolean; evidenceId?: string; executableUntil?: string }
  | Extract<DecideOutcome, { ok: false }>
> {
  const original = await findDecisionEvidence(args.org, args.auth.id);
  if (!original) {
    return {
      ok: false,
      code: "evidence_unavailable",
      detail: "the evidence this payment was decided with could not be read; refusing to record a decision without it",
    };
  }

  const at = new Date(args.nowMs).toISOString();
  // Approval opens a fresh execution window. Without it, a human taking longer
  // than the authorization TTL to answer would approve a payment that can no
  // longer run.
  const executableUntil =
    args.decision === "APPROVE"
      ? new Date(args.nowMs + AUTHORIZATION_TTL_SECONDS * 1000).toISOString()
      : null;

  for (let attempt = 0; attempt < SLOT_RETRIES; attempt++) {
    const slot = await nextEvidenceSlot(args.org);
    if (!slot) {
      return { ok: false, code: "control_plane_unavailable", detail: "evidence chain position unavailable" };
    }
    const bundle = approvalEvidenceBundle({
      original: original.bundle as EvidenceBundle,
      decision: args.decision,
      actor: args.actor,
      at,
      sequence: slot.sequence,
      previousLeafHash: slot.previousLeafHash,
      requestId: args.requestId,
      stepUpEvidenceHash: args.stepUpHash ?? undefined,
    });
    const evidenceId = `cpe_${randomUUID().replace(/-/g, "")}`;

    const result = await recordApprovalDecision({
      organizationId: args.org,
      approvalId: args.approval.id,
      decision: args.decision,
      actor: args.actor,
      fromPhase: args.from,
      toPhase: args.to,
      stepUpHash: args.stepUpHash,
      expiresAt: executableUntil,
      evidence: {
        id: evidenceId,
        leaf_hash: evidenceLeafHash(bundle),
        bundle,
        sequence: slot.sequence,
        previous_leaf_hash: slot.previousLeafHash,
      },
    });

    if (!result) {
      return { ok: false, code: "control_plane_unavailable", detail: "the approval could not be recorded" };
    }
    switch (result.status) {
      case "decided":
        return { ok: true, replayed: false, evidenceId: result.evidenceId, executableUntil: executableUntil ?? undefined };
      case "replayed":
        return { ok: true, replayed: true };
      case "slot_stale":
        continue;
      case "not_found":
        return { ok: false, code: "not_found", detail: "no approval with that id" };
      case "already_decided":
        return { ok: false, code: "already_decided", detail: "this approval was answered by someone else" };
      case "phase_changed":
        return {
          ok: false,
          code: "phase_changed",
          detail: `the payment moved to ${result.phase ?? "an unknown phase"} while this decision was being made`,
        };
    }
  }
  return {
    ok: false,
    code: "control_plane_unavailable",
    detail: "the evidence chain was contended on every attempt; retry the decision",
  };
}

function toPending(row: ApprovalRow) {
  return {
    approvalId: row.id,
    authorizationId: row.authorization_id,
    approverRole: row.approver_role,
    requestedAt: row.requested_at,
    timeoutSeconds: Number(row.timeout_seconds),
    onTimeout: row.on_timeout,
    approvedAt: row.approved_at,
    deniedAt: row.denied_at,
  };
}

/**
 * The approval queue a human works from.
 *
 * Each entry carries what a person needs to decide, from the stored
 * authorization: amount, asset, recipient, rail, the policy reason, and the
 * deadline. Nothing an approver could not already see on the payment.
 */
export async function pendingApprovalQueue(organizationId: string, limit = 50) {
  const approvals = await listPendingApprovals(organizationId, limit);
  if (!approvals) return null;
  const auths = await findAuthorizations(
    organizationId,
    approvals.map((a) => a.authorization_id)
  );
  if (!auths) return null;
  const byId = new Map(auths.map((a) => [a.id, a]));

  return approvals.flatMap((a) => {
    const auth = byId.get(a.authorization_id);
    // Only payments still waiting. An approval whose payment expired or was
    // denied by other means is history, not work.
    if (!auth || (auth.phase !== "PENDING_APPROVAL" && auth.phase !== "HOLD")) return [];
    const requested = Date.parse(a.requested_at);
    return [
      {
        id: a.id,
        authorizationId: a.authorization_id,
        approverRole: a.approver_role,
        requestedAt: a.requested_at,
        deadline: Number.isFinite(requested)
          ? new Date(requested + Number(a.timeout_seconds) * 1000).toISOString()
          : null,
        onTimeout: a.on_timeout,
        payment: {
          phase: auth.phase,
          amount: String(auth.amount_atomic),
          asset: auth.asset,
          currency: auth.currency,
          network: auth.network_id,
          rail: auth.rail_id,
          recipientId: auth.recipient_id,
          recipientDestination: auth.recipient_destination,
          merchantDomain: auth.merchant_domain,
          agentId: auth.agent_id,
          mandateId: auth.mandate_id,
          reason: auth.primary_reason,
          decidedAt: auth.decided_at,
        },
      },
    ];
  });
}
