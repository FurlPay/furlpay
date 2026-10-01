import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// T-A3 (audit P1-3): every EventBridge Scheduler target answers the method the
// scheduler actually sends. scheduler.tf POSTs; the cron routes were GET-only,
// so every scheduled job — reconciliation included — got a 405 on AWS.
// ---------------------------------------------------------------------------

const TF = readFileSync(join(__dirname, "../../../../../../infra/aws/modules/env/scheduler.tf"), "utf8");
const method = /http_method\s*=\s*"([A-Z]+)"/.exec(TF)?.[1];
const paths = [...TF.matchAll(/path\s*=\s*"(\/api\/cron\/[a-z-]+)"/g)].map((m) => m[1]);

const H = vi.hoisted(() => ({ kv: new Set<string>() }));
vi.mock("@/lib/kv", async (orig) => ({
  ...(await orig<typeof import("@/lib/kv")>()),
  kvSetNx: vi.fn(async (k: string) => {
    if (H.kv.has(k)) return false;
    H.kv.add(k);
    return true;
  }),
  kvDel: vi.fn(async (k: string) => void H.kv.delete(k)),
}));

describe("EventBridge ↔ cron route contract", () => {
  it("scheduler.tf declares a method and at least the reconcile job", () => {
    expect(method).toBe("POST");
    expect(paths).toContain("/api/cron/reconcile");
  });

  it.each(paths.map((p) => [p]))("%s exports the scheduler's method and authenticates it (401, never 405)", async (p) => {
    const mod = (await import(`../../../app${p}/route`)) as Record<string, unknown>;
    expect(typeof mod[method!], `${p} has no ${method} handler`).toBe("function");
    process.env.FURLPAY_CRON_SECRET = "c".repeat(40);
    const res = await (mod[method!] as (r: Request) => Promise<Response>)(
      new Request(`http://localhost${p}`, { method: method!, headers: { "x-furlpay-cron-key": "wrong" } }) as never
    );
    expect(res.status).toBe(401);
  });
});

describe("runOncePerDay", () => {
  beforeEach(() => H.kv.clear());

  it("runs once per UTC day; a retry answers already_ran without re-running", async () => {
    const { runOncePerDay } = await import("../runOnce");
    const work = vi.fn(async () => new Response("ok", { status: 200 }));
    await runOncePerDay("market-brief", work);
    const second = await runOncePerDay("market-brief", work);
    expect(work).toHaveBeenCalledTimes(1);
    expect(await second.json()).toMatchObject({ skipped: "already_ran_today" });
  });

  it("a failed run releases the claim so the retry does the work", async () => {
    const { runOncePerDay } = await import("../runOnce");
    await expect(runOncePerDay("price-cards", async () => { throw new Error("discord 502"); })).rejects.toThrow();
    const work = vi.fn(async () => new Response("ok"));
    await runOncePerDay("price-cards", work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("a non-2xx result also releases the claim", async () => {
    const { runOncePerDay } = await import("../runOnce");
    await runOncePerDay("discord-welcome", async () => new Response("no", { status: 503 }));
    const work = vi.fn(async () => new Response("ok"));
    await runOncePerDay("discord-welcome", work);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
