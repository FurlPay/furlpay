import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Redis configured but refusing every command — production on 2026-10-02.
// Before the fix the claim failure was treated as "won", so a retried money
// request executed again with no duplicate protection.
vi.mock("@/lib/kv", () => ({
  kvBackend: "redis",
  kvGet: vi.fn(async () => {
    throw new Error('kv redis error 403: {"error":"ERR This database has reached current Fixed plan limits."}');
  }),
  kvSetNx: vi.fn(async () => {
    throw new Error('kv redis error 403: {"error":"ERR This database has reached current Fixed plan limits."}');
  }),
  kvSet: vi.fn(async () => {}),
  kvDel: vi.fn(async () => {}),
}));

const { withIdempotency } = await import("../idempotency");

describe("withIdempotency during a store outage", () => {
  it("refuses with 503 and does NOT run the handler when a key was supplied", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await withIdempotency("key-123", "wallets.transfer", handler, { principal: "u1", request: { amount: 5 } });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(await res.json()).toMatchObject({ error: "idempotency_unavailable" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("a retry during the outage still does not execute", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    await withIdempotency("key-123", "wallets.transfer", handler, { principal: "u1" });
    await withIdempotency("key-123", "wallets.transfer", handler, { principal: "u1" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("a request WITHOUT a key is unaffected (no dedupe was requested)", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const res = await withIdempotency(null, "wallets.transfer", handler, { principal: "u1" });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
