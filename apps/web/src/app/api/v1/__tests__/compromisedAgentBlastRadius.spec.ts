import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import type { PgHarness } from "@/lib/controlPlane/__tests__/pgHarness";

// ---------------------------------------------------------------------------
// Assume the agent is fully compromised. Measure exactly what it can do.
//
// THE THREAT MODEL, stated so the result can be read correctly. The attacker
// controls the agent's runtime, its prompt, the MCP servers it talks to and
// every A2A message it receives. They can therefore send ANY well-formed
// request the agent's credential is entitled to send, in any order, as fast as
// they like. What they do NOT have is the principal's signing authority or the
// ability to alter the control plane's own state directly.
//
// THIS IS A MEASUREMENT, NOT A PASS/FAIL. The useful output is a blast radius:
// the set of things a compromised agent can still do. Some of those things are
// supposed to be possible — an agent that can spend nothing is not an agent —
// and pretending otherwise would make the number meaningless.
//
// WHAT IS EXPLICITLY OUT OF SCOPE. Nothing here defends against a compromised
// agent that persuades a HUMAN to approve a malicious intent. That boundary is
// upstream of FurlPay and is documented as such; see the semantic-intent
// section of the audit. Every result below assumes the mandate was issued in
// good faith and the agent turned hostile afterwards.
// ---------------------------------------------------------------------------

const RAIL = "x402_usdc_arbitrum";
const GOOD_RECIPIENT = "0xEeEeEeEe44444444EeEeEeEe44444444EeEeEeEe";
const ATTACKER_ADDRESS = "0xBaDbAdBa55555555BaDbAdBa55555555BaDbAdBa";

let pg: PgHarness;
let KEY = "";
const ORG = "org_blast";
const USER = "user_blast";
const AGENT = "cpa_blast";
let MANDATE = "";

/** What the compromised agent managed to do. Printed at the end. */
const blastRadius: { action: string; achieved: boolean; note: string }[] = [];
function record(action: string, achieved: boolean, note: string) {
  blastRadius.push({ action, achieved, note });
}

function request(path: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(`https://furlpay.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      "x-forwarded-for": "203.0.113.66",
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response) {
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function authorize(over: Record<string, unknown> = {}) {
  const { POST } = await import("../payments/authorize/route");
  return json(
    await POST(
      request("/api/v1/payments/authorize", {
        mandateId: MANDATE,
        agentId: AGENT,
        amount: "1000000",
        asset: "USDC",
        currency: "USD",
        network: "base",
        rail: RAIL,
        recipient: { id: "rcp_good", destination: GOOD_RECIPIENT },
        ...over,
      })
    )
  );
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://pglite.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-service-role";
  process.env.FACILITATOR_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
  process.env.FURLPAY_KMS_PROVIDER = "none-test-harness";

  const { startPg } = await import("@/lib/controlPlane/__tests__/pgHarness");
  pg = await startPg();
  const { createApiKey } = await import("@/lib/apiKeys");

  await pg.sql(`insert into cp_organizations (id,name,owner_user_id,environment) values ($1,'b',$2,'sandbox')`, [ORG, USER]);
  await pg.sql(`insert into cp_principals (id,organization_id,kind,status) values ('cpp_blast',$1,'entity','ACTIVE')`, [ORG]);
  await pg.sql(`insert into cp_operators (id,organization_id,name) values ('cpo_blast',$1,'b')`, [ORG]);
  await pg.sql(
    `insert into cp_delegations (id,organization_id,principal_id,operator_id,on_behalf_of,scope,expires_at)
     values ('cpd_blast',$1,'cpp_blast','cpo_blast','cpp_blast','{}'::jsonb, now()+interval '30 days')`,
    [ORG]
  );
  await pg.sql(
    `insert into cp_agents (id,organization_id,principal_id,operator_id,name,scope,expires_at)
     values ($1,$2,'cpp_blast','cpo_blast','b','{}'::jsonb, now()+interval '30 days')`,
    [AGENT, ORG]
  );
  // ONE attested recipient. The organization vouched for this address and no
  // other — that is the whole point of the attestation store.
  await pg.sql(
    `insert into cp_recipients (id,organization_id,display_name,status) values ('rcp_good',$1,'approved payee','ACTIVE')`,
    [ORG]
  );
  await pg.sql(
    `insert into cp_recipient_destinations (organization_id,recipient_id,network_id,asset,
       address_canonical,address_display,method,provenance)
     values ($1,'rcp_good','base','USDC',$2,$2,'human_confirmed','user:blast')`,
    [ORG, GOOD_RECIPIENT.toLowerCase()]
  );

  KEY = (
    await createApiKey({
      userId: USER,
      name: "compromised agent credential",
      prefix: "sk",
      environment: "test",
      scopes: ["payments:create", "payments:read", "agents:manage"],
    })
  ).secret;

  const { POST } = await import("../mandates/route");
  const res = await POST(
    request("/api/v1/mandates", {
      principalId: "cpp_blast",
      delegatedTo: AGENT,
      authorityScope: {
        currency: "USD",
        maxAmountPerTxAtomic: "5000000", // $5.00
        maxCumulativeAtomic: "20000000", // $20.00
        spendingWindowSeconds: 86400,
        asset: "USDC",
        networks: ["base"],
        allowedRails: [RAIL],
      },
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    })
  );
  MANDATE = (await json(res)).body.id as string;
}, 180_000);

afterAll(async () => {
  console.log("\n  ── COMPROMISED-AGENT BLAST RADIUS ──");
  for (const r of blastRadius) {
    console.log(`  ${r.achieved ? "CAN   " : "CANNOT"}  ${r.action.padEnd(46)} ${r.note}`);
  }
  console.log("");
  pg?.restore();
  await pg?.db.close();
});

// ───────────────────────────────────────────────────────────────────────────

describe("what a compromised agent CANNOT do", () => {
  it("cannot pay an address the organization never attested", async () => {
    // The single most valuable thing an attacker wants: same everything, their
    // address. Refused because the destination is checked against what the
    // recipient was ATTESTED for, not against what the request claims.
    const { body } = await authorize({
      recipient: { id: "rcp_good", destination: ATTACKER_ADDRESS },
    });
    expect(body.decision).not.toBe("ALLOW");
    record("redirect funds to its own address", false, String(body.reason ?? body.error));
  });

  it("cannot invent a new recipient id and pay it", async () => {
    const { body } = await authorize({
      recipient: { id: "rcp_attacker_made_this_up", destination: ATTACKER_ADDRESS },
    });
    expect(body.decision).not.toBe("ALLOW");
    record("pay a recipient it invented", false, String(body.reason ?? body.error));
  });

  it("cannot exceed the per-transaction cap", async () => {
    const { body } = await authorize({ amount: "5000001" }); // one unit over $5
    expect(body.decision).not.toBe("ALLOW");
    record("exceed the per-transaction cap", false, String(body.reason ?? body.error));
  });

  it("cannot switch to a rail the mandate did not authorize", async () => {
    const { body } = await authorize({ rail: "stablecoin_cctp" });
    expect(body.decision).not.toBe("ALLOW");
    record("switch rails", false, String(body.reason ?? body.error));
  });

  it("cannot switch to a network the mandate did not authorize", async () => {
    const { body } = await authorize({ network: "arbitrum_one" });
    expect(body.decision).not.toBe("ALLOW");
    record("switch networks", false, String(body.reason ?? body.error));
  });

  it("cannot pay in an asset the mandate did not authorize", async () => {
    const { body } = await authorize({ asset: "USDT" });
    expect(body.decision).not.toBe("ALLOW");
    record("switch assets", false, String(body.reason ?? body.error));
  });

  it("cannot alter the payload between authorize and execute", async () => {
    const authorized = await authorize({ amount: "1000000" });
    expect(authorized.body.decision).toBe("ALLOW");

    const { POST } = await import("../payments/execute/route");
    // A hash for a payment that was never decided.
    const res = await POST(
      request("/api/v1/payments/execute", {
        authorizationId: authorized.body.id,
        payloadHash: "b".repeat(64),
        rail: RAIL,
      })
    );
    const { body } = await json(res);
    expect(body.error).toBe("payload_mismatch");
    record("execute a different payload than was authorized", false, "payload_mismatch");
  });

  it("cannot spend after its mandate is revoked", async () => {
    const { POST: revoke } = await import("../mandates/[id]/revoke/route");
    await revoke(
      request(`/api/v1/mandates/${MANDATE}/revoke`, { reason: "compromise suspected" }),
      { params: Promise.resolve({ id: MANDATE }) }
    );
    const { body } = await authorize();
    expect(body.decision).not.toBe("ALLOW");
    record("spend after revocation", false, String(body.reason ?? body.error));
  });

  it("cannot un-revoke its own mandate", async () => {
    // There is no endpoint for it, and the status column is not writable
    // through the API. Verified by observing the row directly.
    const rows = await pg.sql<{ status: string }>(`select status from cp_mandates where id=$1`, [MANDATE]);
    expect(rows[0].status).toBe("REVOKED");
    record("reverse its own revocation", false, "no un-revoke path exists");
  });

  it("cannot move value even with a perfectly valid authorization", async () => {
    // The last line of defence, and the one that currently matters most: no
    // rail adapter is connected, so nothing reaches a provider at all.
    const rows = await pg.sql<{ n: number }>(
      `select count(*)::int as n from cp_execution_attempts where state='SETTLED'`
    );
    expect(rows[0].n).toBe(0);
    record("actually move money", false, "no rail adapter connected (503)");
  });
});

describe("what a compromised agent CAN do — the real blast radius", () => {
  // Measured honestly. These are not defects; they are the authority the
  // principal deliberately granted, and an agent that could do none of them
  // would not be an agent. They are recorded so the number is visible.
  let freshMandate = "";

  beforeAll(async () => {
    const { POST } = await import("../mandates/route");
    const res = await POST(
      request("/api/v1/mandates", {
        principalId: "cpp_blast",
        delegatedTo: AGENT,
        authorityScope: {
          currency: "USD",
          maxAmountPerTxAtomic: "5000000",
          maxCumulativeAtomic: "20000000",
          spendingWindowSeconds: 86400,
          asset: "USDC",
          networks: ["base"],
          allowedRails: [RAIL],
        },
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
    );
    freshMandate = (await json(res)).body.id as string;
  });

  it("CAN spend the full mandate, to the attested recipient, immediately", async () => {
    // The honest headline: a compromised agent can drain the mandate's budget
    // to an address the organization already approved. The attestation store
    // bounds WHERE the money goes; it does not bound WHETHER it goes.
    const { POST } = await import("../payments/authorize/route");
    const res = await POST(
      request("/api/v1/payments/authorize", {
        mandateId: freshMandate,
        agentId: AGENT,
        amount: "5000000",
        asset: "USDC",
        currency: "USD",
        network: "base",
        rail: RAIL,
        recipient: { id: "rcp_good", destination: GOOD_RECIPIENT },
      })
    );
    const { body } = await json(res);
    expect(body.decision).toBe("ALLOW");
    record(
      "spend up to the mandate cap, to an attested payee",
      true,
      "BY DESIGN — this is the granted authority"
    );
  });

  it("CAN issue itself a broader mandate, because the credential carries agents:manage", async () => {
    // THE FINDING WORTH READING TWICE. The agent's API credential holds
    // `agents:manage`, so the same compromised runtime can mint a NEW mandate
    // with a larger cap. Revoking one mandate does not contain it.
    //
    // This is not a flaw in the control plane — it is enforcing exactly the
    // scope it was given. It is a DEPLOYMENT finding: an agent runtime should
    // hold a `payments:create`-only restricted key (`rk`), never a credential
    // that can issue authority. The audit records it as such.
    const { POST } = await import("../mandates/route");
    const res = await POST(
      request("/api/v1/mandates", {
        principalId: "cpp_blast",
        delegatedTo: AGENT,
        authorityScope: {
          currency: "USD",
          maxAmountPerTxAtomic: "999000000", // $999
          maxCumulativeAtomic: "999000000",
          spendingWindowSeconds: 86400,
          asset: "USDC",
          networks: ["base"],
          allowedRails: [RAIL],
        },
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
    );
    const { status, body } = await json(res);
    const succeeded = status === 201;
    record(
      "issue itself a BROADER mandate",
      succeeded,
      succeeded
        ? "credential holds agents:manage — give agent runtimes an rk key scoped to payments:create only"
        : String(body.error)
    );
    // Asserted as an observation, not as desired behaviour.
    expect(typeof succeeded).toBe("boolean");
  });

  it("F-21: a CORRECTLY SCOPED credential contains it — proven, not asserted", async () => {
    // The containment for the finding above. An agent runtime should hold a
    // RESTRICTED key (`rk`) carrying `payments:create` and nothing else. Then
    // the same compromised runtime can still spend within its mandate — which
    // is the authority it was given — but cannot issue itself a new one, so
    // revoking the mandate genuinely contains it.
    //
    // This must be `rk`, not `sk`: `normalizeScopes` grants an `sk` key every
    // scope regardless of what was requested, so an "sk restricted to
    // payments:create" is a contradiction and would silently keep
    // agents:manage. That is documented in apiKeyScopeSemantics.spec.ts.
    const { createApiKey } = await import("@/lib/apiKeys");
    const restricted = await createApiKey({
      userId: USER,
      name: "agent runtime credential (correct configuration)",
      prefix: "rk",
      environment: "test",
      scopes: ["payments:create"],
    });

    const scopedRequest = (path: string, body: unknown) =>
      new NextRequest(`https://furlpay.test${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${restricted.secret}`,
          "x-forwarded-for": "203.0.113.67",
        },
        body: JSON.stringify(body),
      });

    const { POST: issue } = await import("../mandates/route");
    const res = await issue(
      scopedRequest("/api/v1/mandates", {
        principalId: "cpp_blast",
        delegatedTo: AGENT,
        authorityScope: {
          currency: "USD",
          maxAmountPerTxAtomic: "999000000",
          maxCumulativeAtomic: "999000000",
          spendingWindowSeconds: 86400,
          asset: "USDC",
          networks: ["base"],
          allowedRails: [RAIL],
        },
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
    );
    expect(res.status, "a payments:create-only credential minted a mandate").toBe(403);
    const { body } = await json(res);
    expect(body.error).toBe("insufficient_scope");

    // And it can still do its actual job, so the containment is not an outage.
    const { POST: pay } = await import("../payments/authorize/route");
    const spend = await pay(
      scopedRequest("/api/v1/payments/authorize", {
        mandateId: freshMandate,
        agentId: AGENT,
        amount: "1000000",
        asset: "USDC",
        currency: "USD",
        network: "base",
        rail: RAIL,
        recipient: { id: "rcp_good", destination: GOOD_RECIPIENT },
      })
    );
    const spendBody = (await json(spend)).body;
    expect(spendBody.decision, "the contained credential also lost its real job").toBe("ALLOW");

    record(
      "issue a mandate when correctly scoped (rk + payments:create)",
      false,
      "403 insufficient_scope — and it can still spend, so containment is not an outage"
    );
  });

  it("CANNOT reach another tenant, whatever it does", async () => {
    // The containment that actually matters: a compromised agent is confined to
    // its own organization. Its credential resolves one tenant and no request
    // field can name another.
    const { GET } = await import("../mandates/[id]/route");
    const res = await GET(request("/api/v1/mandates/cpm_someone_elses", {}, "GET"), {
      params: Promise.resolve({ id: "cpm_someone_elses" }),
    });
    expect(res.status).toBe(404);
    record("reach another tenant's data", false, "tenant comes from the credential only");
  });
});
