import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ sbSelect: vi.fn(), sbInsert: vi.fn(), sbUpdate: vi.fn(), sbUpsert: vi.fn(), sbRpc: vi.fn(), supabaseBackend: "supabase" }));

import { chainHealth } from "../operations";

// ARC-P5-002: operators see Arc head freshness and endpoint failover state, from the node itself.
const g = globalThis as unknown as { __furlpayRpcHealth?: Map<string, unknown>; __furlpayRpcVerified?: Set<string> };
const ARC = "https://arc-ops.example/rpc";
let headAge = 3, arcDown = false;
beforeEach(() => {
  g.__furlpayRpcHealth?.clear(); g.__furlpayRpcVerified?.clear(); headAge = 3; arcDown = false;
  vi.stubEnv("ARC_RPC_URL", ARC);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    const r = JSON.parse(init.body);
    if (!url.startsWith(ARC) || arcDown) return new Response("down", { status: 503 });
    if (r.method === "eth_chainId") return Response.json({ jsonrpc: "2.0", id: 1, result: "0x13b2" });
    const ts = Math.floor(Date.now() / 1000) - headAge;
    return Response.json({ jsonrpc: "2.0", id: 1, result: { number: "0x64", hash: "0x" + "a".repeat(64), timestamp: "0x" + ts.toString(16) } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("chain health (operations console)", () => {
  it("reports Arc's live height and head age with its verified endpoint", async () => {
    const arc = (await chainHealth()).find(c => c.chain === "arc")!;
    expect(arc).toMatchObject({ ok: true, height: "100" });
    expect(arc.headAgeSeconds).toBeLessThanOrEqual(5);
    expect(arc.endpoints.find(e => e.endpoint.includes("arc-ops.example"))?.verified).toBe(true);
  });
  it("shows a stale head as a number, not as healthy", async () => {
    headAge = 600;
    expect((await chainHealth()).find(c => c.chain === "arc")!.headAgeSeconds).toBeGreaterThanOrEqual(600);
  });
  it("reports an unreachable chain explicitly instead of omitting it", async () => {
    arcDown = true;
    const arc = (await chainHealth()).find(c => c.chain === "arc")!;
    expect(arc).toMatchObject({ ok: false, height: null, headAgeSeconds: null });
    expect(arc.error).toBeTruthy();
  });
  it("leaves testnets out unless testnet collection is enabled", async () => {
    expect((await chainHealth()).some(c => c.chain === "arc-testnet")).toBe(false);
  });
});
