import { NextRequest } from "next/server";
import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { recentStepUp, consumeStepUp } from "@/lib/stepup";
import { audit } from "@/lib/audit";
import { requireHumanTenant, ok, problem, notFound } from "@/lib/controlPlane/tenancy";
import { decideApproval } from "@/lib/controlPlane/approvals";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/control-plane/approvals/:id — a human approves or denies a held
// payment.
//
// THREE THINGS MUST BE TRUE, in this order:
//   1. A signed-in human, never an API key (requireHumanTenant).
//   2. A fresh step-up on THIS session. A stolen session cookie alone must not
//      be enough to release money; the step-up is bound to the session's jti
//      and consumed on success, so one ceremony approves one payment.
//   3. The pure rules agree (resolveApprovalDecision): not already answered,
//      still waiting, and not an APPROVE after a DENY-on-timeout deadline.
//
// DENY needs the same step-up. Denying is the safe direction for money, but an
// attacker who can deny at will can block every payment a company makes.
// ---------------------------------------------------------------------------

const STEP_UP_WINDOW_MS = 5 * 60_000;

const Body = z
  .object({
    decision: z.enum(["APPROVE", "DENY"]),
    /** Free text for the audit log. Never shown to the agent. */
    note: z.string().max(500).optional(),
  })
  .strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "cp.approvals.decide", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const tenant = await requireHumanTenant(req);
  if (!tenant.ok) return tenant.res;

  const body = await validateBody(req, Body);
  if (body instanceof Response) return body;

  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return notFound("approval");

  const { userId, jti, organizationId } = tenant.tenant;
  if (!(await recentStepUp(userId, jti, STEP_UP_WINDOW_MS))) {
    return problem(401, "step_up_required", {
      message: "Approving or denying a payment requires re-verifying with your passkey or a one-time code.",
      action: { type: "step_up", methods: ["passkey", "otp"] },
    });
  }

  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const outcome = await decideApproval({
    organizationId,
    approvalId: id,
    decision: body.decision,
    actor: userId,
    // Commits to the session that stepped up without disclosing its id.
    stepUpHash: createHash("sha256")
      .update(`furlpay/approval-step-up/v1\n${userId}\n${jti ?? ""}`)
      .digest("hex"),
    requestId,
  });

  if (!outcome.ok) {
    switch (outcome.code) {
      case "not_found":
        return notFound("approval");
      case "already_decided":
      case "not_awaiting_approval":
      case "approval_timed_out":
      case "phase_changed":
        return problem(409, outcome.code, { message: outcome.detail });
      default:
        return problem(503, outcome.code, { message: outcome.detail });
    }
  }

  // One step-up, one decision. A replay changed nothing, so it consumes nothing.
  if (!outcome.replayed) await consumeStepUp(userId, jti);

  audit(body.decision === "APPROVE" ? "control_plane.approval.approved" : "control_plane.approval.denied", userId, {
    approvalId: id,
    authorizationId: outcome.authorizationId,
    organizationId,
    replayed: outcome.replayed,
    ...(body.note ? { note: body.note } : {}),
  });

  return ok({
    approvalId: id,
    authorizationId: outcome.authorizationId,
    decision: body.decision,
    phase: outcome.phase,
    replayed: outcome.replayed,
    evidenceId: outcome.evidenceId ?? null,
    // The agent must execute before this, or ask again.
    executableUntil: outcome.executableUntil ?? null,
  });
}
