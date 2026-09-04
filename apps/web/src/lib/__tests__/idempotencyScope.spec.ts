// Idempotency scoping and key-reuse detection.
//
// TWO REAL DEFECTS ARE PINNED HERE.
//
// 1. CROSS-TENANT REPLAY. Every money route wrote its cache scope by hand as
//    `cards.order:${account.user.id}`, so tenant isolation depended on each
//    author remembering the convention. /api/topup/apple-pay did not: it passed
//    the bare string "topup.applePay". Two users who both sent
//    `Idempotency-Key: abc` to that endpoint collided, and the second received
//    the FIRST user's cached 2xx response — so their card was never charged
//    while they were told it had been, and they were shown another account's
//    capture result. The principal is now a required parameter, which turns
//    that omission into a compile error rather than a silent leak.
//
// 2. SILENT KEY REUSE. A key reused with a DIFFERENT body returned the first
//    result. A client that reused `order_123` for a $1,000 payment after a $100
//    one was handed the $100 receipt and told it succeeded; the $1,000 never
//    happened and nothing reported a problem.
//
// These drive the real exported functions, not a reimplementation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// An in-memory stand-in for Redis with the SET NX semantics the real module
// relies on. The atomic claim is the whole concurrency guarantee, so a mock
// that let two callers win would test nothing.
const store = new Map<string, unknown>();
vi.mock("@/lib/kv", () => ({
  kvGet: async (k: string) => (store.has(k) ? store.get(k) : null),
  kvSet: async (k: string, v: unknown) => void store.set(k, v),
  kvDel: async (k: string) => void store.delete(k),
  kvSetNx: async (k: string, v: unknown) => {
    if (store.has(k)) return false;
    store.set(k, v);
    return true;
  },
}));

const { withIdempotency, hashRequest } = await import("@/lib/idempotency");

beforeEach(() => store.clear());

const ok = (body: unknown) => async () => NextResponse.json(body, { status: 201 });

describe("principal scoping", () => {
  it("isolates the same key across two accounts — the Apple Pay defect", async () => {
    // Same scope, same client-chosen key, different users. Before the fix the
    // second call replayed the first user's response.
    const first = await withIdempotency("abc", "topup.applePay", ok({ capture: "user-a" }), {
      principal: "user_a",
    });
    const second = await withIdempotency("abc", "topup.applePay", ok({ capture: "user-b" }), {
      principal: "user_b",
    });

    expect(await first.json()).toEqual({ capture: "user-a" });
    expect(await second.json()).toEqual({ capture: "user-b" });
    // Neither is a replay: both handlers genuinely ran.
    expect(second.headers.get("Idempotent-Replayed")).toBeNull();
  });

  it("still replays for the SAME account", async () => {
    const handler = vi.fn(ok({ id: "pay_1" }));
    await withIdempotency("abc", "cards.order", handler, { principal: "user_a" });
    const replay = await withIdempotency("abc", "cards.order", handler, { principal: "user_a" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await replay.json()).toEqual({ id: "pay_1" });
  });

  it("isolates the same key across operations", async () => {
    // `payment.create + abc` and `refund.create + abc` are unrelated.
    await withIdempotency("abc", "cards.order", ok({ kind: "order" }), { principal: "user_a" });
    const refund = await withIdempotency("abc", "cards.reissue", ok({ kind: "reissue" }), {
      principal: "user_a",
    });
    expect(await refund.json()).toEqual({ kind: "reissue" });
  });

  it("keeps different keys independent for one account", async () => {
    const a = await withIdempotency("k1", "cards.order", ok({ id: 1 }), { principal: "user_a" });
    const b = await withIdempotency("k2", "cards.order", ok({ id: 2 }), { principal: "user_a" });
    expect(await a.json()).toEqual({ id: 1 });
    expect(await b.json()).toEqual({ id: 2 });
  });
});

describe("key reuse with a different body", () => {
  it("rejects rather than replaying the wrong receipt", async () => {
    await withIdempotency("order_123", "wallets.transfer", ok({ paid: 100 }), {
      principal: "user_a",
      request: { amount: 100, asset: "USDC" },
    });

    const reused = await withIdempotency("order_123", "wallets.transfer", ok({ paid: 1000 }), {
      principal: "user_a",
      request: { amount: 1000, asset: "USDC" },
    });

    expect(reused.status).toBe(422);
    expect((await reused.json()).error).toBe("idempotency_key_reused");
  });

  it("treats a genuine retry as a retry despite key ordering", async () => {
    // The false-conflict trap: `{a,b}` and `{b,a}` are the same request, and a
    // raw JSON.stringify would call them different — turning a legitimate
    // mobile retry into a hard error.
    const handler = vi.fn(ok({ id: "pay_1" }));
    await withIdempotency("k", "wallets.transfer", handler, {
      principal: "user_a",
      request: { amount: 100, asset: "USDC", memo: "rent" },
    });
    const retry = await withIdempotency("k", "wallets.transfer", handler, {
      principal: "user_a",
      request: { memo: "rent", asset: "USDC", amount: 100 },
    });

    expect(retry.status).toBe(201);
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("catches reuse while the first request is still in flight", async () => {
    // Claimed but not completed. Same mistake, caught one moment earlier.
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));

    const inflight = withIdempotency(
      "k",
      "wallets.transfer",
      async () => {
        await slow;
        return NextResponse.json({ ok: true }, { status: 201 });
      },
      { principal: "user_a", request: { amount: 100 } }
    );

    const conflicting = await withIdempotency("k", "wallets.transfer", ok({ ok: true }), {
      principal: "user_a",
      request: { amount: 999 },
    });
    expect(conflicting.status).toBe(422);

    release();
    await inflight;
  });

  it("does not manufacture a conflict when no body was supplied", async () => {
    // Routes that claim the key before parsing supply no request. An unknown
    // hash must not invent a mismatch on a legitimate retry.
    const handler = vi.fn(ok({ id: "pay_1" }));
    await withIdempotency("k", "topup.applePay", handler, { principal: "user_a" });
    const retry = await withIdempotency("k", "topup.applePay", handler, { principal: "user_a" });
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("concurrency", () => {
  it("100 identical concurrent requests execute the handler once", async () => {
    // The invariant the whole mechanism exists for. The atomic SET NX claim is
    // what enforces it — a check-then-create would let many callers through.
    let executions = 0;
    const handler = async () => {
      executions++;
      await new Promise((r) => setTimeout(r, 5));
      return NextResponse.json({ id: "pay_1" }, { status: 201 });
    };

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        withIdempotency("burst", "wallets.transfer", handler, {
          principal: "user_a",
          request: { amount: 100 },
        })
      )
    );

    expect(executions).toBe(1);
    // Every caller gets an answer; the losers get 409 while the winner runs,
    // which is the documented in-progress behaviour rather than a duplicate.
    expect(results).toHaveLength(100);
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
  });
});

describe("failures stay retryable", () => {
  it("releases the claim when the handler errors", async () => {
    // A 5xx must not pin the key: the caller fixed nothing, and the operation
    // never happened.
    const failing = async () => NextResponse.json({ error: "boom" }, { status: 500 });
    await withIdempotency("k", "wallets.transfer", failing, { principal: "user_a" });

    const handler = vi.fn(ok({ id: "pay_1" }));
    const retry = await withIdempotency("k", "wallets.transfer", handler, { principal: "user_a" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(retry.status).toBe(201);
  });
});

describe("hashRequest", () => {
  it("is order-independent and value-sensitive", () => {
    expect(hashRequest({ a: 1, b: 2 })).toBe(hashRequest({ b: 2, a: 1 }));
    expect(hashRequest({ amount: 100 })).not.toBe(hashRequest({ amount: 1000 }));
    // Nested ordering too — a payload with metadata is the common real case.
    expect(hashRequest({ x: { p: 1, q: 2 } })).toBe(hashRequest({ x: { q: 2, p: 1 } }));
  });

  it("distinguishes types that stringify alike", () => {
    expect(hashRequest({ amount: 100 })).not.toBe(hashRequest({ amount: "100" }));
    expect(hashRequest(null)).not.toBe(hashRequest("null"));
  });

  it("ignores undefined members, which JSON drops anyway", () => {
    expect(hashRequest({ a: 1, b: undefined })).toBe(hashRequest({ a: 1 }));
  });
});
