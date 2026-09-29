import { randomUUID } from "crypto";
import {
  assessDrift,
  authorityScopeOf,
  driftConfigFor,
  evaluatePolicy,
  evidenceLeafHash,
  authorityScopeHash,
  mandateLiveness,
  mandateSigningPayload,
  newLifecycleRecord,
  evaluateRevocation,
  resolveAuthority,
  subjectsForPayment,
  parseAtomic,
  DEFAULT_MAX_STALENESS_MS,
  CONTROL_PLANE_POLICY_VERSION,
  type EvidenceBundle,
  type IntentMandate,
  type PolicyDecision,
  type PolicyDocument,
  type RecipientVerdict,
  type SequenceEntry,
} from "@furlpay/control-plane";
import { financialEnvironment } from "@/lib/flags";
import { log } from "@/lib/log";
import { revocationLookup } from "./revocationAdapter";
import {
  assertControlPlaneDurable,
  findMandate,
  loadAgentHistory,
  loadChain,
  nextEvidenceSlot,
  recordDecision,
  type AuthorizationRow,
} from "./store";

// ---------------------------------------------------------------------------
// The authorization service: where the pure control plane becomes reachable.
//
// WHAT THIS FILE IS, AND WHAT IT MUST NEVER BECOME. It is PLUMBING. It reads the
// chain, the revocation snapshot, the mandate and the payment history, hands all
// of it to `evaluatePolicy`, and writes down what came back. It contains no
// policy of its own, and that is the whole design: the moment a route or a
// service makes its own allow/deny judgement there are two policy engines, they
// disagree under some input nobody enumerated, and the one that matters is
// whichever the attacker reaches.
//
// So the rule enforced by construction below: every gate is a REQUIRED argument
// to `evaluatePolicy`. There is no shape of this call in which a check was
// skipped and the payment was allowed anyway — a missing input is a type error,
// not a silent pass.
//
// ORDER OF THE READS IS ORDER OF COST, NOT ORDER OF IMPORTANCE. Durability and
// revocation come first because they are the cheapest refusals and the most
// consequential; the drift history is the most expensive read and is done last,
// after the chain has already proven it resolves.
//
// AN LLM IS NOT ON THIS PATH. The agent proposes a payment by calling the API.
// Everything from here is arithmetic over values.
// ---------------------------------------------------------------------------

export interface AuthorizeRequest {
  readonly organizationId: string;
  readonly mandateId: string;
  readonly agentId: string;
  readonly sessionId?: string;
  /** Integer atomic units as a decimal string. Parsed strictly, never coerced. */
  readonly amountAtomic: string;
  readonly asset: string;
  readonly currency: string;
  readonly networkId: string;
  readonly railId: string;
  readonly recipientId: string;
  readonly recipientDestination?: string;
  readonly merchantDomain?: string;
  readonly category?: string;
  readonly jurisdiction?: string;
  readonly resource?: string;
  readonly idempotencyKey?: string;
  /** Recipient verification verdict, produced by the caller's verifier. */
  readonly recipient: RecipientVerdict;
  readonly policies: readonly PolicyDocument[];
  /** True when a valid human approval is already recorded for this payment. */
  readonly approvalPresent?: boolean;
  readonly railIsNew?: boolean;
  readonly requestId: string;
}

export type AuthorizeOutcome =
  | {
      readonly ok: true;
      readonly authorizationId: string;
      readonly evidenceId: string;
      readonly decision: PolicyDecision;
      readonly phase: "AUTHORIZED" | "PENDING_APPROVAL" | "HOLD" | "DENIED";
      readonly expiresAt: string;
      readonly payloadHash: string;
    }
  | {
      readonly ok: false;
      /** Stable machine-readable code. Never a raw exception message. */
      readonly code: AuthorizeFailure;
      readonly detail: string;
    };

export type AuthorizeFailure =
  | "control_plane_unavailable"
  | "amount_invalid"
  | "mandate_not_found"
  | "chain_unresolved"
  | "revocation_unavailable"
  | "history_unavailable"
  | "evidence_slot_unavailable"
  | "write_failed";

/** How long an ALLOW stays executable. Short on purpose: an authorization is a
 *  statement about a moment, and the longer it is valid the more the world can
 *  change beneath it. Execution re-checks everything regardless. */
const AUTHORIZATION_TTL_SECONDS = 300;

/**
 * Canonical hash of what execution is permitted to submit.
 *
 * Binding execution to this is what stops the approved thing and the executed
 * thing diverging: `/execute` recomputes it from ITS request and refuses a
 * mismatch, so altering the amount or the recipient after approval produces a
 * different hash rather than a different payment.
 */
export function executionPayloadHash(input: {
  organizationId: string;
  mandateId: string;
  agentId: string;
  amountAtomic: string;
  asset: string;
  networkId: string;
  railId: string;
  recipientId: string;
  recipientDestination?: string;
  resource?: string;
}): string {
  return authorityScopeHash({
    v: 1,
    organizationId: input.organizationId,
    mandateId: input.mandateId,
    agentId: input.agentId,
    amountAtomic: input.amountAtomic,
    asset: input.asset.toUpperCase(),
    networkId: input.networkId,
    railId: input.railId,
    recipientId: input.recipientId,
    recipientDestination: (input.recipientDestination ?? "").toLowerCase(),
    resource: input.resource ?? "",
  });
}

/**
 * Decide whether a payment may proceed, and write down why.
 *
 * Returns a DECISION, never a payment. Execution is a separate call, because an
 * agent proposing and the control plane deciding are different acts and
 * collapsing them removes the place where a human can be asked.
 */
export async function authorizePayment(req: AuthorizeRequest): Promise<AuthorizeOutcome> {
  // 1. Durability. An authorization decided against a store that does not exist
  //    cannot be revoked tomorrow and cannot be explained afterwards.
  try {
    assertControlPlaneDurable("payment authorization");
  } catch (e) {
    return { ok: false, code: "control_plane_unavailable", detail: (e as Error).message };
  }

  // 2. Amount, parsed strictly. F-9: BigInt() accepts "0x10" as sixteen.
  const amount = parseAtomic(req.amountAtomic);
  if (amount === null || amount <= 0n) {
    return {
      ok: false,
      code: "amount_invalid",
      detail: "amount must be a positive integer number of the asset's minor units",
    };
  }

  // 3. The chain. Loaded whole; `resolveAuthority` decides what a missing link
  //    means, and it treats one as a denial rather than a skip.
  const chain = await loadChain({
    organizationId: req.organizationId,
    agentId: req.agentId,
    sessionId: req.sessionId,
  });
  if (!chain) {
    return { ok: false, code: "control_plane_unavailable", detail: "chain store unavailable" };
  }

  const nowMs = Date.now();
  const authority = resolveAuthority({
    principal: chain.principal,
    delegation: chain.delegation,
    operator: chain.operator,
    agent: chain.agent,
    session: chain.session,
    nowMs,
    // Production requires a verified principal; a sandbox organization
    // legitimately has not completed verification and refusing there would make
    // the sandbox untestable.
    requireVerifiedPrincipal: financialEnvironment() === "production",
  });
  if (!authority.ok) {
    return {
      ok: false,
      code: "chain_unresolved",
      detail: `${authority.break}: ${authority.detail}`,
    };
  }

  // 4. The mandate. Tenant-scoped by the store, so a mandate belonging to
  //    another organization simply is not found.
  const mandate = await findMandate(req.organizationId, req.mandateId);
  if (!mandate) {
    return { ok: false, code: "mandate_not_found", detail: "no such mandate for this organization" };
  }

  // 5. Live revocation. The lookup fails closed on its own; the engine turns a
  //    failed or stale lookup into a denial.
  const lookup = await revocationLookup(req.organizationId);
  const revocation = evaluateRevocation({
    lookup,
    subjects: subjectsForPayment({
      organizationId: req.organizationId,
      principalId: authority.authority.principalId,
      delegationId: authority.authority.delegationId,
      operatorId: authority.authority.operatorId,
      agentId: authority.authority.agentId,
      sessionId: authority.authority.sessionId,
      mandateId: mandate.mandateId,
      recipientId: req.recipientId,
    }),
    organizationId: req.organizationId,
    nowMs,
    maxStalenessMs: DEFAULT_MAX_STALENESS_MS,
  });

  // 6. Sequence history for the drift engine, bounded by the mandate's own
  //    window so the read cannot be made arbitrarily expensive.
  const windowSeconds = mandate.authorityScope.spendingWindowSeconds;
  const sinceIso = new Date(nowMs - windowSeconds * 1000).toISOString();
  const history = await loadAgentHistory({
    organizationId: req.organizationId,
    agentId: authority.authority.agentId,
    sinceIso,
  });
  if (history === null) {
    // Cannot see the sequence. Every cumulative control depends on it, so this
    // is a refusal rather than an evaluation against an empty history — an
    // empty history reads as "nothing spent yet", which is the attacker's
    // preferred answer.
    return {
      ok: false,
      code: "history_unavailable",
      detail: "payment history unavailable; cumulative and drift controls cannot be evaluated",
    };
  }

  const sequence: SequenceEntry[] = history.map((row) => ({
    paymentId: row.id,
    atMs: Date.parse(row.decided_at),
    amountAtomic: String(row.amount_atomic),
    recipientKey: row.recipient_id,
    merchantDomain: row.merchant_domain ?? undefined,
    railId: row.rail_id,
    // Only money that actually moved counts. A declined authorization spent
    // nothing, and counting it would let an attacker lock a victim out by
    // stacking denials — the rule velocity.ts and policyEngine.ts already state.
    settled: row.phase === "SETTLED",
  }));

  const windowSpent = sequence
    .filter((e) => e.settled)
    .reduce((total, e) => total + (parseAtomic(e.amountAtomic) ?? 0n), 0n);

  const drift = assessDrift({
    candidate: {
      amountAtomic: req.amountAtomic,
      recipientKey: req.recipientId,
      merchantDomain: req.merchantDomain,
      category: req.category,
      railId: req.railId,
    },
    history: sequence,
    config: driftConfigFor({
      cumulativeCapAtomic: mandate.authorityScope.maxCumulativeAtomic,
      windowSeconds,
      approvalThresholdAtomic: mandate.authorityScope.requireHumanApprovalAboveAtomic,
    }),
    nowMs,
  });

  // 7. THE DECISION. Every gate above is a required argument, so none can be
  //    absent. This is the only place a verdict is produced.
  const decision = evaluatePolicy({
    authority: authority.authority,
    mandate,
    mandateLiveness: mandateLiveness(mandate, nowMs),
    revocation,
    recipient: req.recipient,
    drift,
    policies: req.policies,
    candidate: {
      amountAtomic: req.amountAtomic,
      asset: req.asset,
      currency: req.currency,
      networkId: req.networkId,
      railId: req.railId,
      recipientId: req.recipientId,
      merchantDomain: req.merchantDomain,
      category: req.category,
      jurisdiction: req.jurisdiction,
    },
    exposure: {
      // Window figures are derived from the same sequence the drift engine saw,
      // so the two cannot disagree about how much has been spent.
      hourlyAtomic: sumSince(sequence, nowMs, 3600),
      dailyAtomic: sumSince(sequence, nowMs, 86_400),
      monthlyAtomic: sumSince(sequence, nowMs, 30 * 86_400),
      mandateWindowAtomic: windowSpent.toString(),
    },
    approvalPresent: req.approvalPresent ?? false,
    railIsNew: req.railIsNew ?? false,
    nowMs,
  });

  // 8. Phase follows the verdict. DENY is terminal; HOLD is recoverable;
  //    an approval requirement parks it for a human.
  const phase =
    decision.verdict === "DENY"
      ? "DENIED"
      : decision.verdict === "HOLD"
        ? decision.requiresApproval
          ? "PENDING_APPROVAL"
          : "HOLD"
        : "AUTHORIZED";

  const authorizationId = `cpa_${randomUUID().replace(/-/g, "")}`;
  const evidenceId = `cpe_${randomUUID().replace(/-/g, "")}`;
  const decidedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + AUTHORIZATION_TTL_SECONDS * 1000).toISOString();

  const payloadHash = executionPayloadHash({
    organizationId: req.organizationId,
    mandateId: mandate.mandateId,
    agentId: authority.authority.agentId,
    amountAtomic: req.amountAtomic,
    asset: req.asset,
    networkId: req.networkId,
    railId: req.railId,
    recipientId: req.recipientId,
    recipientDestination: req.recipient.canonicalDestination,
    resource: req.resource,
  });

  // 9. Evidence. Built BEFORE the write so the leaf hash commits to its own
  //    position in the chain — a hash that does not could not detect a deletion.
  const slot = await nextEvidenceSlot(req.organizationId);
  if (!slot) {
    return {
      ok: false,
      code: "evidence_slot_unavailable",
      detail: "evidence chain position unavailable; refusing to decide without an audit record",
    };
  }

  const lifecycle = newLifecycleRecord({
    phase,
    approvalRequired: decision.requiresApproval,
    at: decidedAt,
    actor: authority.authority.agentId,
    reason: decision.primaryReason,
  });

  const bundle: EvidenceBundle = {
    paymentId: authorizationId,
    organizationId: req.organizationId,
    sequence: slot.sequence,
    previousLeafHash: slot.previousLeafHash,
    decidedAt,
    amountAtomic: req.amountAtomic,
    asset: req.asset,
    intent: {
      mandateId: mandate.mandateId,
      mandatePayloadHash: hashOf(mandate),
      expiresAt: mandate.expiresAt,
      authorityScopeHash: authorityScopeHash(authorityScopeOf(mandate.authorityScope)),
    },
    delegation: {
      principalId: authority.authority.principalId,
      delegationId: authority.authority.delegationId,
      operatorId: authority.authority.operatorId,
      agentId: authority.authority.agentId,
      sessionId: authority.authority.sessionId,
      attestation: authority.authority.attestation,
      chain: authority.authority.chain,
    },
    revocation: {
      live: revocation.live,
      checkedSubjects: revocation.live ? revocation.checkedSubjects : 0,
      snapshotAgeMs: revocation.live ? revocation.snapshotAgeMs : -1,
      maxStalenessMs: DEFAULT_MAX_STALENESS_MS,
    },
    policy: {
      verdict: decision.verdict,
      checks: decision.checks,
      evaluatedPolicies: decision.evaluatedPolicies,
      driftScore: drift.score,
      driftSignals: drift.signals.map((s) => s.id),
      requiresApproval: decision.requiresApproval,
    },
    recipient: {
      recipientId: req.recipientId,
      networkId: req.networkId,
      asset: req.asset,
      canonicalDestination: req.recipient.canonicalDestination ?? "",
      attestationMethod: req.recipient.attestation?.method ?? "none",
      attestedAt: req.recipient.attestation?.attestedAt ?? "",
      firstUse: req.recipient.firstUse,
      ...(req.recipient.ok ? {} : { denial: req.recipient.reason }),
    },
    approval: {
      required: decision.requiresApproval,
      approverRole: decision.escalation?.approverRole,
      timeoutSeconds: decision.escalation?.timeoutSeconds,
      onTimeout: decision.escalation?.onTimeout,
    },
    trace: { requestId: req.requestId, idempotencyKey: req.idempotencyKey },
  };

  const leafHash = evidenceLeafHash(bundle);

  // 10. One atomic write. Half-landing leaves an authorization nobody can
  //     explain or evidence nobody can attribute.
  const written = await recordDecision({
    authorization: {
      id: authorizationId,
      organization_id: req.organizationId,
      mandate_id: mandate.mandateId,
      principal_id: authority.authority.principalId,
      delegation_id: authority.authority.delegationId,
      operator_id: authority.authority.operatorId,
      agent_id: authority.authority.agentId,
      session_id: authority.authority.sessionId ?? null,
      phase,
      verdict: decision.verdict,
      approval_required: decision.requiresApproval,
      amount_atomic: req.amountAtomic,
      asset: req.asset,
      currency: req.currency,
      network_id: req.networkId,
      rail_id: req.railId,
      recipient_id: req.recipientId,
      recipient_destination: req.recipient.canonicalDestination ?? null,
      merchant_domain: req.merchantDomain ?? null,
      resource: req.resource ?? null,
      policy_version: CONTROL_PLANE_POLICY_VERSION,
      evaluated_policies: decision.evaluatedPolicies,
      primary_reason: decision.primaryReason ?? null,
      checks: decision.checks,
      drift_score: drift.score,
      drift_signals: drift.signals.map((s) => s.id),
      payload_hash: payloadHash,
      idempotency_key: req.idempotencyKey ?? null,
      expires_at: expiresAt,
    },
    approval: decision.requiresApproval
      ? {
          id: `cpap_${randomUUID().replace(/-/g, "")}`,
          approver_role: decision.escalation?.approverRole ?? "finance_admin",
          on_timeout: decision.escalation?.onTimeout ?? "HOLD",
          timeout_seconds: decision.escalation?.timeoutSeconds ?? 900,
        }
      : null,
    evidence: { id: evidenceId, leaf_hash: leafHash, bundle },
  });

  if (!written) {
    return {
      ok: false,
      code: "write_failed",
      detail: "the decision could not be recorded; no authorization was created",
    };
  }

  log.info("control-plane decision", {
    authorizationId,
    organizationId: req.organizationId,
    verdict: decision.verdict,
    phase,
    driftScore: drift.score,
    requestId: req.requestId,
  });
  void lifecycle;

  return {
    ok: true,
    authorizationId,
    evidenceId,
    decision,
    phase,
    expiresAt,
    payloadHash,
  };
}

/** Settled spend within the last `seconds`, atomic. Shares the sequence the
 *  drift engine saw so the two cannot disagree. */
function sumSince(sequence: readonly SequenceEntry[], nowMs: number, seconds: number): string {
  const since = nowMs - seconds * 1000;
  let total = 0n;
  for (const e of sequence) {
    if (!e.settled || e.atMs < since) continue;
    total += parseAtomic(e.amountAtomic) ?? 0n;
  }
  return total.toString();
}

/** SHA-256 of the mandate's canonical signing payload — the exact authority
 *  relied upon, so evidence can prove which one it was. */
function hashOf(mandate: IntentMandate): string {
  return authorityScopeHash({ signingPayload: mandateSigningPayload(mandate) });
}

/** Project a stored row onto the decision shape a caller receives. */
export function publicAuthorization(row: AuthorizationRow) {
  return {
    id: row.id,
    phase: row.phase,
    decision: row.verdict,
    reason: row.primary_reason,
    amount: String(row.amount_atomic),
    asset: row.asset,
    currency: row.currency,
    network: row.network_id,
    rail: row.rail_id,
    recipientId: row.recipient_id,
    approvalRequired: row.approval_required,
    policyVersion: row.policy_version,
    mandateId: row.mandate_id,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
  };
}
