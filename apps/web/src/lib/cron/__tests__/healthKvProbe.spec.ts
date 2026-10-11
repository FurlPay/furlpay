import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * The 2026-10 outage: Upstash refused every command with a plan-limit error
 * for weeks, and the scheduled health job said nothing. It could not — runJob
 * takes its lock in KV first and returned "job not run" before a single check
 * executed, and the only KV check inside it asked whether credentials were
 * present, not whether a command works. These tests pin the probe that now
 * runs outside runJob.
 */

const state = { kvGet: async (_key: string): Promise<unknown> => null };
const raised: { kind: string; severity: string; dimensions?: Record<string, string | number> }[] = [];

vi.mock("@/lib/kv", async (orig) => {
  const real = await orig<typeof import("@/lib/kv")>();
  return { ...real, kvBackend: "redis", kvGet: (key: string) => state.kvGet(key) };
});
vi.mock("@/lib/alerts", () => ({
  raiseAlert: async (input: { kind: string; severity: string; dimensions?: Record<string, string | number> }) => {
    raised.push(input);
    return { notified: true, suppressedBy: null };
  },
}));
// The job body is not under test, and with KV down runJob refuses anyway.
vi.mock("@/lib/cron/runner", () => ({
  runJob: async () => ({ status: "skipped", detail: "Lock store unavailable; job not run." }),
  isJobHealthy: async () => ({ healthy: true, detail: "" }),
  cronHttpStatus: () => 200,
}));

const { KvError } = await import("@/lib/kv");
const { GET } = await import("@/app/api/cron/health/route");

const call = () =>
  GET(new NextRequest("https://furlpay.test/api/cron/health", { headers: { "x-furlpay-cron-key": "test-cron-secret-0123456789" } }));

beforeEach(() => {
  raised.length = 0;
  process.env.FURLPAY_CRON_SECRET = "test-cron-secret-0123456789";
  state.kvGet = async () => null;
});

describe("scheduled health: live KV probe", () => {
  it("raises a critical alert, with the provider's failure category, when KV refuses a read", async () => {
    state.kvGet = async () => {
      throw new KvError("ERR max requests limit exceeded: plan limit", "plan_limit", 400);
    };
    const res = await call();
    const body = await res.json();

    const check = body.checks.find((c: { id: string }) => c.id === "kv:live");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("plan_limit");

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ kind: "infra.kv_unavailable", severity: "critical", dimensions: { category: "plan_limit" } });
  });

  it("alerts even though runJob refused to run the job", async () => {
    state.kvGet = async () => {
      throw new KvError("fetch failed", "network", null);
    };
    const body = await (await call()).json();
    // The job did not run — and the outage is reported anyway. That is the fix.
    expect(body.status).toBe("skipped");
    expect(raised.map((a) => a.kind)).toEqual(["infra.kv_unavailable"]);
  });

  it("stays silent when the read succeeds", async () => {
    const body = await (await call()).json();
    expect(body.checks.find((c: { id: string }) => c.id === "kv:live").ok).toBe(true);
    expect(raised).toEqual([]);
  });

  it("only reads: the probe never writes to the store it is checking", async () => {
    const keys: string[] = [];
    state.kvGet = async (key) => {
      keys.push(key);
      return null;
    };
    await call();
    expect(keys).toEqual(["health:kv-probe"]);
  });

  it("still requires the cron credential", async () => {
    const res = await GET(new NextRequest("https://furlpay.test/api/cron/health"));
    expect(res.status).toBe(401);
    expect(raised).toEqual([]);
  });
});
