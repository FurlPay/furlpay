import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PgHarness } from "@/lib/controlPlane/__tests__/pgHarness";

// ---------------------------------------------------------------------------
// Human approval, end to end: an agent's payment above the mandate's approval
// threshold is held, cannot execute, is approved by a stepped-up human, and
// then passes the approval guard at execution.
//
// Real stack for the agent side (API key, store, Postgres). The one stub is the
// HUMAN's session: requireUser needs a stored account, which this harness does
// not have. Step-up is real (lib/stepup on the in-memory KV).
// ---------------------------------------------------------------------------

const USER = "user_appr";
const JTI = "jti_appr_session";

vi.mock("@/lib/authz", async (orig) => {
  const actual = await orig<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireUser: vi.fn(async () => ({
      ok: true,
      claims: { sub: USER, jti: JTI },
      account: { user: { id: USER } },
    })),
  };
});

let pg: PgHarness;
let key: string;
let mandateId: string;
let authorizationId: string;
let payloadHash: string;
let approvalId: string;

const ORG = "org_appr";
const ADDR = "0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc";
const ids = { principal: "cpp_appr", operator: "cpo_appr", delegation: "cpd_appr", agent: "cpa_appr" };

function request(method: "GET" | "POST", path: string, opts: { key?: string; body?: unknown } = {}) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": "203.0.113.20" });
  if (opts.key) headers.set("authorization", `Bearer ${opts.key}`);
  return new NextRequest(`https://furlpay.test${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function json(res: Response) {
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

const decide = async (decision: "APPROVE" | "DENY") => {
  const { POST } = await import("@/app/api/control-plane/approvals/[id]/route");
  return json(
    await POST(request("POST", `/api/control-plane/approvals/${approvalId}`, { body: { decision } }), {
      params: Promise.resolve({ id: approvalId }),
    })
  );
};

const execute = async () => {
  const { POST } = await import("../payments/execute/route");
  return json(
    await POST(
      request("POST", "/api/v1/payments/execute", {
        key,
        body: { authorizationId, payloadHash, rail: "x402_usdc_arbitrum" },
      })
    )
  );
};

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://pglite.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-service-role";
  process.env.FACILITATOR_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
  process.env.FURLPAY_KMS_PROVIDER = "none-test-harness";
  const { startPg } = await import("@/lib/controlPlane/__tests__/pgHarness");
  pg = await startPg();

  await pg.sql(`insert into cp_organizations (id, name, owner_user_id, environment) values ($1,'Approvals',$2,'sandbox')`, [ORG, USER]);
  await pg.sql(`insert into cp_principals (id, organization_id, kind, status) values ($1,$2,'entity','ACTIVE')`, [ids.principal, ORG]);
  await pg.sql(`insert into cp_operators (id, organization_id, name) values ($1,$2,'op')`, [ids.operator, ORG]);
  const scope = JSON.stringify({ maxAmountPerTxAtomic: "100000000", maxCumulativeAtomic: "1000000000" });
  await pg.sql(
    `insert into cp_delegations (id, organization_id, principal_id, operator_id, on_behalf_of, scope, expires_at)
     values ($1,$2,$3,$4,$3,$5, now() + interval '30 days')`,
    [ids.delegation, ORG, ids.principal, ids.operator, scope]
  );
  await pg.sql(
    `insert into cp_agents (id, organization_id, principal_id, operator_id, name, scope, expires_at)
     values ($1,$2,$3,$4,'agent',$5, now() + interval '30 days')`,
    [ids.agent, ORG, ids.principal, ids.operator, scope]
  );
  const { createApiKey } = await import("@/lib/apiKeys");
  key = (
    await createApiKey({
      userId: USER,
      name: "agent key",
      prefix: "sk",
      environment: "test",
      scopes: ["payments:create", "payments:read", "agents:manage"],
    })
  ).secret;

  const recipients = await import("../recipients/route");
  const r = await json(
    await recipients.POST(
      request("POST", "/api/v1/recipients", {
        key,
        body: { recipientId: "rcp_appr", displayName: "Supplier", destination: { networkId: "base", asset: "USDC", address: ADDR } },
      })
    )
  );
  if (r.status !== 201) throw new Error(`recipient: ${r.status} ${JSON.stringify(r.body)}`);
  await pg.sql(`update cp_recipients set status='ACTIVE' where organization_id=$1 and id='rcp_appr'`, [ORG]);

  const mandates = await import("../mandates/route");
  const m = await json(
    await mandates.POST(
      request("POST", "/api/v1/mandates", {
        key,
        body: {
          principalId: ids.principal,
          delegatedTo: ids.agent,
          authorityScope: {
            currency: "USD",
            maxAmountPerTxAtomic: "50000000",
            maxCumulativeAtomic: "500000000",
            spendingWindowSeconds: 86400,
            asset: "USDC",
            networks: ["base"],
            allowedRails: ["x402_usdc_arbitrum"],
            // Anything over 0.50 USDC needs a person.
            requireHumanApprovalAboveAtomic: "500000",
          },
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      })
    )
  );
  if (m.status !== 201) throw new Error(`mandate: ${m.status} ${JSON.stringify(m.body)}`);
  mandateId = m.body.id as string;
}, 180_000);

afterAll(async () => {
  pg?.restore();
  await pg?.db.close();
});

describe("a payment that needs a human", () => {
  it("is held for approval at authorization", async () => {
    const { POST } = await import("../payments/authorize/route");
    const { status, body } = await json(
      await POST(
        request("POST", "/api/v1/payments/authorize", {
          key,
          body: {
            mandateId,
            agentId: ids.agent,
            amount: "1000000",
            asset: "USDC",
            currency: "USD",
            network: "base",
            rail: "x402_usdc_arbitrum",
            recipient: { id: "rcp_appr", destination: ADDR },
          },
        })
      )
    );
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.phase).toBe("PENDING_APPROVAL");
    expect((body.approval as Record<string, unknown>).required).toBe(true);
    authorizationId = body.id as string;
    payloadHash = body.payloadHash as string;
  });

  it("cannot execute while it waits", async () => {
    const { status, body } = await execute();
    expect(status).toBe(409);
    expect(["not_authorized", "wrong_phase"]).toContain(body.error);
  });

  it("appears in the human's queue", async () => {
    const { GET } = await import("@/app/api/control-plane/approvals/route");
    const { status, body } = await json(await GET(request("GET", "/api/control-plane/approvals")));
    expect(status, JSON.stringify(body)).toBe(200);
    const queue = body.approvals as { id: string; authorizationId: string; payment: Record<string, unknown> }[];
    const entry = queue.find((q) => q.authorizationId === authorizationId);
    expect(entry).toBeDefined();
    expect(entry!.payment.amount).toBe("1000000");
    approvalId = entry!.id;
  });

  it("refuses an approval without a fresh step-up", async () => {
    const { status, body } = await decide("APPROVE");
    expect(status).toBe(401);
    expect(body.error).toBe("step_up_required");
    const [ap] = await pg.sql<{ approved_at: string | null }>(`select approved_at from cp_approvals where id=$1`, [approvalId]);
    expect(ap.approved_at).toBeNull();
  });

  it("approves after step-up, consuming it", async () => {
    const { recordStepUp, recentStepUp } = await import("@/lib/stepup");
    await recordStepUp(USER, JTI, "passkey");
    const { status, body } = await decide("APPROVE");
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ phase: "APPROVED", replayed: false });
    expect(await recentStepUp(USER, JTI)).toBe(false);
  });

  it("then passes the approval guard and stops only at the absent rail", async () => {
    const { status, body } = await execute();
    // Same answer an ALLOW payment gets in this harness: nothing about the
    // decision or the approval refused it, only that no rail is connected.
    expect(status, JSON.stringify(body)).toBe(503);
    expect(body.error).toBe("rail_not_connected");
  });

  it("an API key cannot reach the decide route", async () => {
    const { requireUser } = await import("@/lib/authz");
    vi.mocked(requireUser).mockResolvedValueOnce({
      ok: false,
      res: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);
    const { POST } = await import("@/app/api/control-plane/approvals/[id]/route");
    const res = await POST(
      request("POST", `/api/control-plane/approvals/${approvalId}`, { key, body: { decision: "DENY" } }),
      { params: Promise.resolve({ id: approvalId }) }
    );
    expect(res.status).toBe(401);
  });
});
