import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpointsFor, rpc, rpcHealth } from "../rpc";
import { suiEndpoints, suiGraphql, SUI_MAINNET_CHAIN_IDENTIFIER } from "../sui";
import { z } from "zod";

// Endpoint behaviours keyed by URL: what eth_chainId returns and whether calls fail.
type Behaviour = { chainId?: string; status?: number; rpcError?: boolean; sui?: string };
let world: Record<string, Behaviour> = {};
const calls: string[] = [];
const g = globalThis as unknown as { __furlpayRpcHealth?: Map<string, unknown>; __furlpayRpcVerified?: Set<string>; __furlpaySuiDown?: Map<string, unknown>; __furlpaySuiProven?: Set<string> };

beforeEach(() => {
  world = {}; calls.length = 0;
  g.__furlpayRpcHealth?.clear(); g.__furlpayRpcVerified?.clear(); g.__furlpaySuiDown?.clear(); g.__furlpaySuiProven?.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    const b = world[url] ?? { status: 503 };
    const req = JSON.parse(init.body);
    calls.push(`${url} ${req.method ?? (req.query.includes("chainIdentifier") ? "chainIdentifier" : "query")}`);
    if (b.status && b.status !== 200) return new Response("down", { status: b.status });
    if (b.sui !== undefined) return Response.json(req.query.includes("chainIdentifier") && !req.query.includes("checkpoint") ? { data: { chainIdentifier: b.sui } } : { data: { checkpoint: { sequenceNumber: 7 } } });
    if (b.rpcError) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "rate limited" } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: req.method === "eth_chainId" ? b.chainId : "0x10" });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const A = "https://a.example/rpc", B = "https://b.example/rpc";
const PUBLIC_BASE = "https://base-rpc.publicnode.com";

describe("endpoint list", () => {
  it("uses configured endpoints in order, then the public one, https only, de-duplicated", () => {
    expect(endpointsFor("base", { BASE_RPC_URL: ` ${A}, http://evil.example, ${B},${A}` })).toEqual([A, B, PUBLIC_BASE]);
    expect(endpointsFor("base", {})).toEqual([PUBLIC_BASE]);
    expect(endpointsFor("base", { BASE_RPC_URL: "http://127.0.0.1:8545" })).toEqual(["http://127.0.0.1:8545", PUBLIC_BASE]);
    expect(suiEndpoints({ SUI_GRAPHQL_URL: `${A},http://x` })).toEqual([A, "https://graphql.mainnet.sui.io/graphql"]);
  });
});

describe("EVM failover", () => {
  it("fails over from a down endpoint and proves the next one's chain before using it", async () => {
    vi.stubEnv("BASE_RPC_URL", `${A},${B}`);
    world[A] = { status: 503 }; world[B] = { chainId: "0x2105" }; // 8453
    expect(await rpc("base", "eth_blockNumber", [])).toBe("0x10");
    expect(calls).toEqual([`${A} eth_chainId`, `${B} eth_chainId`, `${B} eth_blockNumber`]);
  });
  it("fails over on a JSON-RPC error (rate limit)", async () => {
    vi.stubEnv("BASE_RPC_URL", `${A},${B}`);
    world[A] = { chainId: "0x2105", rpcError: true }; world[B] = { chainId: "0x2105" };
    expect(await rpc("base", "eth_blockNumber", [])).toBe("0x10");
  });
  it("never reads from an endpoint on another chain, even when it is the only one up", async () => {
    vi.stubEnv("BASE_RPC_URL", A);
    world[A] = { chainId: "0x1" }; // Ethereum, misconfigured as Base
    await expect(rpc("base", "eth_blockNumber", [])).rejects.toThrow("Wrong network");
    expect(calls.some(c => c.endsWith("eth_blockNumber"))).toBe(false);
    world[A] = { chainId: "0x2105" }; world[PUBLIC_BASE] = { chainId: "0x2105" };
    await rpc("base", "eth_blockNumber", []);
    expect(calls.filter(c => c.startsWith(A)).length).toBe(1); // A is excluded for good
  });
  it("tries a cooling-down endpoint last and reports health without query strings", async () => {
    vi.stubEnv("BASE_RPC_URL", `${A}?key=SECRET,${B}`);
    world[`${A}?key=SECRET`] = { status: 500 }; world[B] = { chainId: "0x2105" };
    await rpc("base", "eth_blockNumber", []);
    calls.length = 0;
    await rpc("base", "eth_blockNumber", []);
    expect(calls[0].startsWith(B)).toBe(true);
    expect(JSON.stringify(rpcHealth("base"))).not.toContain("SECRET");
    expect(rpcHealth("base")[0]).toMatchObject({ failures: 1, coolingDown: true });
  });
});

describe("Sui failover", () => {
  const q = z.object({ checkpoint: z.object({ sequenceNumber: z.number() }) });
  it("skips an endpoint that is not Sui mainnet and uses the next", async () => {
    vi.stubEnv("SUI_GRAPHQL_URL", `${A},${B}`);
    world[A] = { sui: "testnet-id" }; world[B] = { sui: SUI_MAINNET_CHAIN_IDENTIFIER };
    expect(await suiGraphql("{ checkpoint { sequenceNumber } }", {}, q)).toEqual({ checkpoint: { sequenceNumber: 7 } });
  });
  it("refuses when no endpoint is mainnet", async () => {
    vi.stubEnv("SUI_GRAPHQL_URL", A);
    world[A] = { sui: "testnet-id" }; world["https://graphql.mainnet.sui.io/graphql"] = { sui: "devnet-id" };
    await expect(suiGraphql("{ checkpoint { sequenceNumber } }", {}, q)).rejects.toThrow("Wrong Sui network");
  });
});
