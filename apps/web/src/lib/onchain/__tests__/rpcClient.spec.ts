import { afterEach, describe, expect, it, vi } from "vitest";
import { getLogsAdaptive, JsonRpcError, nodeRpc, nodeRpcBatch } from "../nodeIndexer";
import { indexerEvent, scrub } from "../indexerLog";
import { TRANSFER_TOPIC } from "../normalize";

// The shared JSON-RPC client every indexer uses, against scripted responses
// that reproduce what real providers sent on 2026-10-07.

type R = { status: number; body: unknown; headers?: Record<string, string> };
function script(responses: R[]) {
  const seen: { url: string; body: unknown }[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      const r = responses[Math.min(i++, responses.length - 1)];
      return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: r.headers });
    })
  );
  return seen;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("nodeRpc", () => {
  it("rate limited: honours Retry-After, then succeeds (Solana public RPC sends retry-after: 10)", async () => {
    const seen = script([
      { status: 429, body: "Too Many Requests", headers: { "retry-after": "0" } },
      { status: 200, body: { jsonrpc: "2.0", id: 1, result: "0x10" } },
    ]);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await nodeRpc<string>("http://n/?apikey=SECRET", "eth_blockNumber", [])).toBe("0x10");
    expect(seen).toHaveLength(2);
    expect(log.mock.calls.flat().join(" ")).toMatch(/rpc_rate_limited/);
  });
  it("a Retry-After beyond 15 s fails the call fast and visibly instead of stalling the pass", async () => {
    script([{ status: 429, body: "", headers: { "retry-after": "60" } }]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(nodeRpc("http://n", "eth_blockNumber", [])).rejects.toThrow(/retry after 60s/);
  });
  it("node failure (5xx) retries with backoff and then reports rpc_unavailable without the URL", async () => {
    script([{ status: 503, body: "down" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(nodeRpc("http://node.example/?apikey=SECRET123", "eth_call", [], 2)).rejects.toThrow(/503/);
    const text = warn.mock.calls.flat().join(" ");
    expect(text).toMatch(/rpc_unavailable/);
    expect(text).not.toContain("SECRET123");
  });
  it("HTTP 400 with a JSON-RPC body keeps the provider's message (dRPC: 'ranges over 10000 blocks…')", async () => {
    script([{ status: 400, body: { jsonrpc: "2.0", id: 1, error: { code: 27, message: "ranges over 10000 blocks are not supported" } } }]);
    const e = await nodeRpc("http://n", "eth_getLogs", [{}]).catch((x) => x);
    expect(e).toBeInstanceOf(JsonRpcError);
    expect(e.message).toMatch(/ranges over 10000 blocks/);
  });
});

describe("getLogsAdaptive", () => {
  it("splits on an HTTP 400 range refusal and covers the range exactly once", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        calls++;
        const f = JSON.parse(String(init.body)).params[0];
        const span = Number(BigInt(f.toBlock) - BigInt(f.fromBlock)) + 1;
        if (span > 25) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 27, message: "ranges over 25 blocks are not supported" } }), { status: 400 });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [{ blockNumber: f.fromBlock, span }] }), { status: 200 });
      })
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const logs = (await getLogsAdaptive("http://n", { topics: [TRANSFER_TOPIC] }, 0n, 99n)) as unknown as { span: number }[];
    expect(logs.reduce((a, l) => a + l.span, 0)).toBe(100);
    expect(calls).toBeGreaterThan(4);
  });
});

describe("nodeRpcBatch", () => {
  it("returns results in request order even when the node answers out of order", async () => {
    script([{ status: 200, body: [{ jsonrpc: "2.0", id: 1, result: "b" }, { jsonrpc: "2.0", id: 0, result: "a" }] }]);
    expect(await nodeRpcBatch<string>("http://n", [{ method: "x", params: [] }, { method: "y", params: [] }])).toEqual(["a", "b"]);
  });
  it("one error in a batch fails the whole call — a partial answer is never used", async () => {
    script([{ status: 200, body: [{ jsonrpc: "2.0", id: 0, result: "a" }, { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "header not found" } }] }]);
    await expect(nodeRpcBatch("http://n", [{ method: "x", params: [] }, { method: "y", params: [] }])).rejects.toThrow(/header not found/);
  });
  it("a node without batch support is reported, not silently degraded", async () => {
    script([{ status: 200, body: { jsonrpc: "2.0", id: null, error: { message: "batch requests are not supported" } } }]);
    await expect(nodeRpcBatch("http://n", [{ method: "x", params: [] }])).rejects.toThrow(/batch/);
  });
});

describe("structured indexer logs", () => {
  it("scrub removes URLs and key=value secrets", () => {
    expect(scrub("failed https://eth.example.com/v2/abcdef?apikey=XYZ and token=abc")).toBe("failed [url] and token=[redacted]");
  });
  it("indexerEvent drops url/key/secret fields entirely and keeps a stable event name", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    indexerEvent("block_indexed", { chain: "base", rpcUrl: "https://x/?key=1", apiKey: "k", note: "via https://x.y/z" });
    const line = out.mock.calls.flat().join(" ");
    expect(line).toContain("block_indexed");
    expect(line).not.toContain("https://");
    expect(line).not.toContain("apiKey");
  });
});
