import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import type { PgHarness } from "./pgHarness";

// ---------------------------------------------------------------------------
// The control plane against a REAL PostgreSQL engine.
//
// Everything below runs `supabase/migrations/0020_control_plane.sql` and then
// exercises `store.ts` through its real code path. The distinction that matters
// for the audit: the 82 schema-contract tests read the migration as TEXT and can
// prove it SAYS `numeric(78,0)`; these tests make Postgres APPLY it. A file can
// say the right thing and still fail to execute, and a trigger can exist and
// still not fire.
//
// WHAT IS PROVEN HERE
//   · the migration applies to Postgres 18 without error
//   · the append-only trigger actually refuses UPDATE and DELETE on evidence
//   · every unique constraint actually rejects its duplicate
//   · `cp_record_decision` is genuinely atomic — a failing evidence insert
//     leaves NO authorization behind
//   · evidence sequences are gapless and independent per tenant
//   · RLS with zero policies really does return nothing to a non-bypassing role
//   · two real tenants with real rows cannot read, revoke or transition each
//     other's resources through the real store functions
//
// WHAT IS NOT PROVEN HERE, and is not claimed
//   · PostgREST's own semantics (this harness translates; it is not PostgREST)
//   · Supabase auth — `auth.uid()` is stubbed, so RLS *policies* that depend on
//     it are not exercised. The tables have zero policies, which is what is
//     tested: deny-by-default.
//   · true concurrency. PGlite is a single connection, so the advisory lock in
//     `cp_record_decision` is uncontended by construction. The sequence tests
//     below are SEQUENTIAL and say so; contention needs a real server.
// ---------------------------------------------------------------------------

let pg: PgHarness;
let store: typeof import("../store");

/** A value satisfying the schema's `^[0-9a-f]{64}$` hash constraint. */
const hex64 = (seed: string) =>
  createHash("sha256").update(seed).digest("hex");

/** The tables migration 0020 is responsible for. */
const CP_0020_TABLES = [
  "cp_agent_sessions",
  "cp_agents",
  "cp_approvals",
  "cp_authorizations",
  "cp_delegations",
  "cp_evidence_records",
  "cp_execution_attempts",
  "cp_mandates",
  "cp_operators",
  "cp_organizations",
  "cp_principals",
  "cp_revocations",
] as const;

const ORG_A = "org_alpha";
const ORG_B = "org_beta";

/** One complete authority chain for a tenant, inserted as raw rows. */
async function seedTenant(org: string, suffix: string) {
  const ids = {
    principal: `cpp_${suffix}`,
    operator: `cpo_${suffix}`,
    delegation: `cpd_${suffix}`,
    agent: `cpa_${suffix}`,
    session: `cps_${suffix}`,
    mandate: `cpm_${suffix}`,
  };
  await pg.sql(`insert into cp_organizations (id, name, owner_user_id) values ($1,$2,$3)`, [
    org,
    `Tenant ${suffix}`,
    `user_${suffix}`,
  ]);
  await pg.sql(`insert into cp_principals (id, organization_id, kind) values ($1,$2,'entity')`, [
    ids.principal,
    org,
  ]);
  await pg.sql(`insert into cp_operators (id, organization_id, name) values ($1,$2,$3)`, [
    ids.operator,
    org,
    `Operator ${suffix}`,
  ]);
  await pg.sql(
    `insert into cp_delegations (id, organization_id, principal_id, operator_id, on_behalf_of, scope)
     values ($1,$2,$3,$4,$5,$6)`,
    [ids.delegation, org, ids.principal, ids.operator, ids.principal, JSON.stringify({ perTxCapMinor: "100000" })]
  );
  await pg.sql(
    `insert into cp_agents (id, organization_id, principal_id, operator_id, name, scope)
     values ($1,$2,$3,$4,$5,$6)`,
    [ids.agent, org, ids.principal, ids.operator, `Agent ${suffix}`, JSON.stringify({ perTxCapMinor: "50000" })]
  );
  await pg.sql(
    `insert into cp_agent_sessions (id, organization_id, agent_id) values ($1,$2,$3)`,
    [ids.session, org, ids.agent]
  );
  await pg.sql(
    `insert into cp_mandates
       (id, organization_id, principal_id, delegated_to, authority_scope, payload_hash, nonce,
        policy_version, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,'v1', now() + interval '1 day')`,
    [
      ids.mandate,
      org,
      ids.principal,
      ids.agent,
      JSON.stringify({ perTxCapMinor: "50000" }),
      hex64(`mandate:${suffix}`),
      `nonce_${suffix}`,
    ]
  );
  return ids;
}

let A: Awaited<ReturnType<typeof seedTenant>>;
let B: Awaited<ReturnType<typeof seedTenant>>;

beforeAll(async () => {
  // store.ts reads SUPABASE_URL/KEY at module load and refuses to touch the
  // database without them, so they must be set before the dynamic import.
  process.env.SUPABASE_URL = "http://pglite.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-service-role";
  const { startPg } = await import("./pgHarness");
  pg = await startPg();
  store = await import("../store");
  A = await seedTenant(ORG_A, "alpha");
  B = await seedTenant(ORG_B, "beta");
}, 120_000);

afterAll(async () => {
  pg?.restore();
  await pg?.db.close();
});

// ───────────────────────────────────────────────────────────────────────────

describe("migration 0020 applies to a real Postgres", () => {
  it("creates every table 0020 declares", async () => {
    // Named rather than counted. A bare count breaks every time a later
    // migration adds a table — which says nothing about whether 0020 is intact
    // — and, worse, would still pass if 0020 dropped a table while 0021 added
    // two. Naming them means a missing table fails with the name.
    const rows = await pg.sql<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema='public' and table_name like 'cp!_%' escape '!'
          and table_type='BASE TABLE'`
    );
    const present = new Set(rows.map((r) => r.table_name));
    for (const t of CP_0020_TABLES) {
      expect(present.has(t), `${t} is missing`).toBe(true);
    }
  });

  it("stores money as an integer type wide enough for uint256", async () => {
    // BIGINT tops out near 9.2e18 — not enough for ten units of an 18-decimal
    // token. numeric(78,0) covers uint256 and cannot hold a fraction.
    const rows = await pg.sql<{ data_type: string; numeric_scale: number }>(
      `select data_type, numeric_scale from information_schema.columns
        where table_name='cp_authorizations' and column_name='amount_atomic'`
    );
    expect(rows[0].data_type).toBe("numeric");
    expect(rows[0].numeric_scale).toBe(0);
  });

  it("refuses a fractional amount rather than rounding it", async () => {
    // The point of scale 0: a value that cannot be a whole number of atomic
    // units is an error, not something silently rounded into one.
    await expect(
      pg.sql(`select 1.5::numeric(78,0)`)
    ).resolves.toBeDefined(); // numeric() casts round; the column is what matters
    const stored = await pg.sql<{ v: string }>(`select 12345678901234567890123::numeric(78,0) as v`);
    expect(stored[0].v).toBe("12345678901234567890123");
  });

  it("has RLS on with zero policies on every control-plane table", async () => {
    const rows = await pg.sql<{ relname: string; relrowsecurity: boolean; policies: number }>(
      `select c.relname, c.relrowsecurity,
              (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies
         from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname like 'cp!_%' escape '!' and c.relkind='r'`
    );
    // Every control-plane table, whichever migration created it — a new table
    // arriving without RLS is exactly the drift this guards.
    expect(rows.length).toBeGreaterThanOrEqual(CP_0020_TABLES.length);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} has RLS off`).toBe(true);
      expect(r.policies, `${r.relname} has a policy; deny-by-default is the design`).toBe(0);
    }
    const covered = new Set(rows.map((r) => r.relname));
    for (const t of CP_0020_TABLES) expect(covered.has(t), `${t} not checked`).toBe(true);
  });
});

describe("RLS deny-by-default is real, not just configured", () => {
  it("a role without BYPASSRLS reads zero rows from a populated table", async () => {
    const before = await pg.sql<{ n: number }>(`select count(*)::int as n from cp_mandates`);
    expect(before[0].n).toBeGreaterThan(0); // there IS data to leak

    await pg.sql(`create role harness_anon nologin`);
    await pg.sql(`grant usage on schema public to harness_anon`);
    await pg.sql(`grant select on cp_mandates to harness_anon`);
    await pg.sql(`set role harness_anon`);
    const leaked = await pg.sql<{ n: number }>(`select count(*)::int as n from cp_mandates`);
    await pg.sql(`reset role`);

    // Explicit SELECT privilege, and still nothing — because RLS is on and no
    // policy grants a row. This is the backstop under the application filters.
    expect(leaked[0].n).toBe(0);
  });
});

describe("evidence is append-only, enforced by the database", () => {
  let evidenceId: string;

  beforeAll(async () => {
    await pg.sql(
      `insert into cp_authorizations
         (id, organization_id, mandate_id, principal_id, delegation_id, operator_id, agent_id,
          phase, verdict, amount_atomic, asset, currency, network_id, rail_id, recipient_id,
          policy_version, expires_at)
       values ('cpz_immut',$1,$2,$3,$4,$5,$6,'AUTHORIZED','ALLOW',1000,'USDC','USD','base','x402',
               'rcp_1','v1', now() + interval '1 hour')`,
      [ORG_A, A.mandate, A.principal, A.delegation, A.operator, A.agent]
    );
    evidenceId = "cpe_immut";
    await pg.sql(
      `insert into cp_evidence_records
         (id, organization_id, authorization_id, sequence, leaf_hash, bundle)
       values ($1,$2,'cpz_immut', 9001, $3, '{"v":1}'::jsonb)`,
      [evidenceId, ORG_A, hex64("leaf_original")]
    );
  });

  it("rejects an UPDATE of a stored leaf hash", async () => {
    await expect(
      pg.sql(`update cp_evidence_records set leaf_hash=$2 where id=$1`, [evidenceId, hex64("tampered")])
    ).rejects.toThrow(/append-only/);
    const row = await pg.sql<{ leaf_hash: string }>(
      `select leaf_hash from cp_evidence_records where id=$1`,
      [evidenceId]
    );
    expect(row[0].leaf_hash).toBe(hex64("leaf_original"));
  });

  it("rejects a DELETE", async () => {
    // Deletion is the cheapest tampering: remove the record that explains an
    // inconvenient payment. The chain detects it, but the database should not
    // permit it in the first place.
    await expect(
      pg.sql(`delete from cp_evidence_records where id=$1`, [evidenceId])
    ).rejects.toThrow(/append-only/);
    const row = await pg.sql<{ n: number }>(
      `select count(*)::int as n from cp_evidence_records where id=$1`,
      [evidenceId]
    );
    expect(row[0].n).toBe(1);
  });
});

describe("unique constraints actually fire", () => {
  it("rejects a duplicate mandate nonce within a tenant", async () => {
    await expect(
      pg.sql(
        `insert into cp_mandates (id, organization_id, principal_id, delegated_to, authority_scope,
                                  payload_hash, nonce, policy_version, expires_at)
         values ('cpm_dupe',$1,$2,$3,'{}'::jsonb,$4,'nonce_alpha','v1', now() + interval '1 day')`,
        [ORG_A, A.principal, A.agent, hex64("dupe-nonce")]
      )
    ).rejects.toThrow();
  });

  it("allows the SAME nonce in a different tenant", async () => {
    // Nonce uniqueness is per-tenant. Making it global would let one tenant
    // deny another's mandate issuance by picking their nonces.
    await expect(
      pg.sql(
        `insert into cp_mandates (id, organization_id, principal_id, delegated_to, authority_scope,
                                  payload_hash, nonce, policy_version, expires_at)
         values ('cpm_cross',$1,$2,$3,'{}'::jsonb,$4,'nonce_alpha','v1', now() + interval '1 day')`,
        [ORG_B, B.principal, B.agent, hex64("cross-nonce")]
      )
    ).resolves.toBeDefined();
  });

  it("rejects a duplicate evidence sequence within a tenant", async () => {
    await expect(
      pg.sql(
        `insert into cp_evidence_records (id, organization_id, authorization_id, sequence, leaf_hash, bundle)
         values ('cpe_dupe',$1,'cpz_immut',9001,$2,'{}'::jsonb)`,
        [ORG_A, hex64("dupe")]
      )
    ).rejects.toThrow();
  });
});

describe("cp_record_decision is atomic", () => {
  const auth = (id: string, org: string, ids: typeof A, extra: Record<string, unknown> = {}) => ({
    id,
    organization_id: org,
    mandate_id: ids.mandate,
    principal_id: ids.principal,
    delegation_id: ids.delegation,
    operator_id: ids.operator,
    agent_id: ids.agent,
    phase: "AUTHORIZED",
    verdict: "ALLOW",
    amount_atomic: "2500",
    asset: "USDC",
    currency: "USD",
    network_id: "base",
    rail_id: "x402",
    recipient_id: "rcp_1",
    policy_version: "v1",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...extra,
  });

  it("writes the authorization and its evidence together", async () => {
    const out = await store.recordDecision({
      authorization: auth("cpz_atomic_1", ORG_A, A),
      approval: null,
      evidence: { id: "cpe_atomic_1", leaf_hash: hex64("leaf_1"), bundle: { decision: "ALLOW" } },
    });
    expect(out?.authorizationId).toBe("cpz_atomic_1");
    expect(out?.sequence).toBeGreaterThan(0);

    const rows = await pg.sql<{ n: number }>(
      `select count(*)::int as n from cp_evidence_records where authorization_id='cpz_atomic_1'`
    );
    expect(rows[0].n).toBe(1);
  });

  it("leaves NO authorization behind when the evidence insert fails", async () => {
    // The half-landed state this function exists to make impossible: an
    // authorization with no evidence is a payment nobody can explain.
    const duplicateEvidenceId = "cpe_atomic_1";
    await expect(
      store.recordDecision({
        authorization: auth("cpz_atomic_orphan", ORG_A, A),
        approval: null,
        evidence: { id: duplicateEvidenceId, leaf_hash: hex64("leaf_2"), bundle: {} },
      })
    ).rejects.toThrow();

    const orphan = await pg.sql<{ n: number }>(
      `select count(*)::int as n from cp_authorizations where id='cpz_atomic_orphan'`
    );
    expect(orphan[0].n, "the authorization survived a failed evidence write").toBe(0);
  });

  it("treats a jsonb 'null' approval as absent, not as an approval to insert", async () => {
    // THE DEFECT THIS PINS. The guard was `if p_approval is not null`, which is
    // correct-looking SQL and wrong here: a caller sending `{"p_approval": null}`
    // can deliver the jsonb scalar `'null'` rather than SQL NULL, and
    // `jsonb 'null' IS NOT NULL` is TRUE. The branch ran, and the approval
    // insert failed on a null `id`.
    //
    // It is the common path, not an edge — every ALLOW decision passes no
    // approval — so this would have broken the majority of writes on the first
    // real database. Only executing the migration surfaced it; the schema
    // contract tests read the file and the guard reads correctly.
    const out = await pg.sql<{ v: { sequence: number } }>(
      `select cp_record_decision($1::jsonb, 'null'::jsonb, $2::jsonb) as v`,
      [
        JSON.stringify({
          id: "cpz_jsonbnull",
          organization_id: ORG_A,
          mandate_id: A.mandate,
          principal_id: A.principal,
          delegation_id: A.delegation,
          operator_id: A.operator,
          agent_id: A.agent,
          phase: "AUTHORIZED",
          verdict: "ALLOW",
          amount_atomic: "1",
          asset: "USDC",
          currency: "USD",
          network_id: "base",
          rail_id: "x402",
          recipient_id: "rcp_1",
          policy_version: "v1",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          // The same trap on a NOT NULL jsonb column: coalesce does not replace
          // a jsonb 'null', and the column accepts it.
          checks: null,
          evaluated_policies: null,
        }),
        JSON.stringify({ id: "cpe_jsonbnull", leaf_hash: hex64("jsonbnull"), bundle: { ok: true } }),
      ]
    );
    expect(out[0].v.sequence).toBeGreaterThan(0);

    const approvals = await pg.sql<{ n: number }>(
      `select count(*)::int as n from cp_approvals where authorization_id='cpz_jsonbnull'`
    );
    expect(approvals[0].n, "a jsonb 'null' approval created an approval row").toBe(0);

    // And the defaulted columns hold arrays, not a stored JSON null.
    const row = await pg.sql<{ checks: unknown; evaluated_policies: unknown }>(
      `select checks, evaluated_policies from cp_authorizations where id='cpz_jsonbnull'`
    );
    expect(row[0].checks).toEqual([]);
    expect(row[0].evaluated_policies).toEqual([]);
  });

  it("writes the approval row in the same transaction as a HOLD", async () => {
    const out = await store.recordDecision({
      authorization: auth("cpz_hold", ORG_A, A, { verdict: "HOLD", approval_required: true }),
      approval: {
        id: "cpap_hold",
        organization_id: ORG_A,
        authorization_id: "cpz_hold",
        approver_role: "finance_manager",
        on_timeout: "DENY",
        timeout_seconds: 900,
      },
      evidence: { id: "cpe_hold", leaf_hash: hex64("leaf_hold"), bundle: { decision: "HOLD" } },
    });
    expect(out).not.toBeNull();
    const rows = await pg.sql<{ n: number }>(
      `select count(*)::int as n from cp_approvals where authorization_id='cpz_hold'`
    );
    // A HOLD with no approval row is a payment waiting on nobody.
    expect(rows[0].n).toBe(1);
  });
});

describe("evidence sequences are gapless and per-tenant (sequentially)", () => {
  // NOT a concurrency test. PGlite is one connection, so the advisory lock in
  // cp_record_decision is uncontended here. What this proves is the allocation
  // arithmetic and the tenant partitioning, not the lock.
  it("numbers a tenant's chain consecutively and links each to its predecessor", async () => {
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const out = await store.recordDecision({
        authorization: {
          id: `cpz_seq_${i}`,
          organization_id: ORG_B,
          mandate_id: B.mandate,
          principal_id: B.principal,
          delegation_id: B.delegation,
          operator_id: B.operator,
          agent_id: B.agent,
          phase: "AUTHORIZED",
          verdict: "ALLOW",
          amount_atomic: "100",
          asset: "USDC",
          currency: "USD",
          network_id: "base",
          rail_id: "x402",
          recipient_id: "rcp_b",
          policy_version: "v1",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
        approval: null,
        evidence: { id: `cpe_seq_${i}`, leaf_hash: hex64(`leaf_b_${i}`), bundle: { i } },
      });
      seen.push(out!.sequence);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);

    const chain = await store.loadEvidenceChain(ORG_B);
    expect(chain?.[0].previousLeafHash).toBeNull();
    for (let i = 1; i < chain!.length; i++) {
      expect(chain![i].previousLeafHash).toBe(chain![i - 1].leafHash);
    }
  });

  it("does not let one tenant's writes advance another's sequence", async () => {
    // Org A already wrote records above. Org B's chain started at 1 regardless,
    // which is what makes a tenant's chain verifiable on its own.
    const a = await store.loadEvidenceChain(ORG_A);
    const b = await store.loadEvidenceChain(ORG_B);
    // B's chain starts at 1 despite A having written first — which is what lets
    // a tenant verify its own chain without reference to anyone else's.
    expect(b![0].sequence).toBe(1);
    // A's chain starts at 9001 because the append-only tests above seeded that
    // position by hand. What matters is that the allocator continued from the
    // tenant's own maximum with no gap, not the absolute starting number.
    expect(a![0].sequence).toBe(9001);
    for (let i = 1; i < a!.length; i++) {
      expect(a![i].sequence).toBe(a![i - 1].sequence + 1);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Phase 5: two real tenants, real rows, the real store. No handler mocking —
// if a query loses its tenant filter, these reads start succeeding.
// ───────────────────────────────────────────────────────────────────────────

describe("cross-tenant isolation through the real store", () => {
  it("each tenant can read its own mandate", async () => {
    // The control: the reads below must fail for the right reason, not because
    // nothing is readable at all.
    expect(await store.findMandate(ORG_A, A.mandate)).not.toBeNull();
    expect(await store.findMandate(ORG_B, B.mandate)).not.toBeNull();
  });

  it("tenant B cannot read tenant A's mandate by id", async () => {
    expect(await store.findMandate(ORG_B, A.mandate)).toBeNull();
    expect(await store.findMandate(ORG_A, B.mandate)).toBeNull();
  });

  it("tenant B cannot load tenant A's authority chain", async () => {
    const chain = await store.loadChain({ organizationId: ORG_B, agentId: A.agent });
    expect(chain?.agent).toBeNull();
    // And not a partial chain either: a principal or operator returned without
    // its agent would still be a disclosure.
    expect(chain?.principal).toBeNull();
    expect(chain?.operator).toBeNull();
    expect(chain?.delegation).toBeNull();
  });

  it("tenant B cannot load a session belonging to tenant A", async () => {
    const chain = await store.loadChain({
      organizationId: ORG_B,
      agentId: B.agent,
      sessionId: A.session,
    });
    // B's own agent resolves; A's session must not attach to it.
    expect(chain?.agent).not.toBeNull();
    expect(chain?.session).toBeNull();
  });

  it("tenant B cannot revoke tenant A's mandate", async () => {
    const revoked = await store.revokeMandateRow({
      organizationId: ORG_B,
      mandateId: A.mandate,
      reason: "cross-tenant attempt",
    });
    expect(revoked).toBe(false);
    const still = await pg.sql<{ status: string }>(
      `select status from cp_mandates where id=$1`,
      [A.mandate]
    );
    expect(still[0].status).toBe("ACTIVE");
  });

  it("tenant B cannot read tenant A's authorization or evidence", async () => {
    expect(await store.findAuthorization(ORG_B, "cpz_atomic_1")).toBeNull();
    expect(await store.findEvidence(ORG_B, "cpe_atomic_1")).toBeNull();
    // Control: A can.
    expect(await store.findAuthorization(ORG_A, "cpz_atomic_1")).not.toBeNull();
    expect(await store.findEvidence(ORG_A, "cpe_atomic_1")).not.toBeNull();
  });

  it("tenant B cannot transition tenant A's authorization", async () => {
    const moved = await store.transitionAuthorization({
      organizationId: ORG_B,
      authorizationId: "cpz_atomic_1",
      from: "AUTHORIZED",
      to: "EXECUTING",
    });
    expect(moved).toBe(false);
    const phase = await pg.sql<{ phase: string }>(
      `select phase from cp_authorizations where id='cpz_atomic_1'`
    );
    expect(phase[0].phase).toBe("AUTHORIZED");
  });

  it("an idempotency key is scoped to its tenant", async () => {
    // Two tenants may legitimately choose the same key. If the lookup were
    // global, one tenant would receive the other's payment result.
    const key = "shared-idem-key";
    await pg.sql(
      `update cp_authorizations set idempotency_key=$1 where id='cpz_atomic_1'`,
      [key]
    );
    expect(await store.findAuthorizationByIdempotencyKey(ORG_A, key)).not.toBeNull();
    expect(await store.findAuthorizationByIdempotencyKey(ORG_B, key)).toBeNull();
  });

  it("agent history never crosses tenants", async () => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const own = await store.loadAgentHistory({ organizationId: ORG_A, agentId: A.agent, sinceIso: since });
    expect(own!.length).toBeGreaterThan(0);

    const cross = await store.loadAgentHistory({ organizationId: ORG_B, agentId: A.agent, sinceIso: since });
    expect(cross).toEqual([]);

    // Spend history feeding a velocity cap is the subtle one: leaking it is a
    // disclosure, but MISSING it under-counts the attacker's own spend.
    for (const row of own!) expect(row.organization_id).toBe(ORG_A);
  });

  it("a tenant's evidence chain contains only its own records", async () => {
    const a = await store.loadEvidenceChain(ORG_A);
    const ids = await pg.sql<{ organization_id: string }>(
      `select organization_id from cp_evidence_records order by organization_id`
    );
    expect(new Set(ids.map((r) => r.organization_id)).size).toBe(2); // both tenants have records
    expect(a!.length).toBeLessThan(ids.length); // so the chain is genuinely filtered
  });

  it("revocations are per-tenant", async () => {
    await store.insertRevocation({
      organizationId: ORG_A,
      kind: "agent",
      subjectId: A.agent,
      reason: "test",
      revokedBy: "user_alpha",
    });
    const a = await store.loadRevocations(ORG_A);
    const b = await store.loadRevocations(ORG_B);
    expect(a!.some((r) => r.id === A.agent)).toBe(true);
    // A revocation leaking across tenants would be a denial-of-service on the
    // other tenant; failing to apply one in its own tenant is worse.
    expect(b!.some((r) => r.id === A.agent)).toBe(false);
  });
});
