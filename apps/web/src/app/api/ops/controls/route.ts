import { NextRequest } from "next/server";
import { z } from "zod";
import { requireOpsAdmin, opsOk, opsError } from "@/lib/ops/respond";
import { validateBody } from "@/lib/validate";
import { claimStepUp } from "@/lib/stepup";
import { controlSnapshot, setRailPause, setGlobalPause, RAILS, type Rail } from "@/lib/ops/controls";

export const dynamic = "force-dynamic";

// GET  /api/ops/controls — current global + per-rail pause state.
// POST /api/ops/controls — change a control. State-changing (never GET).
//   { scope: "global"|"rail", rail?, paused: bool, reason }
// A resume (paused=false) or global pause requires a typed reason (>= 8 chars)
// — the spec's "typed confirmation + reason" gate. Every change is audited
// inside setRailPause/setGlobalPause and ENFORCED at each rail's route via
// assertRailActive (durable Redis flag, cross-instance).
const ControlSchema = z
  .object({
    scope: z.enum(["global", "rail"]),
    rail: z.enum(RAILS as [Rail, ...Rail[]]).optional(),
    paused: z.boolean(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.scope !== "rail" || !!v.rail, { message: "rail is required when scope=rail" });

export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  return opsOk(await controlSnapshot());
}

export async function POST(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, ControlSchema);
  if (body instanceof Response) return body as never;

  // Reason is mandatory for anything that OPENS money flow (resume) or halts
  // everything (global pause) — the high-risk directions.
  const needsReason = body.paused === false || body.scope === "global";
  if (needsReason && (!body.reason || body.reason.trim().length < 8)) {
    return opsError("reason_required", "A reason (>= 8 chars) is required for resume or global-scope changes.", 400);
  }

  const actor = auth.account.user.id;

  // Resuming OPENS money flow, so it needs a fresh step-up (OTP/passkey) on
  // this session, consumed here so one step-up cannot be replayed into a
  // second resume. Pausing deliberately does not: stopping money in an
  // incident must never wait on re-authentication. (Finding FP-SET-10. The
  // settlement circuit breaker's own halts are not cleared here at all — only
  // through /api/ops/settlement-safety's approval workflow.)
  if (body.paused === false && !(await claimStepUp(actor, auth.claims.jti))) {
    return opsError("step_up_required", "Re-authenticate (OTP or passkey) before resuming a paused control.", 403);
  }

  const state =
    body.scope === "global"
      ? await setGlobalPause(body.paused, actor, body.reason)
      : await setRailPause(body.rail!, body.paused, actor, body.reason);

  return opsOk({ scope: body.scope, rail: body.rail ?? null, state });
}
