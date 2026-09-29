import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import type { PgHarness } from "@/lib/controlPlane/__tests__/pgHarness";

// ---------------------------------------------------------------------------
// The /api/v1 control plane, end to end, against a real PostgreSQL engine.
//
// WHAT RUNS HERE IS THE REAL STACK, MINUS ONE LAYER:
//
//     API key → requireApiKey → tenant derivation → Zod validation
//       → authorization service → control-plane store → PostgreSQL
//       → evidence → response
//
// The route handlers are imported and invoked exactly as Next.js invokes them.
// `requireApiKey` runs against a real issued key. The store runs unmocked
// against real Postgres. Nothing in this file stubs a handler, a tenant, or a
// decision — mocking any of those would delete the code under test.
//
// THE ONE LAYER NOT COVERED is `middleware.ts`, which Next.js runs before the
// handler and which cannot be exercised by importing a route. It has its own
// coverage: `apiKeySurfaceReachable.spec.ts` pins the F-13 fix, and the audit
// records live HTTP checks against a production build. That boundary is stated
// rather than papered over.
//
// WHY TWO TENANTS AND NOT ONE. Almost every access-control bug in an API of
// this shape is a missing `organization_id`, and a single-tenant test cannot
// see one: with only one tenant, a query that forgot its filter returns exactly
// the same rows as a query that did not. So every attack below has a
// same-tenant control proving the read works at all, and the cross-tenant
// version proving it stops at the boundary.
// ---------------------------------------------------------------------------

let pg: PgHarness;
let createApiKey: typeof import("@/lib/apiKeys").createApiKey;

interface Tenant {
  readonly org: string;
  readonly userId: string;
  readonly key: string;
  readonly principal: string;
  readonly operator: string;
  readonly delegation: string;
  readonly agent: string;
  mandateId?: string;
  authorizationId?: string;
  evidenceId?: string;
  payloadHash?: string;
}

let A: Tenant;
let B: Tenant;

const ADDR_A = "0xAaAaAaAa11111111AaAaAaAa11111111AaAaAaAa";
const ADDR_B = "0xBbBbBbBb22222222BbBbBbBb22222222BbBbBbBb";

const ROUTES = {
  mandates: () => import("../mandates/route"),
  mandate: () => import("../mandates/[id]/route"),
  revokeMandate: () => import("../mandates/[id]/revoke/route"),
  recipients: () => import("../recipients/route"),
  revokeRecipient: () => import("../recipients/revoke/route"),
  authorize: () => import("../payments/authorize/route"),
  execute: () => import("../payments/execute/route"),
  payment: () => import("../payments/[id]/route"),
  evidence: () => import("../evidence/[id]/route"),
};

/** A request shaped exactly as the middleware would hand one to a handler. */
function request(
  method: "GET" | "POST",
  path: string,
  opts: { key?: string; body?: unknown; idempotencyKey?: string } = {}
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.key) headers.set("authorization", `Bearer ${opts.key}`);
  if (opts.idempotencyKey) headers.set("idempotency-key", opts.idempotencyKey);
  // A real client IP, because requireApiKey consults the key's IP allowlist and
  // the rate limiter buckets on it.
  headers.set("x-forwarded-for", "203.0.113.10");
  return new NextRequest(`https://furlpay.test${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function json(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function seedTenant(org: string, suffix: string): Promise<Tenant> {
  const userId = `user_${suffix}`;
  await pg.sql(`insert into cp_organizations (id, name, owner_user_id, environment) values ($1,$2,$3,'sandbox')`, [
    org,
    `Tenant ${suffix}`,
    userId,
  ]);
  const ids = {
    principal: `cpp_${suffix}`,
    operator: `cpo_${suffix}`,
    delegation: `cpd_${suffix}`,
    agent: `cpa_${suffix}`,
  };
  await pg.sql(`insert into cp_principals (id, organization_id, kind, status) values ($1,$2,'entity','ACTIVE')`, [
    ids.principal,
    org,
  ]);
  await pg.sql(`insert into cp_operators (id, organization_id, name) values ($1,$2,$3)`, [
    ids.operator,
    org,
    suffix,
  ]);
  await pg.sql(
    `insert into cp_delegations (id, organization_id, principal_id, operator_id, on_behalf_of, scope, expires_at)
     values ($1,$2,$3,$4,$5,$6, now() + interval '30 days')`,
    [
      ids.delegation,
      org,
      ids.principal,
      ids.operator,
      ids.principal,
      JSON.stringify({ maxAmountPerTxAtomic: "100000000", maxCumulativeAtomic: "1000000000" }),
    ]
  );
  await pg.sql(
    `insert into cp_agents (id, organization_id, principal_id, operator_id, name, scope, expires_at)
     values ($1,$2,$3,$4,$5,$6, now() + interval '30 days')`,
    [
      ids.agent,
      org,
      ids.principal,
      ids.operator,
      suffix,
      JSON.stringify({ maxAmountPerTxAtomic: "100000000", maxCumulativeAtomic: "1000000000" }),
    ]
  );

  // A REAL API key, issued by the real issuer and verified by the real
  // verifier. The organization is resolved from `owner_user_id`, so the key is
  // the only thing that decides which tenant a request belongs to.
  const issued = await createApiKey({
    userId,
    name: `${suffix} key`,
    prefix: "sk",
    environment: "test",
    scopes: ["payments:create", "payments:read", "agents:manage"],
  });

  return { org, userId, key: issued.secret, ...ids };
}


/**
 * A fresh ALLOW authorization for tenant A.
 *
 * Execution-guard tests each need their own: the first `/execute` attempt moves
 * the payment out of AUTHORIZED (correctly — a failed attempt is recorded), so
 * reusing one authorization makes every later test fail with `wrong_phase` and
 * prove nothing about the guard it was written for.
 */
async function freshAuthorization(): Promise<{ id: string; payloadHash: string }> {
  const { POST } = await ROUTES.authorize();
  const res = await POST(
    request("POST", "/api/v1/payments/authorize", {
      key: A.key,
      body: {
        mandateId: A.mandateId,
        agentId: A.agent,
        amount: "1000000",
        asset: "USDC",
        currency: "USD",
        network: "base",
        rail: "x402_usdc_arbitrum",
        recipient: { id: "rcp_a", destination: ADDR_A },
      },
    })
  );
  const { status, body } = await json(res);
  if (status !== 201) throw new Error(`authorize failed: ${status} ${JSON.stringify(body)}`);
  return { id: body.id as string, payloadHash: body.payloadHash as string };
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://pglite.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-service-role";
  // DEPLOYMENT CONFIGURATION, NOT PROVIDER ACCESS. `evaluateRailCapability`
  // refuses a rail whose deployment is missing the variables it would need, so
  // without these the authorize path stops at `credentials_missing` and the
  // decision logic below is never reached.
  //
  // Setting them does NOT make the rail live and is not a fabricated
  // credential: the rail's capability row still says `access: "sandbox"`,
  // `liveRails()` is still empty, and `/execute` still answers
  // `rail_not_connected` — which the test two blocks down asserts. The values
  // are deliberately not valid for anything.
  process.env.FACILITATOR_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
  process.env.FURLPAY_KMS_PROVIDER = "none-test-harness";
  const { startPg } = await import("@/lib/controlPlane/__tests__/pgHarness");
  pg = await startPg();
  ({ createApiKey } = await import("@/lib/apiKeys"));
  A = await seedTenant("org_e2e_a", "e2ea");
  B = await seedTenant("org_e2e_b", "e2eb");
}, 180_000);

afterAll(async () => {
  pg?.restore();
  await pg?.db.close();
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Authentication and tenant derivation
// ───────────────────────────────────────────────────────────────────────────

describe("authentication happens before anything else", () => {
  it("refuses a request with no credential", async () => {
    const { GET } = await ROUTES.recipients();
    const res = await GET(request("GET", "/api/v1/recipients?id=x"));
    expect(res.status).toBe(401);
  });

  it("refuses a forged bearer token", async () => {
    const { GET } = await ROUTES.recipients();
    const res = await GET(
      request("GET", "/api/v1/recipients?id=x", { key: "fp_test_deadbeef_cafebabe" })
    );
    expect(res.status).toBe(401);
  });

  it("refuses a real key that lacks the required scope", async () => {
    // A RESTRICTED key (`rk`), not a secret key. `normalizeScopes` grants an
    // `sk` key every scope by definition — the same model Stripe uses — so an
    // `sk` credential cannot demonstrate scope enforcement at all. That is a
    // real limitation and it is recorded as a finding rather than worked
    // around: on this API, scope restriction is only available via `rk`.
    const weak = await createApiKey({
      userId: A.userId,
      name: "read only",
      prefix: "rk",
      environment: "test",
      scopes: ["payments:read"],
    });
    const { POST } = await ROUTES.recipients();
    const res = await POST(
      request("POST", "/api/v1/recipients", {
        key: weak.secret,
        body: {
          recipientId: "rcp_scope",
          displayName: "x",
          destination: { networkId: "base", asset: "USDC", address: ADDR_A },
        },
      })
    );
    // `agents:manage` is required to write an attestation.
    expect(res.status).toBe(403);
    expect((await json(res)).body.error).toBe("insufficient_scope");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. The happy path, end to end
// ───────────────────────────────────────────────────────────────────────────

describe("a full payment lifecycle through the real stack", () => {
  it("attests a recipient, and it is created PENDING rather than payable", async () => {
    const { POST } = await ROUTES.recipients();
    const res = await POST(
      request("POST", "/api/v1/recipients", {
        key: A.key,
        body: {
          recipientId: "rcp_a",
          displayName: "A's supplier",
          destination: { networkId: "base", asset: "USDC", address: ADDR_A },
        },
      })
    );
    const { status, body } = await json(res);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.status).toBe("PENDING");
    // The trust class is explicit in the response: nobody independently checked
    // this address, and the API says so rather than reporting "verified".
    expect((body.destination as Record<string, unknown>).trustClass).toBe("enterprise_allowlisted");

    // Activation is a separate, deliberate act.
    await pg.sql(`update cp_recipients set status='ACTIVE' where organization_id=$1 and id='rcp_a'`, [A.org]);
    await pg.sql(`insert into cp_recipients (id, organization_id, display_name, status) values ('rcp_b',$1,'B supplier','ACTIVE')`, [B.org]);
    await pg.sql(
      `insert into cp_recipient_destinations (organization_id, recipient_id, network_id, asset,
        address_canonical, address_display, method, provenance)
       values ($1,'rcp_b','base','USDC',$2,$2,'human_confirmed','user:e2eb')`,
      [B.org, ADDR_B.toLowerCase()]
    );
  });

  it("issues a mandate", async () => {
    const { POST } = await ROUTES.mandates();
    const res = await POST(
      request("POST", "/api/v1/mandates", {
        key: A.key,
        body: {
          principalId: A.principal,
          delegatedTo: A.agent,
          authorityScope: {
            currency: "USD",
            maxAmountPerTxAtomic: "50000000",
            maxCumulativeAtomic: "500000000",
            spendingWindowSeconds: 86400,
            asset: "USDC",
            networks: ["base"],
            allowedRails: ["x402_usdc_arbitrum"],
          },
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      })
    );
    const { status, body } = await json(res);
    expect(status, JSON.stringify(body)).toBe(201);
    A.mandateId = body.id as string;
    expect(A.mandateId).toMatch(/^cpm_/);
  });

  it("reads the mandate back", async () => {
    const { GET } = await ROUTES.mandate();
    const res = await GET(request("GET", `/api/v1/mandates/${A.mandateId}`, { key: A.key }), {
      params: Promise.resolve({ id: A.mandateId! }),
    });
    const { status, body } = await json(res);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe("ACTIVE");
  });

  it("authorizes a payment and writes evidence in the same transaction", async () => {
    const { POST } = await ROUTES.authorize();
    const res = await POST(
      request("POST", "/api/v1/payments/authorize", {
        key: A.key,
        body: {
          mandateId: A.mandateId,
          agentId: A.agent,
          amount: "1000000",
          asset: "USDC",
          currency: "USD",
          network: "base",
          rail: "x402_usdc_arbitrum",
          recipient: { id: "rcp_a", destination: ADDR_A },
        },
      })
    );
    const { status, body } = await json(res);
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.decision).toBe("ALLOW");
    A.authorizationId = body.id as string;
    A.payloadHash = body.payloadHash as string;
    A.evidenceId = body.evidenceId as string;
    expect(A.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    // Evidence is not a separate call that might not have happened.
    const ev = await pg.sql<{ id: string; sequence: number }>(
      `select id, sequence from cp_evidence_records where authorization_id=$1`,
      [A.authorizationId]
    );
    expect(ev).toHaveLength(1);
    // The id the API returned must be the id that was actually written — not a
    // value the response invented alongside a write that went somewhere else.
    expect(ev[0].id).toBe(A.evidenceId);
  });

  it("returns evidence whose hash the reader can recompute", async () => {
    const { GET } = await ROUTES.evidence();
    const res = await GET(request("GET", `/api/v1/evidence/${A.evidenceId}`, { key: A.key }), {
      params: Promise.resolve({ id: A.evidenceId! }),
    });
    const { status, body } = await json(res);
    expect(status, JSON.stringify(body)).toBe(200);
    // Stored hash and hash recomputed from the returned bundle must agree —
    // that is what makes this evidence rather than an assertion.
    const integrity = body.integrity as Record<string, unknown>;
    expect(integrity.storedLeafHash).toBe(integrity.recomputedLeafHash);
    expect(integrity.intact).toBe(true);
    // A single intact record proves nothing if its predecessor was removed.
    expect((body.chain as Record<string, unknown>).verified).toBe(true);
  });

  it("refuses to execute, because no rail is connected — and says so", async () => {
    const { POST } = await ROUTES.execute();
    const res = await POST(
      request("POST", "/api/v1/payments/execute", {
        key: A.key,
        body: { authorizationId: A.authorizationId, payloadHash: A.payloadHash, rail: "x402_usdc_arbitrum" },
      })
    );
    const { status, body } = await json(res);
    // 503, not a fabricated settlement reference. The rail is genuinely absent.
    expect(status).toBe(503);
    expect(body.error).toBe("rail_not_connected");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Execution-time re-checks
// ───────────────────────────────────────────────────────────────────────────

describe("execution re-checks what authorization established", () => {
  it("refuses a payload hash that does not match the authorized one", async () => {
    const fresh = await freshAuthorization();
    const { POST } = await ROUTES.execute();
    const res = await POST(
      request("POST", "/api/v1/payments/execute", {
        key: A.key,
        body: {
          authorizationId: fresh.id,
          payloadHash: "f".repeat(64),
          rail: "x402_usdc_arbitrum",
        },
      })
    );
    expect((await json(res)).body.error).toBe("payload_mismatch");
  });

  it("refuses a rail other than the authorized one", async () => {
    const fresh = await freshAuthorization();
    const { POST } = await ROUTES.execute();
    const res = await POST(
      request("POST", "/api/v1/payments/execute", {
        key: A.key,
        body: { authorizationId: fresh.id, payloadHash: fresh.payloadHash, rail: "ach" },
      })
    );
    const { body } = await json(res);
    // A rail outage is a failed payment, not a different payment.
    expect(body.error).toBe("rail_not_authorized");
  });

  it("refuses execution after the DESTINATION's attestation is revoked", async () => {
    // authorize → revoke the attestation → execute. Without the execution-time
    // recheck this proceeds to an address the organization has already disowned.
    const fresh = await freshAuthorization();
    const { POST: revoke } = await ROUTES.revokeRecipient();
    const r = await revoke(
      request("POST", "/api/v1/recipients/revoke", {
        key: A.key,
        body: {
          recipientId: "rcp_a",
          reason: "address compromised",
          destination: { networkId: "base", asset: "USDC", address: ADDR_A },
        },
      })
    );
    expect(r.status, await r.clone().text()).toBe(200);

    const { POST } = await ROUTES.execute();
    const res = await POST(
      request("POST", "/api/v1/payments/execute", {
        key: A.key,
        body: { authorizationId: fresh.id, payloadHash: fresh.payloadHash, rail: "x402_usdc_arbitrum" },
      })
    );
    const { status, body } = await json(res);
    expect(status).toBe(409);
    expect(body.error).toBe("recipient_no_longer_attested");

    // Put it back so later tests are not affected by this one's side effect.
    await pg.sql(
      `update cp_recipient_destinations set revoked_at=null, revoked_reason=null
        where organization_id=$1 and recipient_id='rcp_a'`,
      [A.org]
    );
  });

  it("refuses execution after the mandate is revoked", async () => {
    const fresh = await freshAuthorization();
    const { POST: revoke } = await ROUTES.revokeMandate();
    await revoke(
      request("POST", `/api/v1/mandates/${A.mandateId}/revoke`, {
        key: A.key,
        body: { reason: "test revocation" },
      }),
      { params: Promise.resolve({ id: A.mandateId! }) }
    );

    const { POST } = await ROUTES.execute();
    const res = await POST(
      request("POST", "/api/v1/payments/execute", {
        key: A.key,
        body: { authorizationId: fresh.id, payloadHash: fresh.payloadHash, rail: "x402_usdc_arbitrum" },
      })
    );
    const { status, body } = await json(res);
    expect(status).toBe(409);
    expect(body.error).toBe("authority_revoked");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. The tenant boundary, attacked over the real handlers
// ───────────────────────────────────────────────────────────────────────────

describe("tenant isolation attack matrix", () => {
  let bMandate: string;
  let bAuth: string;
  let bEvidence: string;

  beforeAll(async () => {
    const { POST } = await ROUTES.mandates();
    const res = await POST(
      request("POST", "/api/v1/mandates", {
        key: B.key,
        body: {
          principalId: B.principal,
          delegatedTo: B.agent,
          authorityScope: {
            currency: "USD",
            maxAmountPerTxAtomic: "50000000",
            maxCumulativeAtomic: "500000000",
            spendingWindowSeconds: 86400,
            asset: "USDC",
            networks: ["base"],
            allowedRails: ["x402_usdc_arbitrum"],
          },
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      })
    );
    bMandate = (await json(res)).body.id as string;

    const { POST: authorize } = await ROUTES.authorize();
    const auth = await authorize(
      request("POST", "/api/v1/payments/authorize", {
        key: B.key,
        body: {
          mandateId: bMandate,
          agentId: B.agent,
          amount: "2000000",
          asset: "USDC",
          currency: "USD",
          network: "base",
          rail: "x402_usdc_arbitrum",
          recipient: { id: "rcp_b", destination: ADDR_B },
        },
      })
    );
    const authBody = (await json(auth)).body;
    bAuth = authBody.id as string;
    const ev = await pg.sql<{ id: string }>(
      `select id from cp_evidence_records where authorization_id=$1`,
      [bAuth]
    );
    bEvidence = ev[0]?.id;
  });

  it("B's resources exist — the control for every attack below", () => {
    expect(bMandate).toMatch(/^cpm_/);
    expect(bAuth).toBeTruthy();
    expect(bEvidence).toBeTruthy();
  });

  it("A cannot read B's mandate", async () => {
    const { GET } = await ROUTES.mandate();
    const res = await GET(request("GET", `/api/v1/mandates/${bMandate}`, { key: A.key }), {
      params: Promise.resolve({ id: bMandate }),
    });
    expect(res.status).toBe(404);

    // And a mandate that does not exist at all returns the SAME 404 with the
    // same body, so the id cannot be used as an existence oracle.
    const missing = await GET(
      request("GET", "/api/v1/mandates/cpm_does_not_exist", { key: A.key }),
      { params: Promise.resolve({ id: "cpm_does_not_exist" }) }
    );
    expect(missing.status).toBe(404);
    expect(await missing.clone().text()).toBe(await res.clone().text());
  });

  it("A cannot revoke B's mandate", async () => {
    const { POST } = await ROUTES.revokeMandate();
    const res = await POST(
      request("POST", `/api/v1/mandates/${bMandate}/revoke`, {
        key: A.key,
        body: { reason: "cross-tenant attempt" },
      }),
      { params: Promise.resolve({ id: bMandate }) }
    );
    expect(res.status).toBe(404);

    const still = await pg.sql<{ status: string }>(
      `select status from cp_mandates where id=$1`,
      [bMandate]
    );
    expect(still[0].status).toBe("ACTIVE");
  });

  it("A cannot read B's payment", async () => {
    const { GET } = await ROUTES.payment();
    const res = await GET(request("GET", `/api/v1/payments/${bAuth}`, { key: A.key }), {
      params: Promise.resolve({ id: bAuth }),
    });
    expect(res.status).toBe(404);
  });

  it("A cannot transition B's payment", async () => {
    const { POST } = await ROUTES.execute();
    const res = await POST(
      request("POST", "/api/v1/payments/execute", {
        key: A.key,
        body: { authorizationId: bAuth, payloadHash: "a".repeat(64), rail: "x402_usdc_arbitrum" },
      })
    );
    expect(res.status).toBe(404);

    const phase = await pg.sql<{ phase: string }>(
      `select phase from cp_authorizations where id=$1`,
      [bAuth]
    );
    expect(phase[0].phase).toBe("AUTHORIZED");
  });

  it("A cannot retrieve B's evidence", async () => {
    const { GET } = await ROUTES.evidence();
    const res = await GET(request("GET", `/api/v1/evidence/${bEvidence}`, { key: A.key }), {
      params: Promise.resolve({ id: bEvidence }),
    });
    expect(res.status).toBe(404);
  });

  it("A cannot read B's recipient", async () => {
    const { GET } = await ROUTES.recipients();
    const res = await GET(request("GET", "/api/v1/recipients?id=rcp_b", { key: A.key }));
    expect(res.status).toBe(404);

    // Control: B can.
    const own = await GET(request("GET", "/api/v1/recipients?id=rcp_b", { key: B.key }));
    expect(own.status).toBe(200);
  });

  it("A cannot revoke B's recipient", async () => {
    const { POST } = await ROUTES.revokeRecipient();
    const res = await POST(
      request("POST", "/api/v1/recipients/revoke", {
        key: A.key,
        body: { recipientId: "rcp_b", reason: "cross-tenant attempt" },
      })
    );
    expect(res.status).toBe(404);

    const live = await pg.sql<{ n: number }>(
      `select count(*)::int as n from cp_recipient_destinations
        where organization_id=$1 and recipient_id='rcp_b' and revoked_at is null`,
      [B.org]
    );
    expect(live[0].n).toBe(1);
  });

  it("the same idempotency key in two tenants is two unrelated requests", async () => {
    // If the cache were keyed on the client-chosen key alone, one tenant would
    // receive the other tenant's payment result.
    const key = "shared-key-order-123";
    const { POST } = await ROUTES.recipients();
    const body = (id: string) => ({
      recipientId: id,
      displayName: id,
      destination: { networkId: "base", asset: "USDC", address: ADDR_A },
    });

    const a = await POST(
      request("POST", "/api/v1/recipients", { key: A.key, body: body("rcp_idem_a"), idempotencyKey: key })
    );
    const b = await POST(
      request("POST", "/api/v1/recipients", { key: B.key, body: body("rcp_idem_b"), idempotencyKey: key })
    );
    expect((await json(a)).body.recipientId).toBe("rcp_idem_a");
    expect((await json(b)).body.recipientId).toBe("rcp_idem_b");
  });

  it("A cannot influence B's spend history", async () => {
    // Velocity and drift are computed from the agent's own tenant-scoped
    // history. Leaking it is a disclosure; MISSING it under-counts the
    // attacker's own spend, which is the more dangerous direction.
    const rows = await pg.sql<{ organization_id: string }>(
      `select organization_id from cp_authorizations where agent_id=$1`,
      [B.agent]
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.organization_id).toBe(B.org);
  });
});
