import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// kvIncr / kvIncrBy send INCRBY + its window TTL as ONE atomic EVAL (audit
// 7 Oct 2026, P0-1 hygiene). The old INCR-then-EXPIRE pair leaked a counter
// without a TTL whenever the second request failed. This drives the real kv
// module against a fake Upstash REST endpoint that executes the script's
// semantics, including a key that was leaked without a TTL.

const store = new Map<string, { v: number; ttl: number }>();
const bodies: unknown[][] = [];

function fakeEval(cmd: unknown[]) {
  const [op, script, nkeys, key, by, ttl] = cmd as [string, string, number, string, number, number];
  expect(op).toBe("EVAL");
  expect(nkeys).toBe(1);
  expect(script).toContain("INCRBY");
  expect(script).toContain("EXPIRE");
  const cur = store.get(key) ?? { v: 0, ttl: -1 };
  cur.v += Number(by);
  if (cur.ttl < 0) cur.ttl = Number(ttl);
  store.set(key, cur);
  return cur.v;
}

beforeAll(() => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://kv.example.test");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const cmd = JSON.parse(init.body) as unknown[];
    bodies.push(cmd);
    return new Response(JSON.stringify({ result: fakeEval(cmd) }), { status: 200 });
  });
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("kvIncr / kvIncrBy over Redis", () => {
  it("is one request per call and arms the window TTL", async () => {
    vi.resetModules();
    const kv = await import("@/lib/kv");
    expect(kv.kvBackend).toBe("redis");
    expect(await kv.kvIncr("rl:a:1", 60)).toBe(1);
    expect(await kv.kvIncr("rl:a:1", 60)).toBe(2);
    expect(bodies.length).toBe(2);
    expect(store.get("rl:a:1")).toEqual({ v: 2, ttl: 60 });
  });

  it("re-arms a TTL on a counter that was leaked without one", async () => {
    vi.resetModules();
    const kv = await import("@/lib/kv");
    store.set("rl:leaked", { v: 41, ttl: -1 });
    expect(await kv.kvIncr("rl:leaked", 30)).toBe(42);
    expect(store.get("rl:leaked")?.ttl).toBe(30);
  });

  it("kvIncrBy adds integer amounts in the same atomic step", async () => {
    vi.resetModules();
    const kv = await import("@/lib/kv");
    expect(await kv.kvIncrBy("spend:u1", 1250.4, 86_400)).toBe(1250);
    expect(await kv.kvIncrBy("spend:u1", 750, 86_400)).toBe(2000);
    expect(store.get("spend:u1")).toEqual({ v: 2000, ttl: 86_400 });
  });
});
