import { describe, expect, it } from "vitest";
import { configFromEnv, createTail, validate } from "../../../../../../scripts/onchain/node-tail.mjs";

// The standalone real-time worker (scripts/onchain/node-tail.mjs) driven by a
// fake clock and a fake network: head polling, coalescing, backoff, recovery,
// structured events, and that no secret or RPC URL reaches the logs.

type Rec = Record<string, unknown>;
const OK = (chain: string, extra: Rec = {}) => ({
  ok: true,
  reports: [{ chain, status: "ok", from: 1, scannedThrough: 2, finalized: 2, logs: 0, counts: { inserted: 0 }, cursorAdvanced: true, markedReorged: 0, errors: [] }],
  assets: [{ chain, asset: "usdc", status: "ok", cursorBefore: 1, cursorAfter: 2, finalized: 2, commits: 1, reconciled: true, errors: [] }],
  ...extra,
});

function harness(opts: { heads: (number | Error)[]; scans: (Rec | number)[]; chains?: string[] }) {
  let t = 0;
  let h = 0;
  let s = 0;
  const logs: Rec[] = [];
  const scanCalls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.startsWith("http://node.")) {
      const v = opts.heads[Math.min(h++, opts.heads.length - 1)];
      if (v instanceof Error) throw v;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" + v.toString(16) }), { status: 200 });
    }
    scanCalls.push(url);
    expect((init?.headers as Record<string, string>)["x-furlpay-cron-key"]).toBe("s".repeat(20));
    const r = opts.scans[Math.min(s++, opts.scans.length - 1)];
    t += 300; // a scan takes time
    return typeof r === "number" ? new Response(JSON.stringify({ ok: false }), { status: r }) : new Response(JSON.stringify(r), { status: 200 });
  }) as typeof fetch;
  const cfg = {
    ...configFromEnv({ FURLPAY_BASE_URL: "https://app.example", FURLPAY_CRON_SECRET: "s".repeat(20), ONCHAIN_TAIL_CHAINS: (opts.chains ?? ["base"]).join(","), BASE_RPC_URL: "http://node.base/?apikey=SECRET123" }),
  };
  const tail = createTail(cfg, { fetch: fetchImpl, now: () => t, sleep: async (ms) => void (t += ms), log: (r) => logs.push(r) });
  return { tail, logs, scanCalls, events: () => logs.map((l) => l.event) };
}

describe("node-tail worker", () => {
  it("validates its configuration", () => {
    expect(validate(configFromEnv({}))).toMatch(/FURLPAY_BASE_URL/);
    expect(validate(configFromEnv({ FURLPAY_BASE_URL: "https://x", FURLPAY_CRON_SECRET: "short" }))).toMatch(/SECRET/);
    expect(validate(configFromEnv({ FURLPAY_BASE_URL: "https://x", FURLPAY_CRON_SECRET: "s".repeat(20), ONCHAIN_NODE_CHAINS: "base, solana ,base" }))).toBeNull();
    expect(configFromEnv({ ONCHAIN_NODE_CHAINS: "base, solana ,base" }).chains).toEqual(["base", "solana"]);
  });

  it("scans once per new head, never the same head twice", async () => {
    const { tail, scanCalls, events } = harness({ heads: [10, 10, 10, 11, 11, 12], scans: [OK("base")] });
    await tail.run(6);
    expect(scanCalls).toHaveLength(3); // heads 10, 11, 12
    expect(scanCalls[0]).toBe("https://app.example/api/cron/onchain-node?chain=base");
    expect(events().filter((e) => e === "block_detected")).toHaveLength(3);
    expect(events()).toContain("indexer_started");
    expect(events()).toContain("block_indexed");
    expect(events()).toContain("indexer_checkpoint_saved");
  });

  it("backs off exponentially on failure, then logs indexer_recovered with the downtime", async () => {
    const { tail, logs, events } = harness({ heads: Array.from({ length: 40 }, (_, i) => 100 + i), scans: [502, 502, 502, OK("base")] });
    await tail.run(40);
    const errs = logs.filter((l) => l.event === "indexer_error");
    expect(errs.map((e) => e.retryInMs)).toEqual([2000, 4000, 8000]);
    const rec = logs.find((l) => l.event === "indexer_recovered")!;
    expect(rec.downMs as number).toBeGreaterThanOrEqual(14_000);
    expect(events().indexOf("indexer_recovered")).toBeGreaterThan(events().lastIndexOf("indexer_error"));
  });

  it("an unreachable head RPC is logged rpc_unavailable and falls back to the interval schedule", async () => {
    const { tail, scanCalls, events } = harness({ heads: [new Error("connect ECONNREFUSED http://node.base/?apikey=SECRET123")], scans: [OK("base")] });
    await tail.run(12);
    expect(events()).toContain("rpc_unavailable");
    expect(scanCalls.length).toBeGreaterThanOrEqual(2); // every intervalMs (5 s) of fake time
  });

  it("surfaces supply mismatches and asset reorg refusals as integrity events", async () => {
    const bad = OK("base", { assets: [{ chain: "base", asset: "usdc", status: "failed", cursorBefore: 5, cursorAfter: 5, commits: 0, reconciled: false, errors: ["commit refused: parent_hash_mismatch"] }] });
    const { tail, events } = harness({ heads: [1], scans: [bad] });
    await tail.run(1);
    expect(events()).toContain("integrity_issue");
    expect(events()).toContain("indexer_reorg_detected");
  });

  it("never logs the cron secret or an RPC URL (which carries an API key)", async () => {
    const { tail, logs } = harness({ heads: [new Error("fetch failed for http://node.base/?apikey=SECRET123"), 7], scans: [{ ok: false, reason: "upstream https://rpc.example/?key=SECRET123 down", reports: [] }, OK("base")] });
    await tail.run(6);
    const text = JSON.stringify(logs);
    expect(text).not.toContain("SECRET123");
    expect(text).not.toContain("s".repeat(20));
    expect(text).not.toMatch(/https?:\/\/(node|rpc)\./);
  });
});
