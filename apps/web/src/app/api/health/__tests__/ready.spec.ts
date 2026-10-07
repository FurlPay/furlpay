import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// /api/health/ready — readiness: 503 when KV (write) or the database is down.
// The 7 Oct 2026 outage: Upstash rejected writes with a plan limit while
// /api/health said "ok". This pins that the new probe would have gone red.

const S = vi.hoisted(() => ({ kv: "ok" as "ok" | "plan_limit" | "hang" | "memory", db: "ok" as "ok" | "down" | "none", sets: 0 }));

vi.mock("@/lib/kv", async (orig) => {
  const real = await orig<typeof import("@/lib/kv")>();
  return {
    ...real,
    get kvBackend() {
      return S.kv === "memory" ? "memory" : "redis";
    },
    kvSet: vi.fn(async () => {
      S.sets++;
      if (S.kv === "plan_limit") throw new real.KvError("ERR max plan limit exceeded", "plan_limit", 400);
      if (S.kv === "hang") return new Promise<void>(() => {});
    }),
    kvGet: vi.fn(async () => 1),
    // The route's own rate limit must not depend on the mocked store.
    kvIncr: vi.fn(async () => 1),
  };
});
vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  get supabaseBackend() {
    return S.db === "none" ? "none" : "supabase";
  },
  sbSelect: vi.fn(async () => {
    if (S.db === "down") throw new Error("connect ECONNREFUSED");
    return [];
  }),
}));

import { GET } from "../ready/route";
import { readiness, resetReadinessCache } from "@/lib/health/readiness";

const get = () => GET(new NextRequest("http://localhost/api/health/ready", { headers: { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` } }));

beforeEach(() => {
  S.kv = "ok";
  S.db = "ok";
  S.sets = 0;
  resetReadinessCache();
});

describe("GET /api/health/ready", () => {
  it("is 200 when KV accepts a write and the database answers", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.ready).toBe(true);
    expect(b.checks.kv.status).toBe("ok");
    expect(b.checks.database.status).toBe("ok");
  });

  it("is 503 with category plan_limit when KV rejects writes (the 7 Oct outage)", async () => {
    S.kv = "plan_limit";
    const res = await get();
    expect(res.status).toBe(503);
    const b = await res.json();
    expect(b.checks.kv).toMatchObject({ status: "down", category: "plan_limit" });
    expect(JSON.stringify(b)).not.toMatch(/ERR|upstash|token/i);
  });

  it("is 503 when KV hangs (bounded by the probe timeout)", async () => {
    S.kv = "hang";
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const p = readiness();
    await vi.advanceTimersByTimeAsync(3_000);
    const snap = await p;
    vi.useRealTimers();
    expect(snap.ready).toBe(false);
    expect(snap.checks.kv).toMatchObject({ status: "down", category: "timeout" });
  });

  it("is 503 when the database is down, and when a dependency is not configured", async () => {
    S.db = "down";
    expect((await get()).status).toBe(503);
    resetReadinessCache();
    S.db = "ok";
    S.kv = "memory";
    const b = await (await get()).json();
    expect(b.ready).toBe(false);
    expect(b.checks.kv.status).toBe("not_configured");
  });

  it("caches per instance so a polling monitor costs one probe per window", async () => {
    await get();
    await get();
    await get();
    expect(S.sets).toBe(1);
  });
});
