import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generateKeypair, signMandate, type CartMandate, type IntentMandate } from "@furlpay/ap2";

// Audit F-13: single-use AP2 mandates were guarded by a per-instance Set.
// Here the KV layer is one shared map, standing in for Redis, and each request
// gets a fresh copy of the route module — what two serverless instances are.
const shared = new Map<string, unknown>();
const kvState = { down: false };

vi.mock("@/lib/kv", async (orig) => {
  const real = await orig<typeof import("@/lib/kv")>();
  return {
    ...real,
    kvSetNx: vi.fn(async (key: string, value: unknown) => {
      if (kvState.down) throw new real.KvError("kv redis error: unreachable", "network", null);
      await new Promise((r) => setTimeout(r, 1));
      if (shared.has(key)) return false;
      shared.set(key, value);
      return true;
    }),
  };
});
vi.mock("@/lib/rateLimit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rateLimit")>()),
  rateLimitOr429: vi.fn(async () => null),
}));

async function freshInstance() {
  vi.resetModules();
  return (await import("../route")).POST;
}

async function mandates(opts: { singleUse?: boolean; cartNonce?: string; expiresInMs?: number } = {}) {
  const user = await generateKeypair();
  const merchant = await generateKeypair();
  const now = Date.now();
  const intent: IntentMandate = {
    type: "IntentMandate",
    id: "im_route",
    user: "did:furlpay:user",
    agent: "did:furlpay:agent",
    constraints: { maxAmount: 50, currency: "USDC", expiresAt: now + (opts.expiresInMs ?? 600_000), singleUse: opts.singleUse ?? true },
    issuedAt: now,
    nonce: "intent-nonce-0001",
  };
  const cart: CartMandate = {
    type: "CartMandate",
    id: "cm_route",
    intentMandateId: "im_route",
    merchant: "shop.example",
    items: [{ name: "Widget", amount: 12.5, quantity: 1 }],
    total: 12.5,
    currency: "USDC",
    createdAt: now,
    nonce: opts.cartNonce ?? "cart-nonce-0001",
  };
  return {
    cart: await signMandate(cart, merchant.privateKey, "m"),
    intent: await signMandate(intent, user.privateKey, "u"),
    userPublicKey: user.publicKey,
    cartSignerPublicKey: merchant.publicKey,
  };
}

const post = (body: unknown) =>
  new NextRequest("https://furlpay.com/api/agents/ap2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  shared.clear();
  kvState.down = false;
});

describe("POST /api/agents/ap2 — durable single use (F-13)", () => {
  it("authorizes once, then refuses the same mandate on a different instance", async () => {
    const body = await mandates();
    const first = await (await freshInstance())(post(body));
    expect(first.status).toBe(200);
    expect((await first.json()).settlement.maxAmountRequired).toBe("12500000");

    const replay = await (await freshInstance())(post(body));
    expect(replay.status).toBe(402);
    expect((await replay.json()).code).toBe("replayed");
  });

  it("a burst of concurrent presentations across instances yields exactly one authorization", async () => {
    const body = await mandates();
    const handlers = await Promise.all(Array.from({ length: 4 }, freshInstance));
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => handlers[i % 4](post(body))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("a new cart under a single-use intent is still refused once the intent is consumed", async () => {
    const first = await mandates({ cartNonce: "cart-nonce-A001" });
    expect((await (await freshInstance())(post(first))).status).toBe(200);
    // Same intent nonce, different cart: the intent claim must refuse it.
    const second = await mandates({ cartNonce: "cart-nonce-B002" });
    const res = await (await freshInstance())(post(second));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("replayed");
  });

  it("stores hashed, kind-namespaced keys that expire after the mandate", async () => {
    await (await freshInstance())(post(await mandates()));
    const keys = [...shared.keys()];
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(k).toMatch(/^ap2:nonce:(cart|intent):[0-9a-f]{64}$/);
  });

  it("refuses with 503 — not per-instance memory — when the store is unreachable", async () => {
    kvState.down = true;
    const res = await (await freshInstance())(post(await mandates()));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("replay_protection_unavailable");
  });

  it("refuses an intent valid for longer than the replay record is kept", async () => {
    const res = await (await freshInstance())(post(await mandates({ expiresInMs: 31 * 86_400_000 })));
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("validity_too_long");
    expect(shared.size).toBe(0);
  });

  it("validates the body before any authorization work", async () => {
    const handler = await freshInstance();
    expect((await handler(post("{not json"))).status).toBe(400);
    expect((await handler(post({ cart: {}, intent: {} }))).status).toBe(400);
    const body = await mandates();
    expect((await handler(post({ ...body, extra: "field" }))).status).toBe(400);
    expect(shared.size).toBe(0);
  });
});
