import { NextRequest } from "next/server";
import { z } from "zod";
import { requireOpsAdmin, opsOk, opsError } from "@/lib/ops/respond";
import { validateBody } from "@/lib/validate";
import { consumeStepUp, recentStepUp } from "@/lib/stepup";
import {
  approveRecovery,
  autoHaltMode,
  markMitigated,
  networkScope,
  POLICY_VERSION,
  readScope,
  requiredApprovals,
  transitionHistory,
  trip,
  type RecoveryChecks,
  type SafetyScope,
} from "@/lib/settlementSafety";
import { evaluateChainHealth, probeChain } from "@/lib/settlementDetectors";
import { reconcileNetwork } from "@/lib/settlementReconcile";
import { checkSettlementOnChain } from "@/lib/x402Settler";
import { EVM_CHAIN_IDS } from "@/lib/x402Signature";
import { rpcUrl } from "@/lib/x402Chains";

export const dynamic = "force-dynamic";

// GET  /api/ops/settlement-safety — state of every scope, mode, recent transitions.
// POST /api/ops/settlement-safety — one of:
//   { action: "halt",     scope, reason }                — manual halt (critical)
//   { action: "mitigate", scope, incidentId, notes }     — HALTED → RECOVERY_PENDING
//   { action: "approve",  scope, incidentId, evidence }  — one recovery approval
//
// Every action requires the ops admin role. mitigate and approve also require a
// recent step-up (OTP/passkey) on THIS session, and each approval consumes it,
// so one step-up cannot be replayed into several approvals. Recovery checks —
// chain health and reconciliation — are re-run server-side on every mitigate
// and approve; the client cannot assert them. There is no force/override
// action: the only way back to NORMAL is approveRecovery's checks + approvals.

const NETWORKS = Object.keys(EVM_CHAIN_IDS);
const ScopeSchema = z
  .string()
  .refine((s) => s === "global" || (s.startsWith("network:") && NETWORKS.includes(s.slice(8))), "unknown scope");

const ActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("halt"),
    scope: ScopeSchema,
    reason: z.string().trim().min(8).max(500),
    // critical (default) needs two distinct approvers to resume; high needs one.
    severity: z.enum(["high", "critical"]).default("critical"),
  }),
  z.object({
    action: z.literal("mitigate"),
    scope: ScopeSchema,
    incidentId: z.string().regex(/^inc_[0-9a-f-]{36}$/),
    notes: z.string().trim().min(20).max(2000),
  }),
  z.object({
    action: z.literal("approve"),
    scope: ScopeSchema,
    incidentId: z.string().regex(/^inc_[0-9a-f-]{36}$/),
    evidence: z.string().trim().min(8).max(2000),
  }),
]);

export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  try {
    const scopes: SafetyScope[] = ["global", ...NETWORKS.map(networkScope)];
    const records = await Promise.all(scopes.map((s) => readScope(s)));
    return opsOk({
      mode: autoHaltMode(),
      policyVersion: POLICY_VERSION,
      scopes: records.map((r) => ({ ...r, requiredApprovals: r.state === "NORMAL" ? null : requiredApprovals(r.severity) })),
      history: await transitionHistory(100),
    });
  } catch {
    // Unreadable state is itself the most important thing to show: the
    // settler is refusing everything while this is true.
    return opsError("control_plane_unavailable", "Settlement safety state could not be read; all settlement is refused until it can.", 503);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const body = await validateBody(req, ActionSchema);
  if (body instanceof Response) return body as never;
  const actor = auth.account.user.id;
  const scope = body.scope as SafetyScope;

  if (body.action === "halt") {
    const rec = await trip({ scope, signal: "manual_halt", severity: body.severity ?? "critical", evidence: { reason: body.reason }, actor });
    return opsOk({ record: rec });
  }

  if (!(await recentStepUp(actor, auth.claims.jti))) {
    return opsError("step_up_required", "Re-authenticate (OTP or passkey) before changing settlement safety state.", 403);
  }

  const checks = await recoveryChecks(scope);
  const result =
    body.action === "mitigate"
      ? await markMitigated(scope, actor, body.notes, checks, body.incidentId)
      : await approveRecovery(scope, actor, body.evidence, checks, body.incidentId);
  if (body.action === "approve") await consumeStepUp(actor, auth.claims.jti);

  if (!result.ok) {
    const status = result.code === "awaiting_approvals" ? 202 : 409;
    return opsOk({ ok: false, code: result.code, message: result.message, record: result.record ?? null, checks }, status);
  }
  return opsOk({ record: result.record, checks });
}

/** Networks a global recovery must check: those this deployment settles on,
 *  i.e. with an RPC configured. Probing every chain we know of would let one
 *  flaky public endpoint for a chain we never use block recovery forever. */
function settlementNetworks(): string[] {
  const configured = NETWORKS.filter((n) => !!rpcUrl(n));
  return configured.length ? configured : ["arbitrum"];
}

/** Re-run chain health and reconciliation for the scope's networks, now. */
async function recoveryChecks(scope: SafetyScope): Promise<RecoveryChecks> {
  const networks = scope === "global" ? settlementNetworks() : [scope.slice(8)];
  const detail: Record<string, unknown> = {};
  let healthy = true;
  let unresolved = 0;
  const now = Date.now();
  for (const n of networks) {
    const findings = evaluateChainHealth(n, await probeChain(n), Math.floor(now / 1000));
    const recon = await reconcileNetwork(n, checkSettlementOnChain, now);
    const blocking = findings.filter((f) => f.action !== "report").map((f) => f.signal);
    if (blocking.length || recon.reorged.length || recon.errors) healthy = false;
    unresolved += recon.stillPending.length;
    detail[n] = { findings: findings.map((f) => f.signal), reorged: recon.reorged.length, rpcErrors: recon.errors, unresolved: recon.stillPending.length };
  }
  return { healthy, unresolvedSettlements: unresolved, detail };
}
