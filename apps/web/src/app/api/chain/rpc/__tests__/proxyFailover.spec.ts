import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ARC-P3-002 / ARC-P5-001: the wallet RPC proxy reads mainnet payment chains (Arc included)
// through endpoints that PROVED their chain id, with failover; node rejections pass through.
vi.mock("@/lib/authz", () => ({ requireUser: vi.fn(async () => ({ ok: true, account: { user: { id: "u1" } } })) }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: vi.fn(async () => null) }));

import { POST } from "../route";

type B = { chainId?: string; status?: number; reject?: string };
let world: Record<string, B> = {};
const calls: string[] = [];
const g = globalThis as unknown as { __furlpayRpcHealth?: Map<string, unknown>; __furlpayRpcVerified?: Set<string> };
const PRIMARY = "https://arc-primary.example/rpc", BACKUP = "https://arc-backup.example/rpc";
const req = (chain: string, method: string, params: unknown[] = []) => new NextRequest("http://localhost/api/chain/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, method, params }) });

beforeEach(() => {
  world = {}; calls.length = 0; g.__furlpayRpcHealth?.clear(); g.__furlpayRpcVerified?.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    const b = world[url] ?? { status: 503 }; const r = JSON.parse(init.body);
    calls.push(`${url} ${r.method}`);
    if (b.status && b.status !== 200) return new Response("down", { status: b.status });
    if (r.method === "eth_chainId") return Response.json({ jsonrpc: "2.0", id: 1, result: b.chainId });
    if (b.reject) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: b.reject } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x10" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("/api/chain/rpc on Arc", () => {
  it("fails over to a backup endpoint that proves it is Arc (5042)", async () => {
    vi.stubEnv("ARC_RPC_URL", `${PRIMARY},${BACKUP}`);
    world[PRIMARY] = { status: 502 }; world[BACKUP] = { chainId: "0x13b2" };
    const res = await POST(req("arc", "eth_blockNumber"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "0x10" });
    expect(calls).toContain(`${BACKUP} eth_chainId`);
  });
  it("refuses to proxy through an endpoint serving another chain", async () => {
    vi.stubEnv("ARC_RPC_URL", PRIMARY);
    world[PRIMARY] = { chainId: "0x4cef52" }; // Arc TESTNET configured as mainnet
    const res = await POST(req("arc", "eth_sendRawTransaction", ["0xdead"]));
    expect(res.status).toBe(503);
    expect(calls.some(c => c.endsWith("eth_sendRawTransaction"))).toBe(false);
  });
  it("passes a node's rejection through instead of retrying it elsewhere", async () => {
    vi.stubEnv("ARC_RPC_URL", `${PRIMARY},${BACKUP}`);
    world[PRIMARY] = { chainId: "0x13b2", reject: "nonce too low" }; world[BACKUP] = { chainId: "0x13b2" };
    const res = await POST(req("arc", "eth_sendRawTransaction", ["0xdead"]));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "rpc_error", detail: "nonce too low" });
    expect(calls.some(c => c.startsWith(BACKUP))).toBe(false);
  });
  it("answers 504 when no endpoint is reachable", async () => {
    vi.stubEnv("ARC_RPC_URL", PRIMARY);
    expect((await POST(req("arc", "eth_blockNumber"))).status).toBe(504);
  });
});
