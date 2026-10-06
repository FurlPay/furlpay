import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { evidenceLeafHash, verifyEvidenceChain } from "@furlpay/control-plane";
import type { PgHarness } from "./pgHarness";

// ---------------------------------------------------------------------------
// Human approval decisions against a REAL PostgreSQL engine (migration 0030).
//
// The pure rules have their own tests in @furlpay/control-plane. What only a
// database can prove is that the answer lands as ONE fact (approval row, phase,
// evidence), that a second answer cannot land, that a stale read cannot move a
// payment, and that the evidence chain stays intact across a decision.
//
// PGlite is a single connection, so the advisory lock is uncontended here; the
// stale-slot path is exercised by writing a record between read and write.
// ---------------------------------------------------------------------------

vi.mock("@/lib/log", () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }));

let pg: PgHarness;
let store: typeof import("../store");
let approvals: typeof import("../approvals");

const hex64 = (seed: string) => createHash("sha256").update(seed).digest("hex");

const ORG = "org_approvals";
const OTHER = "org_other";
const T0 = Date.parse("2026-10-05T12:00:00Z");

async function seedTenant(org: string, suffix: string) {
  const ids = {
    principal: `cpp_${suffix}`,
    operator: `cpo_${suffix}`,
    delegation: `cpd_${suffix}`,
    agent: `cpag_${suffix}`,
    mandate: `cpm_${suffix}`,
  };
  await pg.sql(`insert into cp_organizations (id, name, owner_user_id) values ($1,$2,$3)`, [org, suffix, `user_${suffix}`]);
  await pg.sql(`insert into cp_principals (id, organization_id, kind) values ($1,$2,'entity')`, [ids.principal, org]);
  await pg.sql(`insert into cp_operators (id, organization_id, name) values ($1,$2,'op')`, [ids.operator, org]);
  await pg.sql(
    `insert into cp_delegations (id, organization_id, principal_id, operator_id, on_behalf_of, scope)
     values ($1,$2,$3,$4,$3,'{}')`,
    [ids.delegation, org, ids.principal, ids.operator]
  );
  await pg.sql(
    `insert into cp_agents (id, organization_id, principal_id, operator_id, name, scope)
     values ($1,$2,$3,$4,'agent','{}')`,
    [ids.agent, org, ids.principal, ids.operator]
  );
  await pg.sql(
    `insert into cp_mandates (id, organization_id, principal_id, delegated_to, authority_scope, payload_hash, nonce, policy_version, expires_at)
     values ($1,$2,$3,$4,'{}',$5,$6,'v1', now() + interval '1 day')`,
    [ids.mandate, org, ids.principal, ids.agent, hex64(`m:${suffix}`), `n_${suffix}`]
  );
  return ids;
}

type Ids = Awaited<ReturnType<typeof seedTenant>>;
let A: Ids;
let B: Ids;

/** A held payment written through the real decision path, with real evidence. */
async function heldPayment(
  org: string,
  ids: Ids,
  key: string,
  opts: { onTimeout?: "HOLD" | "DENY"; phase?: string; requestedAt?: string } = {}
) {
  const slot = await store.nextEvidenceSlot(org);
  const bundle = {
    paymentId: `cpa_${key}`,
    organizationId: org,
    sequence: slot!.sequence,
    previousLeafHash: slot!.previousLeafHash,
    decidedAt: new Date(T0).toISOString(),
    amountAtomic: "75000000000",
    asset: "USDC",
    intent: { mandateId: ids.mandate, mandatePayloadHash: hex64("mp"), expiresAt: "2026-10-06T00:00:00Z", authorityScopeHash: hex64("as") },
    delegation: { principalId: ids.principal, delegationId: ids.delegation, operatorId: ids.operator, agentId: ids.agent, chain: [] },
    revocation: { live: true, checkedSubjects: 4, snapshotAgeMs: 1, maxStalenessMs: 5000 },
    policy: { verdict: "HOLD", checks: [], evaluatedPolicies: [], driftScore: 0, driftSignals: [], requiresApproval: true },
    recipient: { recipientId: "rcpt_1", networkId: "base", asset: "USDC", canonicalDestination: "0x" + "1".repeat(40), attestationMethod: "none", attestedAt: "", firstUse: false },
    approval: { required: true, approverRole: "finance_admin", timeoutSeconds: 900, onTimeout: opts.onTimeout ?? "HOLD" },
    trace: { requestId: `req_${key}` },
  };
  await store.recordDecision({
    authorization: {
      id: `cpa_${key}`,
      organization_id: org,
      mandate_id: ids.mandate,
      principal_id: ids.principal,
      delegation_id: ids.delegation,
      operator_id: ids.operator,
      agent_id: ids.agent,
      phase: opts.phase ?? "PENDING_APPROVAL",
      verdict: "HOLD",
      approval_required: true,
      amount_atomic: "75000000000",
      asset: "USDC",
      currency: "USD",
      network_id: "base",
      rail_id: "usdc_base",
      recipient_id: "rcpt_1",
      policy_version: "v1",
      payload_hash: hex64(`payload:${key}`),
      expires_at: new Date(T0 + 300_000).toISOString(),
    },
    approval: {
      id: `cpap_${key}`,
      approver_role: "finance_admin",
      on_timeout: opts.onTimeout ?? "HOLD",
      timeout_seconds: 900,
    },
    evidence: { id: `cpe_${key}`, leaf_hash: evidenceLeafHash(bundle as never), bundle },
  });
  if (opts.requestedAt) {
    await pg.sql(`update cp_approvals set requested_at=$2 where id=$1`, [`cpap_${key}`, opts.requestedAt]);
  } else {
    await pg.sql(`update cp_approvals set requested_at=$2 where id=$1`, [`cpap_${key}`, new Date(T0).toISOString()]);
  }
  return { authorizationId: `cpa_${key}`, approvalId: `cpap_${key}` };
}

const decide = (approvalId: string, decision: "APPROVE" | "DENY", extra: { org?: string; actor?: string; nowMs?: number } = {}) =>
  approvals.decideApproval({
    organizationId: extra.org ?? ORG,
    approvalId,
    decision,
    actor: extra.actor ?? "user_approver",
    stepUpHash: hex64("stepup"),
    requestId: "req_test",
    nowMs: extra.nowMs ?? T0 + 60_000,
  });

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://pglite.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-service-role";
  const { startPg } = await import("./pgHarness");
  pg = await startPg();
  store = await import("../store");
  approvals = await import("../approvals");
  A = await seedTenant(ORG, "a");
  B = await seedTenant(OTHER, "b");
}, 120_000);

afterAll(async () => {
  pg?.restore();
  await pg?.db.close();
});

describe("cp_decide_approval", () => {
  it("approves: approval row, phase, fresh window and evidence land together", async () => {
    const p = await heldPayment(ORG, A, "approve");
    const out = await decide(p.approvalId, "APPROVE");
    expect(out).toMatchObject({ ok: true, replayed: false, phase: "APPROVED" });

    const [ap] = await pg.sql<{ approved_by: string; approved_at: string; evidence_hash: string }>(
      `select approved_by, approved_at, evidence_hash from cp_approvals where id=$1`,
      [p.approvalId]
    );
    expect(ap.approved_by).toBe("user_approver");
    expect(ap.approved_at).toBeTruthy();
    expect(ap.evidence_hash).toBe(hex64("stepup"));

    const [auth] = await pg.sql<{ phase: string; expires_at: Date }>(
      `select phase, expires_at from cp_authorizations where id=$1`,
      [p.authorizationId]
    );
    expect(auth.phase).toBe("APPROVED");
    expect(new Date(auth.expires_at).getTime()).toBe(T0 + 60_000 + 300_000);

    const ev = await pg.sql<{ bundle: Record<string, unknown>; leaf_hash: string }>(
      `select bundle, leaf_hash from cp_evidence_records where authorization_id=$1 order by sequence`,
      [p.authorizationId]
    );
    expect(ev).toHaveLength(2);
    expect(ev[1].bundle.event).toBe("approval_decision");
    expect((ev[1].bundle.approval as Record<string, unknown>).approvedBy).toBe("user_approver");
    // The stored record verifies: recomputed from the stored bundle.
    expect(evidenceLeafHash(ev[1].bundle as never)).toBe(ev[1].leaf_hash);
  });

  it("keeps the organization's evidence chain gapless and linked across decisions", async () => {
    const links = await store.loadEvidenceChain(ORG);
    expect(verifyEvidenceChain(links!)).toMatchObject({ ok: true });
  });

  it("denies, and a later APPROVE by someone else is refused", async () => {
    const p = await heldPayment(ORG, A, "deny");
    expect(await decide(p.approvalId, "DENY")).toMatchObject({ ok: true, phase: "DENIED" });
    const again = await decide(p.approvalId, "APPROVE", { actor: "user_other" });
    expect(again).toMatchObject({ ok: false, code: "already_decided" });
    const [auth] = await pg.sql<{ phase: string }>(`select phase from cp_authorizations where id=$1`, [p.authorizationId]);
    expect(auth.phase).toBe("DENIED");
  });

  it("treats the same person repeating the same answer as a replay, writing nothing", async () => {
    const p = await heldPayment(ORG, A, "replay");
    await decide(p.approvalId, "APPROVE");
    const before = await pg.sql<{ n: number }>(`select count(*)::int as n from cp_evidence_records where organization_id=$1`, [ORG]);
    const again = await decide(p.approvalId, "APPROVE");
    expect(again).toMatchObject({ ok: true, replayed: true, phase: "APPROVED" });
    const after = await pg.sql<{ n: number }>(`select count(*)::int as n from cp_evidence_records where organization_id=$1`, [ORG]);
    expect(after[0].n).toBe(before[0].n);
  });

  it("does not find another tenant's approval", async () => {
    const p = await heldPayment(OTHER, B, "foreign");
    const out = await decide(p.approvalId, "APPROVE", { org: ORG });
    expect(out).toMatchObject({ ok: false, code: "not_found" });
    const [ap] = await pg.sql<{ approved_at: string | null }>(`select approved_at from cp_approvals where id=$1`, [p.approvalId]);
    expect(ap.approved_at).toBeNull();
  });

  it("refuses a late APPROVE under DENY-on-timeout and records the clock's denial", async () => {
    const p = await heldPayment(ORG, A, "late", { onTimeout: "DENY" });
    const out = await decide(p.approvalId, "APPROVE", { nowMs: T0 + 901_000 });
    expect(out).toMatchObject({ ok: false, code: "approval_timed_out" });
    const [ap] = await pg.sql<{ denied_by: string }>(`select denied_by from cp_approvals where id=$1`, [p.approvalId]);
    expect(ap.denied_by).toBe(approvals.TIMEOUT_ACTOR);
    const [auth] = await pg.sql<{ phase: string }>(`select phase from cp_authorizations where id=$1`, [p.authorizationId]);
    expect(auth.phase).toBe("DENIED");
  });

  it("refuses a payment that is no longer waiting", async () => {
    const p = await heldPayment(ORG, A, "expired");
    await pg.sql(`update cp_authorizations set phase='EXPIRED' where id=$1`, [p.authorizationId]);
    expect(await decide(p.approvalId, "APPROVE")).toMatchObject({ ok: false, code: "not_awaiting_approval" });
  });

  it("refuses at the database when the phase moved after the application read it", async () => {
    const p = await heldPayment(ORG, A, "raced");
    const slot = await store.nextEvidenceSlot(ORG);
    await pg.sql(`update cp_authorizations set phase='EXPIRED' where id=$1`, [p.authorizationId]);
    const out = await store.recordApprovalDecision({
      organizationId: ORG,
      approvalId: p.approvalId,
      decision: "APPROVE",
      actor: "user_approver",
      fromPhase: "PENDING_APPROVAL",
      toPhase: "APPROVED",
      stepUpHash: null,
      expiresAt: null,
      evidence: { id: "cpe_raced", leaf_hash: hex64("x"), bundle: {}, sequence: slot!.sequence, previous_leaf_hash: slot!.previousLeafHash },
    });
    expect(out).toMatchObject({ status: "phase_changed", phase: "EXPIRED" });
  });

  it("reports a stale evidence slot instead of writing a hash that commits to the wrong position", async () => {
    const p = await heldPayment(ORG, A, "stale");
    const slot = await store.nextEvidenceSlot(ORG);
    await heldPayment(ORG, A, "interloper"); // takes that slot
    const out = await store.recordApprovalDecision({
      organizationId: ORG,
      approvalId: p.approvalId,
      decision: "APPROVE",
      actor: "user_approver",
      fromPhase: "PENDING_APPROVAL",
      toPhase: "APPROVED",
      stepUpHash: null,
      expiresAt: null,
      evidence: { id: "cpe_stale", leaf_hash: hex64("y"), bundle: {}, sequence: slot!.sequence, previous_leaf_hash: slot!.previousLeafHash },
    });
    expect(out).toEqual({ status: "slot_stale" });
    const [ap] = await pg.sql<{ approved_at: string | null }>(`select approved_at from cp_approvals where id=$1`, [p.approvalId]);
    expect(ap.approved_at).toBeNull();
  });

  it("refuses a DENY that names APPROVED as its target", async () => {
    const p = await heldPayment(ORG, A, "mismatch");
    await expect(
      pg.sql(
        `select cp_decide_approval($1,$2,'DENY','u','PENDING_APPROVAL','APPROVED',null,null,'{}'::jsonb)`,
        [ORG, p.approvalId]
      )
    ).rejects.toThrow(/cannot move a payment to APPROVED/);
  });

  it("lists only payments still waiting, with what a person needs to decide", async () => {
    const p = await heldPayment(ORG, A, "queued");
    const queue = await approvals.pendingApprovalQueue(ORG);
    const ids = queue!.map((q) => q.id);
    expect(ids).toContain(p.approvalId);
    expect(ids).not.toContain("cpap_approve");
    expect(ids).not.toContain("cpap_expired");
    const entry = queue!.find((q) => q.id === p.approvalId)!;
    expect(entry.payment).toMatchObject({ amount: "75000000000", asset: "USDC", phase: "PENDING_APPROVAL" });
    expect(entry.deadline).toBe(new Date(T0 + 900_000).toISOString());
  });
});
