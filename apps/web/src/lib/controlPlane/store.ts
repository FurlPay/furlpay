import {
  sbSelect,
  sbInsert,
  sbRpc,
  sbUpdate,
  supabaseBackend,
  SupabaseFunctionMissing,
} from "@/lib/supabase";
import type {
  Agent,
  AgentSession,
  Delegation,
  IntentMandate,
  Operator,
  Principal,
  RevocationEntry,
  RevocationSubjectKind,
} from "@furlpay/control-plane";

// ---------------------------------------------------------------------------
// Durable storage for the control plane (schema: migrations/0020).
//
// WHY THIS FILE EXISTS RATHER THAN A DB CALL INSIDE THE PACKAGE.
// `@furlpay/control-plane` is pure on purpose: every decision is a function of
// values handed to it, which is what makes ~200 denial paths testable without
// infrastructure and what lets a payer-side gate run the identical functions and
// be unable to disagree with the server. A `select` anywhere inside it destroys
// that property permanently. So the package models the domain and this adapter
// does the reading and writing, mapping snake_case rows onto its types.
//
// THE FALLBACK POSTURE, AND WHERE IT STOPS BEING ACCEPTABLE. Every read returns
// null when Supabase is unconfigured or 0020 has not been applied, matching
// paymentsDb.ts's shape for 0009. That is a migration aid so this layer can be
// introduced under a running system — it is NOT a licence to authorize payments
// against a store that is not there. `assertControlPlaneDurable()` is the line:
// an authorization decision without durable authority cannot be revoked
// tomorrow and cannot be explained afterwards, so production refuses rather than
// deciding from nothing.
//
// TENANCY IS IN EVERY QUERY, NOT IN THE CALLER'S DISCIPLINE. Every function here
// takes `organizationId` and puts it in the filter. A helper that accepted only
// an id would compile fine and read another tenant's row, and the reviewer would
// have to notice the absence of something. Absence is exactly what reviews miss.
// ---------------------------------------------------------------------------

export function controlPlaneDurable(): boolean {
  return supabaseBackend === "supabase";
}

export class ControlPlaneDurabilityError extends Error {
  constructor(operation: string) {
    super(
      `The control plane has no durable backend, so ${operation} was refused. An authorization ` +
        `decided against a store that does not exist cannot be revoked afterwards and cannot be ` +
        `explained afterwards. Configure Supabase and apply supabase/migrations/0020_control_plane.sql.`
    );
    this.name = "ControlPlaneDurabilityError";
  }
}

/** Refuse to decide without durable authority. Call before any money decision. */
export function assertControlPlaneDurable(operation: string): void {
  if (!controlPlaneDurable()) throw new ControlPlaneDurabilityError(operation);
}

/**
 * Swallow "backend absent / migration not applied" and surface everything else.
 *
 * A missing relation (PGRST205) is a deployment state we handle. A constraint
 * violation, a type error or a network failure is NOT — re-throwing those is what
 * stops a real write failure being mistaken for "durability is off" and silently
 * continuing. Same discipline as paymentsDb.ts.
 */
async function optional<T>(work: () => Promise<T>): Promise<T | null> {
  if (!controlPlaneDurable()) return null;
  try {
    return await work();
  } catch (e) {
    if (e instanceof SupabaseFunctionMissing) return null;
    const message = (e as Error).message ?? "";
    if (message.includes("PGRST205") || message.includes("does not exist")) return null;
    throw e;
  }
}

const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

// ── Row shapes ─────────────────────────────────────────────────────────────

interface PrincipalRow {
  id: string;
  organization_id: string;
  kind: "individual" | "entity";
  status: Principal["status"];
  verification: Principal["verification"];
  created_at: string;
  revoked_at: string | null;
}

interface OperatorRow {
  id: string;
  organization_id: string;
  name: string;
  domain: string | null;
  status: Operator["status"];
  created_at: string;
}

interface DelegationRow {
  id: string;
  organization_id: string;
  principal_id: string;
  operator_id: string;
  on_behalf_of: string;
  status: Delegation["status"];
  scope: Delegation["scope"];
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

interface AgentRow {
  id: string;
  organization_id: string;
  principal_id: string;
  operator_id: string;
  name: string;
  did: string | null;
  key_id: string | null;
  status: Agent["status"];
  scope: Agent["scope"];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

interface SessionRow {
  id: string;
  organization_id: string;
  agent_id: string;
  status: AgentSession["status"];
  attestation_kind: "tee" | "passkey" | "key_only" | "none";
  attestation_ref: string | null;
  scope: AgentSession["scope"] | null;
  started_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

interface MandateRow {
  id: string;
  organization_id: string;
  principal_id: string;
  delegated_to: string;
  authority_scope: IntentMandate["authorityScope"];
  payload_hash: string;
  credential_format: string | null;
  credential_token: string | null;
  credential_key_id: string | null;
  nonce: string;
  single_use: boolean;
  policy_version: string;
  status: IntentMandate["status"];
  issued_at: string;
  not_before: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

interface RevocationRow {
  organization_id: string;
  subject_kind: RevocationSubjectKind;
  subject_id: string;
  reason: string;
  revoked_by: string;
  revoked_at: string;
}

// ── Mappers ────────────────────────────────────────────────────────────────
//
// Explicit field-by-field, never a spread. A spread would carry whatever the
// database happens to hold into a domain object the policy engine trusts, and a
// column added later would arrive as an unvalidated property.

const toPrincipal = (r: PrincipalRow): Principal => ({
  principalId: r.id,
  organizationId: r.organization_id,
  kind: r.kind,
  status: r.status,
  verification: r.verification,
  createdAt: r.created_at,
  ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
});

const toOperator = (r: OperatorRow): Operator => ({
  operatorId: r.id,
  organizationId: r.organization_id,
  name: r.name,
  status: r.status,
  ...(r.domain ? { domain: r.domain } : {}),
  createdAt: r.created_at,
});

const toDelegation = (r: DelegationRow): Delegation => ({
  delegationId: r.id,
  principalId: r.principal_id,
  operatorId: r.operator_id,
  onBehalfOf: r.on_behalf_of,
  status: r.status,
  scope: r.scope ?? {},
  issuedAt: r.issued_at,
  ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
  ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
});

const toAgent = (r: AgentRow): Agent => ({
  agentId: r.id,
  principalId: r.principal_id,
  operatorId: r.operator_id,
  organizationId: r.organization_id,
  name: r.name,
  status: r.status,
  scope: r.scope ?? {},
  createdAt: r.created_at,
  ...(r.did ? { did: r.did } : {}),
  ...(r.key_id ? { keyId: r.key_id } : {}),
  ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
  ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
});

const toSession = (r: SessionRow): AgentSession => ({
  sessionId: r.id,
  agentId: r.agent_id,
  status: r.status,
  attestation:
    r.attestation_kind === "tee"
      ? { kind: "tee", measurement: r.attestation_ref ?? "" }
      : r.attestation_kind === "passkey"
        ? { kind: "passkey", credentialId: r.attestation_ref ?? "" }
        : { kind: r.attestation_kind },
  startedAt: r.started_at,
  ...(r.scope ? { scope: r.scope } : {}),
  ...(r.expires_at ? { expiresAt: r.expires_at } : {}),
  ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
});

const toMandate = (r: MandateRow): IntentMandate => ({
  mandateId: r.id,
  organizationId: r.organization_id,
  principalId: r.principal_id,
  delegatedTo: r.delegated_to,
  authorityScope: r.authority_scope,
  issuedAt: r.issued_at,
  expiresAt: r.expires_at,
  nonce: r.nonce,
  policyVersion: r.policy_version,
  status: r.status,
  ...(r.not_before ? { notBefore: r.not_before } : {}),
  ...(r.single_use ? { singleUse: true } : {}),
  ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
  ...(r.revoked_reason ? { revokedReason: r.revoked_reason } : {}),
});

// ── Chain reads ────────────────────────────────────────────────────────────

/**
 * Load the whole delegation chain in one round trip per link.
 *
 * Returns whatever it found, INCLUDING nulls — `resolveAuthority` is the thing
 * that decides what a missing link means, and it treats one as a denial rather
 * than a skip. Deciding here would put that judgement in two places.
 */
export async function loadChain(input: {
  organizationId: string;
  agentId: string;
  sessionId?: string;
}): Promise<{
  principal: Principal | null;
  delegation: Delegation | null;
  operator: Operator | null;
  agent: Agent | null;
  session: AgentSession | null;
} | null> {
  return optional(async () => {
    const agents = await sbSelect<AgentRow>(
      "cp_agents",
      `organization_id=${eq(input.organizationId)}&id=${eq(input.agentId)}&limit=1`
    );
    const agentRow = agents[0] ?? null;
    if (!agentRow) {
      return { principal: null, delegation: null, operator: null, agent: null, session: null };
    }

    const [principals, operators, delegations, sessions] = await Promise.all([
      sbSelect<PrincipalRow>(
        "cp_principals",
        `organization_id=${eq(input.organizationId)}&id=${eq(agentRow.principal_id)}&limit=1`
      ),
      sbSelect<OperatorRow>(
        "cp_operators",
        `organization_id=${eq(input.organizationId)}&id=${eq(agentRow.operator_id)}&limit=1`
      ),
      // The ACTIVE delegation binding this principal to this operator. Ordered
      // newest-first so a re-issued grant supersedes an older one; status is
      // filtered here only as an optimisation — resolveAuthority re-checks it,
      // because a filter is not a policy.
      sbSelect<DelegationRow>(
        "cp_delegations",
        `organization_id=${eq(input.organizationId)}` +
          `&principal_id=${eq(agentRow.principal_id)}` +
          `&operator_id=${eq(agentRow.operator_id)}` +
          `&order=issued_at.desc&limit=1`
      ),
      input.sessionId
        ? sbSelect<SessionRow>(
            "cp_agent_sessions",
            `organization_id=${eq(input.organizationId)}&id=${eq(input.sessionId)}&limit=1`
          )
        : Promise.resolve([] as SessionRow[]),
    ]);

    return {
      principal: principals[0] ? toPrincipal(principals[0]) : null,
      delegation: delegations[0] ? toDelegation(delegations[0]) : null,
      operator: operators[0] ? toOperator(operators[0]) : null,
      agent: toAgent(agentRow),
      session: sessions[0] ? toSession(sessions[0]) : null,
    };
  });
}

// ── Mandates ───────────────────────────────────────────────────────────────

export async function insertMandate(row: {
  id: string;
  organizationId: string;
  principalId: string;
  delegatedTo: string;
  authorityScope: unknown;
  payloadHash: string;
  nonce: string;
  policyVersion: string;
  expiresAt: string;
  notBefore?: string;
  singleUse?: boolean;
  credentialFormat?: string;
  credentialToken?: string;
  credentialKeyId?: string;
}): Promise<IntentMandate | null> {
  return optional(async () => {
    const [created] = await sbInsert<MandateRow>("cp_mandates", {
      id: row.id,
      organization_id: row.organizationId,
      principal_id: row.principalId,
      delegated_to: row.delegatedTo,
      authority_scope: row.authorityScope as MandateRow["authority_scope"],
      payload_hash: row.payloadHash,
      nonce: row.nonce,
      single_use: row.singleUse ?? false,
      policy_version: row.policyVersion,
      status: "ACTIVE",
      expires_at: row.expiresAt,
      not_before: row.notBefore ?? null,
      credential_format: row.credentialFormat ?? null,
      credential_token: row.credentialToken ?? null,
      credential_key_id: row.credentialKeyId ?? null,
    } as MandateRow);
    return toMandate(created);
  });
}

/** Tenant-scoped by construction: the organization is part of the filter. */
export async function findMandate(
  organizationId: string,
  mandateId: string
): Promise<IntentMandate | null> {
  const rows = await optional(() =>
    sbSelect<MandateRow>(
      "cp_mandates",
      `organization_id=${eq(organizationId)}&id=${eq(mandateId)}&limit=1`
    )
  );
  return rows?.[0] ? toMandate(rows[0]) : null;
}

/**
 * Mark a mandate revoked, conditional on it still being ACTIVE.
 *
 * The status predicate is in the WHERE clause rather than checked first: a
 * read-then-write would let two concurrent revocations both believe they were
 * the one that acted, and the second would overwrite the first's reason.
 */
export async function revokeMandateRow(input: {
  organizationId: string;
  mandateId: string;
  reason: string;
}): Promise<boolean> {
  const updated = await optional(() =>
    sbUpdate<MandateRow>(
      "cp_mandates",
      `organization_id=${eq(input.organizationId)}&id=${eq(input.mandateId)}&status=eq.ACTIVE`,
      {
        status: "REVOKED",
        revoked_at: new Date().toISOString(),
        revoked_reason: input.reason,
        updated_at: new Date().toISOString(),
      } as Partial<MandateRow>
    )
  );
  return (updated?.length ?? 0) > 0;
}

// ── Revocation ─────────────────────────────────────────────────────────────

/**
 * Every revocation for a tenant.
 *
 * Read WHOLE rather than probed per subject, because the engine checks a set of
 * subjects at once and N round trips would make the staleness bound a function
 * of network latency. Tenants are expected to have few revocations; if that ever
 * stops being true this becomes a bounded query plus a bloom filter, which is
 * why the engine takes a snapshot rather than a lookup function.
 */
export async function loadRevocations(organizationId: string): Promise<RevocationEntry[] | null> {
  const rows = await optional(() =>
    sbSelect<RevocationRow>(
      "cp_revocations",
      `organization_id=${eq(organizationId)}&order=revoked_at.desc&limit=5000`
    )
  );
  if (!rows) return null;
  return rows.map((r) => ({
    kind: r.subject_kind,
    id: r.subject_id,
    revokedAt: r.revoked_at,
    reason: r.reason,
    revokedBy: r.revoked_by,
  }));
}

export async function insertRevocation(input: {
  organizationId: string;
  kind: RevocationSubjectKind;
  subjectId: string;
  reason: string;
  revokedBy: string;
}): Promise<boolean> {
  const result = await optional(async () => {
    await sbInsert("cp_revocations", {
      organization_id: input.organizationId,
      subject_kind: input.kind,
      subject_id: input.subjectId,
      reason: input.reason,
      revoked_by: input.revokedBy,
    });
    return true;
  });
  return result ?? false;
}

// ── Decisions and evidence ─────────────────────────────────────────────────

export interface EvidenceSlot {
  sequence: number;
  previousLeafHash: string | null;
}

/**
 * The next position in this tenant's evidence chain.
 *
 * Read BEFORE computing the leaf hash, because the hash commits to its own
 * sequence and predecessor — a hash computed without them could not detect a
 * deletion, which is the whole reason the chain exists.
 *
 * Racy by itself, and deliberately so: `cp_record_decision` re-reads it under an
 * advisory lock and is the authority. This is for building the bundle.
 */
export async function nextEvidenceSlot(organizationId: string): Promise<EvidenceSlot | null> {
  const result = await optional(() =>
    sbRpc<{ sequence: number; previous_leaf_hash: string | null }>("cp_next_evidence_slot", {
      p_organization_id: organizationId,
    })
  );
  if (!result) return null;
  const row = Array.isArray(result) ? result[0] : result;
  return { sequence: Number(row?.sequence ?? 1), previousLeafHash: row?.previous_leaf_hash ?? null };
}

export interface DecisionWrite {
  authorization: Record<string, unknown>;
  approval: Record<string, unknown> | null;
  evidence: { id: string; leaf_hash: string; bundle: unknown };
}

/**
 * Write the authorization, its approval requirement and its evidence as ONE fact.
 *
 * Three separate PostgREST calls can half-land, and the states that leaves are
 * precisely the dangerous ones: an authorization with no evidence is
 * unexplainable, evidence with no authorization is unattributable, and a HOLD
 * with no approval row is a payment waiting on nobody.
 */
export async function recordDecision(write: DecisionWrite): Promise<{
  authorizationId: string;
  evidenceId: string;
  sequence: number;
} | null> {
  const result = await optional(() =>
    sbRpc<{ authorization_id: string; evidence_id: string; sequence: number }>(
      "cp_record_decision",
      {
        p_authorization: write.authorization,
        p_approval: write.approval,
        p_evidence: write.evidence,
      }
    )
  );
  if (!result) return null;
  const row = Array.isArray(result) ? result[0] : result;
  return {
    authorizationId: row.authorization_id,
    evidenceId: row.evidence_id,
    sequence: Number(row.sequence),
  };
}

export interface AuthorizationRow {
  id: string;
  organization_id: string;
  mandate_id: string;
  agent_id: string;
  phase: string;
  verdict: "ALLOW" | "HOLD" | "DENY";
  approval_required: boolean;
  amount_atomic: string;
  asset: string;
  currency: string;
  network_id: string;
  rail_id: string;
  recipient_id: string;
  recipient_destination: string | null;
  merchant_domain: string | null;
  resource: string | null;
  policy_version: string;
  primary_reason: string | null;
  payload_hash: string | null;
  decided_at: string;
  expires_at: string;
}

export async function findAuthorization(
  organizationId: string,
  authorizationId: string
): Promise<AuthorizationRow | null> {
  const rows = await optional(() =>
    sbSelect<AuthorizationRow>(
      "cp_authorizations",
      `organization_id=${eq(organizationId)}&id=${eq(authorizationId)}&limit=1`
    )
  );
  return rows?.[0] ?? null;
}

/** Resolve an idempotency key to the payment it already created, per tenant. */
export async function findAuthorizationByIdempotencyKey(
  organizationId: string,
  key: string
): Promise<AuthorizationRow | null> {
  const rows = await optional(() =>
    sbSelect<AuthorizationRow>(
      "cp_authorizations",
      `organization_id=${eq(organizationId)}&idempotency_key=${eq(key)}&limit=1`
    )
  );
  return rows?.[0] ?? null;
}

/**
 * Settled history for the drift engine.
 *
 * Bounded by BOTH a time window and a row cap. An unbounded history read is a
 * request an attacker can make expensive by making many payments.
 */
export async function loadAgentHistory(input: {
  organizationId: string;
  agentId: string;
  sinceIso: string;
  limit?: number;
}): Promise<AuthorizationRow[] | null> {
  return optional(() =>
    sbSelect<AuthorizationRow>(
      "cp_authorizations",
      `organization_id=${eq(input.organizationId)}&agent_id=${eq(input.agentId)}` +
        `&decided_at=gte.${encodeURIComponent(input.sinceIso)}` +
        `&order=decided_at.desc&limit=${Math.min(input.limit ?? 500, 1000)}`
    )
  );
}

export interface EvidenceRow {
  id: string;
  organization_id: string;
  authorization_id: string;
  sequence: number;
  leaf_hash: string;
  previous_leaf_hash: string | null;
  bundle: unknown;
  merkle_root: string | null;
  created_at: string;
}

export async function findEvidence(
  organizationId: string,
  evidenceId: string
): Promise<EvidenceRow | null> {
  const rows = await optional(() =>
    sbSelect<EvidenceRow>(
      "cp_evidence_records",
      `organization_id=${eq(organizationId)}&id=${eq(evidenceId)}&limit=1`
    )
  );
  return rows?.[0] ?? null;
}

/** The chain links for a tenant, for `verifyEvidenceChain`. */
export async function loadEvidenceChain(
  organizationId: string,
  limit = 1000
): Promise<{ sequence: number; leafHash: string; previousLeafHash: string | null }[] | null> {
  const rows = await optional(() =>
    sbSelect<EvidenceRow>(
      "cp_evidence_records",
      `organization_id=${eq(organizationId)}&order=sequence.asc&limit=${Math.min(limit, 5000)}`
    )
  );
  if (!rows) return null;
  return rows.map((r) => ({
    sequence: Number(r.sequence),
    leafHash: r.leaf_hash,
    previousLeafHash: r.previous_leaf_hash,
  }));
}

// ── Execution attempts ─────────────────────────────────────────────────────

export async function recordExecutionAttempt(input: {
  organizationId: string;
  authorizationId: string;
  attempt: number;
  railId: string;
  state: string;
  railRef?: string;
  settlementRef?: string;
  feeAtomic?: string;
  confirmations?: number;
  requiredConfirmations?: number;
  failureReason?: string;
  railStatus?: string;
  executionTokenId?: string;
  signingBackend?: string;
  signingKeyId?: string;
  hardwareBacked?: boolean;
  ledgerTxId?: string;
}): Promise<boolean> {
  const result = await optional(async () => {
    await sbInsert("cp_execution_attempts", {
      organization_id: input.organizationId,
      authorization_id: input.authorizationId,
      attempt: input.attempt,
      rail_id: input.railId,
      state: input.state,
      rail_ref: input.railRef ?? null,
      settlement_ref: input.settlementRef ?? null,
      fee_atomic: input.feeAtomic ?? null,
      confirmations: input.confirmations ?? null,
      required_confirmations: input.requiredConfirmations ?? null,
      failure_reason: input.failureReason ?? null,
      rail_status: input.railStatus ?? null,
      execution_token_id: input.executionTokenId ?? null,
      signing_backend: input.signingBackend ?? null,
      signing_key_id: input.signingKeyId ?? null,
      hardware_backed: input.hardwareBacked ?? null,
      ledger_tx_id: input.ledgerTxId ?? null,
      finished_at: ["SETTLED", "FAILED"].includes(input.state) ? new Date().toISOString() : null,
    });
    return true;
  });
  return result ?? false;
}

/**
 * Advance an authorization's phase, conditional on its current one.
 *
 * Conditional so a transition computed from a stale read cannot overwrite a
 * newer one — the same guard `transitionPayment` uses in paymentsDb.ts, for the
 * same reason. The FSM decides which transitions are legal; this only makes the
 * write safe under concurrency.
 */
export async function transitionAuthorization(input: {
  organizationId: string;
  authorizationId: string;
  from: string;
  to: string;
}): Promise<boolean> {
  const updated = await optional(() =>
    sbUpdate<AuthorizationRow>(
      "cp_authorizations",
      `organization_id=${eq(input.organizationId)}&id=${eq(input.authorizationId)}` +
        `&phase=eq.${input.from}`,
      { phase: input.to, updated_at: new Date().toISOString() } as Partial<AuthorizationRow>
    )
  );
  return (updated?.length ?? 0) > 0;
}

// ── Human approvals (migration 0030) ───────────────────────────────────────

export interface ApprovalRow {
  id: string;
  organization_id: string;
  authorization_id: string;
  approver_role: string;
  approved_by: string | null;
  approved_at: string | null;
  denied_by: string | null;
  denied_at: string | null;
  on_timeout: "HOLD" | "DENY";
  timeout_seconds: number;
  requested_at: string;
}

export async function findApproval(
  organizationId: string,
  approvalId: string
): Promise<ApprovalRow | null> {
  const rows = await optional(() =>
    sbSelect<ApprovalRow>(
      "cp_approvals",
      `organization_id=${eq(organizationId)}&id=${eq(approvalId)}&limit=1`
    )
  );
  return rows?.[0] ?? null;
}

/** Undecided approvals for a tenant, oldest first: the order a human works them. */
export async function listPendingApprovals(
  organizationId: string,
  limit = 50
): Promise<ApprovalRow[] | null> {
  return optional(() =>
    sbSelect<ApprovalRow>(
      "cp_approvals",
      `organization_id=${eq(organizationId)}&approved_at=is.null&denied_at=is.null` +
        `&order=requested_at.asc&limit=${Math.min(Math.max(limit, 1), 200)}`
    )
  );
}

/** The authorizations behind a page of approvals, tenant-scoped. */
export async function findAuthorizations(
  organizationId: string,
  ids: readonly string[]
): Promise<AuthorizationRow[] | null> {
  if (ids.length === 0) return [];
  const list = ids.map((id) => encodeURIComponent(id)).join(",");
  return optional(() =>
    sbSelect<AuthorizationRow>(
      "cp_authorizations",
      `organization_id=${eq(organizationId)}&id=in.(${list})&limit=${ids.length}`
    )
  );
}

/** The evidence written when the payment was DECIDED: its first record. */
export async function findDecisionEvidence(
  organizationId: string,
  authorizationId: string
): Promise<EvidenceRow | null> {
  const rows = await optional(() =>
    sbSelect<EvidenceRow>(
      "cp_evidence_records",
      `organization_id=${eq(organizationId)}&authorization_id=${eq(authorizationId)}` +
        `&order=sequence.asc&limit=1`
    )
  );
  return rows?.[0] ?? null;
}

export type ApprovalWriteResult =
  | { status: "decided"; authorizationId: string; phase: string; evidenceId: string; sequence: number }
  | { status: "replayed"; authorizationId: string; decidedAt: string }
  | { status: "not_found" }
  | { status: "already_decided" }
  | { status: "phase_changed"; phase: string | null }
  | { status: "slot_stale" };

/**
 * Record a human's answer: approval row, phase and evidence as one fact.
 * Null when the store is absent; `slot_stale` when a concurrent write took the
 * evidence position the leaf hash committed to, which the caller retries.
 */
export async function recordApprovalDecision(input: {
  organizationId: string;
  approvalId: string;
  decision: "APPROVE" | "DENY";
  actor: string;
  fromPhase: string;
  toPhase: string;
  stepUpHash: string | null;
  expiresAt: string | null;
  evidence: {
    id: string;
    leaf_hash: string;
    bundle: unknown;
    sequence: number;
    previous_leaf_hash: string | null;
  };
}): Promise<ApprovalWriteResult | null> {
  let raw: Record<string, unknown> | Record<string, unknown>[] | null;
  try {
    raw = await optional(() =>
      sbRpc<Record<string, unknown>>("cp_decide_approval", {
        p_organization_id: input.organizationId,
        p_approval_id: input.approvalId,
        p_decision: input.decision,
        p_actor: input.actor,
        p_from_phase: input.fromPhase,
        p_to_phase: input.toPhase,
        p_step_up_hash: input.stepUpHash,
        p_expires_at: input.expiresAt,
        p_evidence: input.evidence,
      })
    );
  } catch (e) {
    if (((e as Error).message ?? "").includes("cp_evidence_slot_stale")) return { status: "slot_stale" };
    throw e;
  }
  if (!raw) return null;
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown>;
  switch (row.status) {
    case "decided":
      return {
        status: "decided",
        authorizationId: String(row.authorization_id),
        phase: String(row.phase),
        evidenceId: String(row.evidence_id),
        sequence: Number(row.sequence),
      };
    case "replayed":
      return {
        status: "replayed",
        authorizationId: String(row.authorization_id),
        decidedAt: String(row.decided_at),
      };
    case "not_found":
    case "already_decided":
      return { status: row.status };
    case "phase_changed":
      return { status: "phase_changed", phase: (row.phase as string | null) ?? null };
    default:
      throw new Error(`cp_decide_approval returned an unknown status: ${String(row.status)}`);
  }
}

/**
 * The approval row for an authorization. `undefined` when there is none, `null`
 * when the store could not be read: the execute guard must not read an outage
 * as "no approval needed" or as "approved".
 */
export async function findApprovalForAuthorization(
  organizationId: string,
  authorizationId: string
): Promise<ApprovalRow | undefined | null> {
  const rows = await optional(() =>
    sbSelect<ApprovalRow>(
      "cp_approvals",
      `organization_id=${eq(organizationId)}&authorization_id=${eq(authorizationId)}&limit=1`
    )
  );
  if (!rows) return null;
  return rows[0];
}
