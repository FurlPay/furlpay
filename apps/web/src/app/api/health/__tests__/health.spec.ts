import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// /api/health — liveness only. External dependencies must never decide whether
// a task is healthy: a Postgres/Redis/provider problem that failed this probe
// would make the ALB drain EVERY task at once.
//
// Runs the REAL route and the REAL rate limiter. Only the KV client is doubled,
// so the three KV states can be forced: not configured (in-process limiter),
// configured-but-erroring, and configured-but-HANGING (no response at all).
// ---------------------------------------------------------------------------

const S = vi.hoisted(() => ({ mode: "memory" as "memory" | "error" | "hang", incrCalls: 0 }));

vi.mock("@/lib/kv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kv")>()),
  get kvBackend() {
    return S.mode === "memory" ? "memory" : "redis";
  },
  kvIncr: vi.fn(async () => {
    S.incrCalls++;
    if (S.mode === "error") throw new Error("kv redis error 500: upstream unavailable");
    return new Promise<number>(() => {}); // hang forever
  }),
}));

import * as route from "../route";
import { listAccounts } from "@/lib/store";

let ip = 0;
const get = (addr = `203.0.113.${++ip % 250}`) =>
  route.GET(new NextRequest("http://localhost/api/health", { headers: { "x-forwarded-for": addr } }));

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  S.mode = "memory";
  S.incrCalls = 0;
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => fetchSpy.mockRestore());

describe("/api/health", () => {
  it("1. GET → 200 with a stable body and no caching", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("2+3. needs no session and touches no database or provider — zero outbound requests", async () => {
    const res = await get(); // no cookie, no Authorization header
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled(); // no Supabase (PostgREST), no Upstash, no provider
  });

  it("4+7. a KV that ERRORS fails open — still 200", async () => {
    S.mode = "error";
    const res = await get();
    expect(res.status).toBe(200);
    expect(S.incrCalls).toBe(1);
  });

  it("4. a KV that HANGS cannot hold the probe past its budget — 200 well inside the 5s ALB timeout", async () => {
    S.mode = "hang";
    const t = Date.now();
    const res = await get();
    expect(res.status).toBe(200);
    expect(Date.now() - t).toBeLessThan(1_000);
  });

  it("5. only GET is exported — Next answers any other method with 405", () => {
    const exported = Object.keys(route).filter((k) => /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(k));
    expect(exported).toEqual(["GET"]);
  });

  it("6. repeated requests from one address are rate limited (not an amplification endpoint)", async () => {
    const addr = "198.51.100.77";
    for (let i = 0; i < 600; i++) expect((await get(addr)).status).toBe(200);
    const over = await get(addr);
    expect(over.status).toBe(429);
    // A different address is unaffected.
    expect((await get("198.51.100.78")).status).toBe(200);
  });

  it("8. mutates nothing: no account is created or changed", async () => {
    const before = JSON.stringify(listAccounts().map((a) => [a.user.id, a.tokenBalances, a.user.kycStatus]));
    for (let i = 0; i < 5; i++) await get();
    const after = JSON.stringify(listAccounts().map((a) => [a.user.id, a.tokenBalances, a.user.kycStatus]));
    expect(after).toBe(before);
  });
});
