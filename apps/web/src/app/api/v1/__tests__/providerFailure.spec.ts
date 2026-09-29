import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import type { PgHarness } from "@/lib/controlPlane/__tests__/pgHarness";
import type { RailAdapter, RailOutcome } from "@/lib/controlPlane/railAdapter";

// ---------------------------------------------------------------------------
// What the system does when the rail misbehaves.
//
// Every scenario below is driven through the REAL `/payments/execute` handler
// against REAL Postgres, with a deterministic adapter registered at the real
// rail seam. Nothing here mocks the route, the store, or the decision.
//
// THE ONE INVARIANT EVERYTHING SERVES:
//
//     UNKNOWN is not FAILED, and UNKNOWN is not SETTLED.
//
// Both collapses are expensive and they are expensive in opposite directions.
// Calling an unknown outcome FAILED invites a retry, and if the first attempt
// actually landed the retry pays twice. Calling it SETTLED records money as
// moved that may never have moved. So the only safe response to "we do not
// know" is to say so, hold the payment in EXECUTING, and reconcile.
//
// THE SECOND INVARIANT: a rail that fails does not become a different rail.
// `authorizeFailover` defaults to refusing, and the execute path never looks up
// an alternative adapter. A rail we cannot get an answer from may already have
// taken the money; sending the same payment down a second rail is precisely the
// double payment this design exists to prevent.
// ---------------------------------------------------------------------------

const RAIL = "x402_usdc_arbitrum";
const OTHER_RAIL = "stablecoin_cctp";
const ADDR = "0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc";

let pg: PgHarness;
let rails: typeof import("@/lib/controlPlane/railAdapter");
let createApiKey: typeof import("@/lib/apiKeys").createApiKey;

let KEY = "";
const ORG = "org_provider";
const USER = "user_provider";
const AGENT = "cpa_provider";
let MANDATE = "";

/** What the next submit() call will do. Set per test. */
let nextOutcome: () => Promise<RailOutcome>;
let submitCalls: { idempotencyKey: string; destination: string; amountAtomic: string }[] = [];

const stub: RailAdapter = {
  railId: RAIL,
  testOnly: true,
  async submit(req) {
    submitCalls.push({
      idempotencyKey: req.idempotencyKey,
      destination: req.destination,
      amountAtomic: req.amountAtomic,
    });
    return nextOutcome();
  },
};

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://furlpay.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
      "x-forwarded-for": "203.0.113.20",
    },
    body: JSON.stringify(body),
  });
}

async function json(res: Response) {
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** A fresh ALLOW authorization. Each execution test needs its own. */
async function authorize(): Promise<{ id: string; payloadHash: string }> {
  const { POST } = await import("../payments/authorize/route");
  const res = await POST(
    request("/api/v1/payments/authorize", {
      mandateId: MANDATE,
      agentId: AGENT,
      amount: "1000000",
      asset: "USDC",
      currency: "USD",
      network: "base",
      rail: RAIL,
      recipient: { id: "rcp_p", destination: ADDR },
    })
  );
  const { status, body } = await json(res);
  if (status !== 201) throw new Error(`authorize failed: ${status} ${JSON.stringify(body)}`);
  return { id: body.id as string, payloadHash: body.payloadHash as string };
}

async function execute(id: string, payloadHash: string, rail = RAIL) {
  const { POST } = await import("../payments/execute/route");
  return json(await POST(request("/api/v1/payments/execute", { authorizationId: id, payloadHash, rail })));
}

async function phaseOf(id: string): Promise<string> {
  const rows = await pg.sql<{ phase: string }>(
    `select phase from cp_authorizations where id=$1`,
    [id]
  );
  return rows[0]?.phase;
}

async function attemptsFor(id: string) {
  return pg.sql<{ state: string; settlement_ref: string | null; failure_reason: string | null }>(
    `select state, settlement_ref, failure_reason from cp_execution_attempts
      where authorization_id=$1 order by id asc`,
    [id]
  );
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "http://pglite.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "harness-service-role";
  process.env.FACILITATOR_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
  process.env.FURLPAY_KMS_PROVIDER = "none-test-harness";

  const { startPg } = await import("@/lib/controlPlane/__tests__/pgHarness");
  pg = await startPg();
  rails = await import("@/lib/controlPlane/railAdapter");
  ({ createApiKey } = await import("@/lib/apiKeys"));

  await pg.sql(`insert into cp_organizations (id,name,owner_user_id,environment) values ($1,'p',$2,'sandbox')`, [ORG, USER]);
  await pg.sql(`insert into cp_principals (id,organization_id,kind,status) values ('cpp_provider',$1,'entity','ACTIVE')`, [ORG]);
  await pg.sql(`insert into cp_operators (id,organization_id,name) values ('cpo_provider',$1,'p')`, [ORG]);
  await pg.sql(
    `insert into cp_delegations (id,organization_id,principal_id,operator_id,on_behalf_of,scope,expires_at)
     values ('cpd_provider',$1,'cpp_provider','cpo_provider','cpp_provider','{}'::jsonb, now()+interval '30 days')`,
    [ORG]
  );
  await pg.sql(
    `insert into cp_agents (id,organization_id,principal_id,operator_id,name,scope,expires_at)
     values ($1,$2,'cpp_provider','cpo_provider','p','{}'::jsonb, now()+interval '30 days')`,
    [AGENT, ORG]
  );
  await pg.sql(
    `insert into cp_recipients (id,organization_id,display_name,status) values ('rcp_p',$1,'payee','ACTIVE')`,
    [ORG]
  );
  await pg.sql(
    `insert into cp_recipient_destinations (organization_id,recipient_id,network_id,asset,
       address_canonical,address_display,method,provenance)
     values ($1,'rcp_p','base','USDC',$2,$2,'human_confirmed','user:test')`,
    [ORG, ADDR.toLowerCase()]
  );

  KEY = (
    await createApiKey({
      userId: USER,
      name: "provider harness",
      prefix: "sk",
      environment: "test",
      scopes: ["payments:create", "payments:read", "agents:manage"],
    })
  ).secret;

  const { POST } = await import("../mandates/route");
  const res = await POST(
    request("/api/v1/mandates", {
      principalId: "cpp_provider",
      delegatedTo: AGENT,
      authorityScope: {
        currency: "USD",
        maxAmountPerTxAtomic: "50000000",
        maxCumulativeAtomic: "5000000000",
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
  rails?.unregisterRailAdapter(RAIL);
  pg?.restore();
  await pg?.db.close();
});

beforeEach(() => {
  submitCalls = [];
  rails.registerRailAdapter(stub);
});

// ───────────────────────────────────────────────────────────────────────────

describe("the unconnected case still behaves exactly as before", () => {
  it("answers 503 rail_not_connected when no adapter is registered", async () => {
    rails.unregisterRailAdapter(RAIL);
    const a = await authorize();
    const { status, body } = await execute(a.id, a.payloadHash);
    expect(status).toBe(503);
    expect(body.error).toBe("rail_not_connected");
    // And it is INDETERMINATE, not FAILED: nothing was observed.
    expect((await attemptsFor(a.id))[0].state).toBe("INDETERMINATE");
    expect(await phaseOf(a.id)).toBe("EXECUTING");
  });

  it("refuses to register a test-only adapter in production", async () => {
    // The guard against a test double becoming a live-money bypass by being
    // left registered. A silent no-op here would be worse than a throw: the
    // deployment would look connected.
    const prev = process.env.FURLPAY_ENV;
    process.env.FURLPAY_ENV = "production";
    try {
      expect(() => rails.registerRailAdapter(stub)).toThrow(/test-only/);
    } finally {
      if (prev === undefined) delete process.env.FURLPAY_ENV;
      else process.env.FURLPAY_ENV = prev;
    }
  });
});

describe("authoritative outcomes are recorded as what they are", () => {
  it("SETTLED with a reference settles, and records the reference", async () => {
    nextOutcome = async () => ({ kind: "SETTLED", settlementRef: "0xdeadbeef", confirmations: 3 });
    const a = await authorize();
    const { status, body } = await execute(a.id, a.payloadHash);
    expect(status).toBe(200);
    expect(body.settlementRef).toBe("0xdeadbeef");
    expect(await phaseOf(a.id)).toBe("SETTLED");
    expect((await attemptsFor(a.id))[0].state).toBe("SETTLED");
  });

  it("REJECTED fails the payment, because the provider told us money did not move", async () => {
    nextOutcome = async () => ({ kind: "REJECTED", reason: "insufficient balance" });
    const a = await authorize();
    const { status, body } = await execute(a.id, a.payloadHash);
    expect(status).toBe(502);
    expect(body.error).toBe("rail_rejected");
    expect(await phaseOf(a.id)).toBe("FAILED");
    expect((await attemptsFor(a.id))[0].state).toBe("FAILED");
  });

  it("PENDING stays EXECUTING — accepted is not settled", async () => {
    nextOutcome = async () => ({ kind: "PENDING", railRef: "tx_pending_1" });
    const a = await authorize();
    const { status, body } = await execute(a.id, a.payloadHash);
    expect(status).toBe(200);
    expect(body.state).toBe("PENDING");
    // Calling this SETTLED because the provider accepted it is how a payment
    // that later reverses gets recorded as complete.
    expect(await phaseOf(a.id)).toBe("EXECUTING");
  });
});

describe("every flavour of not-knowing becomes INDETERMINATE", () => {
  const unknowns: [string, () => Promise<RailOutcome>][] = [
    ["a thrown error", async () => { throw new Error("ECONNRESET"); }],
    ["a rejected promise", () => Promise.reject(new Error("socket hang up"))],
    ["an explicit INDETERMINATE", async () => ({ kind: "INDETERMINATE", reason: "unknown" })],
    ["a null return", async () => null as unknown as RailOutcome],
    ["a non-object return", async () => "ok" as unknown as RailOutcome],
    ["an unrecognised kind", async () => ({ kind: "MAYBE" }) as unknown as RailOutcome],
    // The important one: a provider claiming success it cannot evidence.
    ["SETTLED with no reference", async () => ({ kind: "SETTLED" }) as unknown as RailOutcome],
    ["SETTLED with an empty reference", async () => ({ kind: "SETTLED", settlementRef: "  " }) as RailOutcome],
    ["PENDING with no reference to poll", async () => ({ kind: "PENDING" }) as unknown as RailOutcome],
  ];

  for (const [label, outcome] of unknowns) {
    it(`${label} → 503 rail_indeterminate, phase EXECUTING, never FAILED`, async () => {
      nextOutcome = outcome;
      const a = await authorize();
      const { status, body } = await execute(a.id, a.payloadHash);

      expect(status).toBe(503);
      expect(body.error).toBe("rail_indeterminate");
      // NOT FAILED. "Failed" invites a retry, and the submission may have landed.
      expect(await phaseOf(a.id)).toBe("EXECUTING");
      const attempts = await attemptsFor(a.id);
      expect(attempts[0].state).toBe("INDETERMINATE");
      // And above all: no settlement reference was invented.
      expect(attempts[0].settlement_ref).toBeNull();
    });
  }

  it("a timeout is INDETERMINATE, not FAILED — it may have landed", async () => {
    // A timeout before submission and a timeout after submission are
    // indistinguishable from here, and the second one may have moved money.
    nextOutcome = () => new Promise<RailOutcome>(() => {}); // never resolves
    const a = await authorize();
    const { POST } = await import("../payments/execute/route");
    // submitToRail's own timeout is 15s; the route is driven directly so the
    // wait is real. Kept short by the adapter never resolving.
    const res = await POST(
      request("/api/v1/payments/execute", {
        authorizationId: a.id,
        payloadHash: a.payloadHash,
        rail: RAIL,
      })
    );
    const { status, body } = await json(res);
    expect(status).toBe(503);
    expect(body.error).toBe("rail_indeterminate");
    expect(String(body.reason)).toMatch(/no response|may have landed/i);
    expect(await phaseOf(a.id)).toBe("EXECUTING");
  }, 60_000);
});

describe("an indeterminate payment cannot be pushed onto another rail", () => {
  it("never reaches a healthy alternative rail, even on a fresh authorization", async () => {
    // THE SCENARIO: rail X is authorized and unhealthy, rail Y is healthy. A
    // caller — or a well-meaning retry layer — tries Y. Rail X may already have
    // taken the money, so moving the same payment down Y is the double payment
    // this design exists to prevent.
    //
    // A fresh authorization is used deliberately: after a failed attempt the
    // phase check at step 1 refuses first, which is safe but proves the wrong
    // thing. This proves the RAIL check itself refuses.
    let alternativeCalled = false;
    const healthy: RailAdapter = {
      railId: OTHER_RAIL,
      testOnly: true,
      async submit() {
        alternativeCalled = true;
        return { kind: "SETTLED", settlementRef: "0xSHOULD_NEVER_HAPPEN" };
      },
    };
    rails.registerRailAdapter(healthy);
    try {
      const a = await authorize(); // authorized for RAIL, in AUTHORIZED phase
      const { status, body } = await execute(a.id, a.payloadHash, OTHER_RAIL);
      expect(status).toBe(409);
      expect(body.error).toBe("rail_not_authorized");
      expect(alternativeCalled, "the unauthorized rail was actually invoked").toBe(false);
      // And the payment is untouched — a refused failover is not a failure.
      expect(await phaseOf(a.id)).toBe("AUTHORIZED");
    } finally {
      rails.unregisterRailAdapter(OTHER_RAIL);
    }
  });

  it("refuses a second execute naming an alternative rail after an unknown outcome", async () => {
    // The same protection one layer earlier: once a payment is mid-flight with
    // an unknown outcome, the phase check refuses before the rail check is even
    // reached. Both layers matter; this one is what a retry loop actually hits.
    nextOutcome = async () => ({ kind: "INDETERMINATE", reason: "gateway timeout" });
    const a = await authorize();
    await execute(a.id, a.payloadHash);
    expect(await phaseOf(a.id)).toBe("EXECUTING");

    let alternativeCalled = false;
    const healthy: RailAdapter = {
      railId: OTHER_RAIL,
      testOnly: true,
      async submit() {
        alternativeCalled = true;
        return { kind: "SETTLED", settlementRef: "0xSHOULD_NEVER_HAPPEN" };
      },
    };
    rails.registerRailAdapter(healthy);
    try {
      const { status, body } = await execute(a.id, a.payloadHash, OTHER_RAIL);
      expect(status).toBe(409);
      // Refused by the phase guard, which sits ahead of the rail guard.
      expect(body.error).toBe("wrong_phase");
      expect(alternativeCalled, "the unauthorized rail was actually invoked").toBe(false);
      expect(await phaseOf(a.id)).toBe("EXECUTING");
    } finally {
      rails.unregisterRailAdapter(OTHER_RAIL);
    }
  });

  it("refuses a retry on the SAME rail while the outcome is unknown", async () => {
    nextOutcome = async () => ({ kind: "INDETERMINATE", reason: "gateway timeout" });
    const a = await authorize();
    await execute(a.id, a.payloadHash);
    const callsAfterFirst = submitCalls.length;

    // The phase is EXECUTING, which `wrong_phase` refuses. That is what stops a
    // client hammering retry from submitting twice.
    const second = await execute(a.id, a.payloadHash);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("wrong_phase");
    expect(submitCalls.length, "the rail was called a second time").toBe(callsAfterFirst);
  });
});

describe("idempotency at the provider boundary", () => {
  it("presents a key derived from the authorization, not from the request", async () => {
    // A per-request key would make each retry a NEW payment at the provider's
    // end, which is how a timeout turns into a double spend. It must be stable
    // for a given authorization.
    nextOutcome = async () => ({ kind: "SETTLED", settlementRef: "0xidem" });
    const a = await authorize();
    await execute(a.id, a.payloadHash);
    expect(submitCalls).toHaveLength(1);
    expect(submitCalls[0].idempotencyKey).toBe(`cpexec:${ORG}:${a.id}`);
  });

  it("hands the rail the CANONICAL destination and the authorized amount", async () => {
    // Not the raw request string. If the rail were given a caller-supplied form
    // the attestation check would have verified one address and paid another.
    nextOutcome = async () => ({ kind: "SETTLED", settlementRef: "0xcanon" });
    const a = await authorize();
    await execute(a.id, a.payloadHash);
    expect(submitCalls[0].destination).toBe(ADDR.toLowerCase());
    expect(submitCalls[0].amountAtomic).toBe("1000000");
  });

  it("a settled payment cannot be executed again", async () => {
    nextOutcome = async () => ({ kind: "SETTLED", settlementRef: "0xonce" });
    const a = await authorize();
    expect((await execute(a.id, a.payloadHash)).status).toBe(200);
    const calls = submitCalls.length;

    const again = await execute(a.id, a.payloadHash);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("wrong_phase");
    expect(submitCalls.length, "a settled payment was submitted twice").toBe(calls);
  });
});

describe("recovery and reconciliation", () => {
  it("an indeterminate payment is visible for reconciliation", async () => {
    nextOutcome = async () => ({ kind: "INDETERMINATE", reason: "provider vanished" });
    const a = await authorize();
    await execute(a.id, a.payloadHash);

    const rows = await pg.sql<{ authorization_id: string }>(
      `select authorization_id from cp_indeterminate_executions where authorization_id=$1`,
      [a.id]
    );
    expect(rows, "an indeterminate payment did not surface for reconciliation").toHaveLength(1);
  });

  it("a rail that recovers still cannot resurrect a payment on its own", async () => {
    // The provider coming back healthy is not, by itself, permission to move
    // money for a decision whose outcome is unknown. Reconciliation is a
    // deliberate act, not an automatic consequence of the rail returning.
    nextOutcome = async () => ({ kind: "INDETERMINATE", reason: "down" });
    const a = await authorize();
    await execute(a.id, a.payloadHash);

    nextOutcome = async () => ({ kind: "SETTLED", settlementRef: "0xrecovered" });
    const retry = await execute(a.id, a.payloadHash);
    expect(retry.status).toBe(409);
    expect(await phaseOf(a.id)).toBe("EXECUTING");
  });

  it("no evidence record is written by execution, and none is altered", async () => {
    // Evidence belongs to the DECISION. An execution attempt is recorded in
    // cp_execution_attempts; rewriting the evidence bundle afterwards would
    // break the hash chain and destroy the thing it exists for.
    nextOutcome = async () => ({ kind: "SETTLED", settlementRef: "0xevidence" });
    const a = await authorize();
    const before = await pg.sql<{ leaf_hash: string }>(
      `select leaf_hash from cp_evidence_records where authorization_id=$1`,
      [a.id]
    );
    await execute(a.id, a.payloadHash);
    const after = await pg.sql<{ leaf_hash: string }>(
      `select leaf_hash from cp_evidence_records where authorization_id=$1`,
      [a.id]
    );
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
  });
});

describe("money representation survives the rail boundary", () => {
  it("the amount handed to the rail is an integer string, never a float", async () => {
    nextOutcome = async () => ({ kind: "SETTLED", settlementRef: "0xint" });
    const a = await authorize();
    await execute(a.id, a.payloadHash);
    const amount = submitCalls[0].amountAtomic;
    expect(amount).toMatch(/^[0-9]+$/);
    expect(amount).not.toMatch(/[.eE]/);
    // And it round-trips through BigInt without loss, which a float would not.
    expect(String(BigInt(amount))).toBe(amount);
  });

  it("a fee reported by the rail is stored as an integer column", async () => {
    nextOutcome = async () => ({
      kind: "SETTLED",
      settlementRef: "0xfee",
      feeAtomic: "123456789012345678901234567890",
    });
    const a = await authorize();
    await execute(a.id, a.payloadHash);
    const rows = await pg.sql<{ fee_atomic: string }>(
      `select fee_atomic from cp_execution_attempts where authorization_id=$1`,
      [a.id]
    );
    // A value far beyond BIGINT's ~9.2e18 ceiling, stored exactly.
    expect(rows[0].fee_atomic).toBe("123456789012345678901234567890");
  });
});

// Keep the import referenced so the type-only import is not elided.
void createHash;
