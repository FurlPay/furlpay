import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogsAdaptive, learnedSpan, resetLearnedSpans } from "../nodeIndexer";
import { resolveBuckets } from "../assetIndexer";
import { TRANSFER_TOPIC, type RpcLog } from "../normalize";

// RPC-budget mechanisms, against a scripted node that answers like Alchemy's
// Free plan (message verified 2026-10-07): exact block coverage, fewer calls.

const ALCHEMY_REFUSAL = "Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. Based on your parameters, this block range should work: [0x1, 0xa]. Upgrade to PAYG for expanded block range.";

beforeEach(() => resetLearnedSpans());
afterEach(() => vi.unstubAllGlobals());

describe("getLogsAdaptive learns the stated span", () => {
  it("one refusal, then exact 10-block chunks in batches; every block covered once; later ranges never refused", async () => {
    const calls: { from: number; to: number; ok: boolean }[] = [];
    let requests = 0;
    const answer = (p: { fromBlock: string; toBlock: string }) => {
      const a = Number(BigInt(p.fromBlock));
      const b = Number(BigInt(p.toBlock));
      const ok = b - a + 1 <= 10;
      calls.push({ from: a, to: b, ok });
      return ok ? { result: Array.from({ length: b - a + 1 }, (_, i) => ({ blockNumber: "0x" + (a + i).toString(16) })) } : { error: { code: -32600, message: ALCHEMY_REFUSAL } };
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        requests++;
        const body = JSON.parse(String(init.body));
        if (Array.isArray(body)) return new Response(JSON.stringify(body.map((c: { id: number; params: [{ fromBlock: string; toBlock: string }] }) => ({ jsonrpc: "2.0", id: c.id, ...answer(c.params[0]) }))), { status: 200 });
        const r = answer(body.params[0]);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...r }), { status: r.error ? 400 : 200 });
      })
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    const logs = await getLogsAdaptive("http://alchemy", { topics: [TRANSFER_TOPIC] }, 1000n, 1499n);
    expect(learnedSpan("http://alchemy")).toBe(10n);
    expect(logs.map((l) => Number(BigInt(l.blockNumber!)))).toEqual(Array.from({ length: 500 }, (_, i) => 1000 + i));
    expect(calls.filter((c) => !c.ok)).toHaveLength(1); // halving would have refused 63 times
    expect(calls.filter((c) => c.ok)).toHaveLength(50);
    expect(requests).toBe(1 + 3); // the refusal + 3 batches of ≤20 chunks
    calls.length = 0;
    await getLogsAdaptive("http://alchemy", { topics: [TRANSFER_TOPIC] }, 2000n, 2099n);
    expect(calls.every((c) => c.ok)).toBe(true);
  });
});

describe("resolveBuckets", () => {
  // A chain with irregular block times (missed slots, variable intervals).
  const N = 600;
  const ts: number[] = [];
  let t = 1_790_000_007;
  for (let i = 0; i <= N; i++) {
    ts.push(t);
    t += [2, 2, 12, 2, 24, 1, 2, 36][i % 8];
  }
  const hash = (n: number) => "0x" + n.toString(16).padStart(64, "c");
  const logsAt = (blocks: number[]): RpcLog[] => blocks.map((n) => ({ address: "0xa", topics: [], data: "0x", blockNumber: "0x" + n.toString(16), blockHash: hash(n), transactionHash: "0x1", logIndex: "0x0" }));

  function node() {
    let headers = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const one = (c: { id: number; params: [string] }) => {
          headers++;
          const n = Number(BigInt(c.params[0]));
          return { jsonrpc: "2.0", id: c.id, result: { number: c.params[0], hash: hash(n), timestamp: "0x" + ts[n].toString(16) } };
        };
        return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)), { status: 200 });
      })
    );
    return () => headers;
  }

  for (const width of [60, 300, 3600]) {
    it(`width ${width}s: identical to reading every block's header, with far fewer reads`, async () => {
      const count = node();
      const active = Array.from({ length: N }, (_, i) => i + 1).filter((n) => n % 3 !== 0); // 2/3 of blocks have logs
      const r = await resolveBuckets("http://n", { n: 0n, ts: ts[0], hash: hash(0) }, { n: BigInt(N), ts: ts[N], hash: hash(N) }, logsAt(active), width);
      expect(r.mismatch).toBeNull();
      for (const n of active) expect(r.bucket.get(BigInt(n))).toBe(Math.floor(ts[n] / width) * width);
      // Provable bound: each crossed bucket boundary costs at most ceil(log2(N)) header reads.
      const boundaries = new Set(Array.from({ length: N + 1 }, (_, i) => Math.floor(ts[i] / width))).size - 1;
      expect(count()).toBeLessThanOrEqual(boundaries * Math.ceil(Math.log2(N)));
      if (width === 3600) expect(count()).toBeLessThan(active.length / 10);
    });
  }
  it("a header whose hash differs from the logs' block hash is reported, not silently used", async () => {
    node();
    const logs = logsAt([300, 301]);
    logs[0].blockHash = "0x" + "e".repeat(64);
    const r = await resolveBuckets("http://n", { n: 0n, ts: ts[0], hash: hash(0) }, { n: BigInt(N), ts: ts[N], hash: hash(N) }, logs, 60);
    expect(r.mismatch?.block).toBe(300n);
  });
});
