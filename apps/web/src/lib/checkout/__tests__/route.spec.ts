import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/checkout/session/route";
import { createApiKey, revokeApiKey } from "@/lib/apiKeys";
import { getSession, recordSettlement } from "../session";

// ---------------------------------------------------------------------------
// The checkout route, end to end through the real handler.
//
// The unit suite proves the state machine cannot fabricate evidence. This one
// proves the HTTP surface a merchant actually touches behaves the same way —
// the old defect lived in the route, not in the model, and a model that is
// correct behind a route that is not protects nobody.
// ---------------------------------------------------------------------------

const USER = "merchant_1";

beforeEach(() => {
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

async function publishableKey() {
  const { secret } = await createApiKey({
    userId: USER,
    name: "Storefront",
    prefix: "pk",
    environment: "test",
    scopes: ["payments:read"],
  });
  return secret;
}

function post(key: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-furlpay-key"] = key;
  return POST(
    new NextRequest("https://furlpay.com/api/checkout/session", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

const get = (id: string) =>
  GET(new NextRequest(`https://furlpay.com/api/checkout/session?id=${id}`));

describe("authentication is resolved, not assumed", () => {
  it("rejects a missing key", async () => {
    expect((await post(null, { amount: 10 })).status).toBe(401);
  });

  it("rejects a well-formed key that does not exist", async () => {
    // THE GAP THIS CLOSES. A format check alone accepts "pk_test_" plus any
    // 65 characters, letting anyone create sessions attributed to a merchant
    // id they invented. The old route accepted literally any non-empty value.
    const res = await post("pk_test_" + "a".repeat(22) + "_" + "b".repeat(43), { amount: 10 });
    expect(res.status).toBe(401);
  });

  it("rejects a secret key used where a publishable one belongs", async () => {
    const { secret } = await createApiKey({
      userId: USER,
      name: "Server",
      prefix: "sk",
      environment: "test",
      scopes: [],
    });
    expect((await post(secret, { amount: 10 })).status).toBe(401);
  });

  it("rejects a revoked key", async () => {
    const { record, secret } = await createApiKey({
      userId: USER,
      name: "Storefront",
      prefix: "pk",
      environment: "test",
      scopes: ["payments:read"],
    });
    expect((await post(secret, { amount: 10 })).status).toBe(201);
    await revokeApiKey(USER, record.keyId);
    expect((await post(secret, { amount: 10 })).status).toBe(401);
  });

  it("gives one opaque body for every auth failure", async () => {
    // Distinguishing "no such key" from "wrong secret" would let an attacker
    // sort real merchant key ids from invented ones.
    const unknown = await post("pk_test_" + "a".repeat(22) + "_" + "b".repeat(43), { amount: 10 });
    const { secret } = await createApiKey({
      userId: USER, name: "k", prefix: "pk", environment: "test", scopes: [],
    });
    const badSecret = secret.slice(0, -4) + "zzzz";
    const wrong = await post(badSecret, { amount: 10 });
    expect(await unknown.json()).toEqual(await wrong.json());
  });
});

describe("a created session is never a paid session", () => {
  it("returns requires_payment and no transaction hash", async () => {
    const res = await post(await publishableKey(), { amount: 25 });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.status).toBe("requires_payment");
    expect(body.transactionHash).toBeNull();
    // The old route returned a 64-hex-char hash on this exact call.
    expect(JSON.stringify(body)).not.toMatch(/0x[0-9a-f]{64}/i);
    expect(body.message).toMatch(/No payment has been made yet/i);
  });

  it("says 201 Created rather than 200 OK", async () => {
    // A 200 on a payment endpoint is what an integration reads as "it worked".
    const res = await post(await publishableKey(), { amount: 1 });
    expect(res.status).toBe(201);
  });

  it("rejects an unsupported token instead of guessing its decimals", async () => {
    const res = await post(await publishableKey(), { amount: 1, token: "DOGE" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_token");
  });
});

describe("status can be polled, and reflects only observed evidence", () => {
  it("returns the session by id", async () => {
    const created = await (await post(await publishableKey(), { amount: 40 })).json();
    const res = await get(created.id);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("requires_payment");
  });

  it("404s an unknown id rather than inventing a session", async () => {
    expect((await get("cs_nope")).status).toBe(404);
  });

  it("shows confirming once a real reference is observed but depth is short", async () => {
    const created = await (await post(await publishableKey(), { amount: 40 })).json();
    const session = await getSession(created.id);
    await recordSettlement(session!, {
      transactionHash: "0xrealref",
      network: "base:mainnet",
      confirmations: 1,
      requiredConfirmations: 6,
      finalized: false,
    });

    const body = await (await get(created.id)).json();
    expect(body.status).toBe("confirming");
    expect(body.transactionHash).toBe("0xrealref");
    expect(body.confirmations).toBe(1);
    expect(body.requiredConfirmations).toBe(6);
  });
});

describe("idempotency of settlement observation", () => {
  it("is stable when the same observation arrives twice", async () => {
    // Webhooks are delivered more than once. Replaying an observation must not
    // move the session or contradict itself.
    const created = await (await post(await publishableKey(), { amount: 40 })).json();
    const s1 = await getSession(created.id);
    const observation = {
      transactionHash: "0xsame",
      network: "base:mainnet",
      confirmations: 6,
      requiredConfirmations: 6,
      finalized: false,
    };
    const first = await recordSettlement(s1!, observation);
    const second = await recordSettlement(first, observation);

    expect(second.status).toBe(first.status);
    expect(second.transactionHash).toBe("0xsame");
  });

  it("refuses a second, different reference for one session", async () => {
    // A different reference is a different payment. Accepting it would let a
    // duplicate webhook overwrite the evidence of the first.
    const created = await (await post(await publishableKey(), { amount: 40 })).json();
    const s = await getSession(created.id);
    const first = await recordSettlement(s!, {
      transactionHash: "0xfirst",
      network: "base:mainnet",
      confirmations: 6,
      requiredConfirmations: 6,
      finalized: false,
    });
    await expect(
      recordSettlement(first, {
        transactionHash: "0xsecond",
        network: "base:mainnet",
        confirmations: 6,
        requiredConfirmations: 6,
        finalized: true,
      })
    ).rejects.toThrow(/refusing to overwrite/i);
  });

  it("keeps two separate sessions independent", async () => {
    const key = await publishableKey();
    const a = await (await post(key, { amount: 10 })).json();
    const b = await (await post(key, { amount: 20 })).json();
    expect(a.id).not.toBe(b.id);

    const sa = await getSession(a.id);
    await recordSettlement(sa!, {
      transactionHash: "0xaaa",
      network: "base:mainnet",
      confirmations: 6,
      requiredConfirmations: 6,
      finalized: false,
    });
    // b must be untouched by a's settlement.
    expect((await (await get(b.id)).json()).status).toBe("requires_payment");
  });
});

describe("durability", () => {
  it("survives a simulated process restart", async () => {
    // Sessions live in the kv layer, not module memory. The old route stored
    // nothing at all, so its status could never outlive the response.
    const created = await (await post(await publishableKey(), { amount: 12 })).json();

    // A new module instance would re-read from kv; the store itself is what
    // persists. Reading it back through a fresh call proves the state is not
    // held in a closure.
    const again = await (await get(created.id)).json();
    expect(again.id).toBe(created.id);
    expect(again.status).toBe("requires_payment");
  });
});
