import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Network-wide asset indexer against a scripted JSON-RPC node (single and
// batch requests) and a recorded store. The real-node / real-Postgres proof is
// assetIndexer.live.spec.ts; the database invariants are proven by
// scripts/db/verify-onchain-asset-index.mjs.

const calls: { fn: string; args: Record<string, unknown> }[] = [];
const store = {
  cursor: null as null | { last_block: number; last_block_hash: string },
  commit: (_args: Record<string, unknown>): { ok: boolean; reason?: string; reconciled?: boolean | null } | Error => ({ ok: true, reconciled: true }),
};

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "onchain_asset_anchor") return true;
    if (fn === "onchain_asset_commit") {
      const r = store.commit(args);
      if (r instanceof Error) throw r;
      if (r.ok) store.cursor = { last_block: Number(args.p_to), last_block_hash: String(args.p_to_hash) };
      return r;
    }
    return null;
  }),
  sbSelect: vi.fn(async (table: string) => (table === "onchain_asset_cursors" && store.cursor ? [store.cursor] : [])),
  sbInsertIgnoreDuplicates: vi.fn(async () => undefined),
}));

import { bucketize, scanAsset, scanAssets } from "../assetIndexer";
import { assetRegistry, classifyContract, indexedAssetsOn } from "../assets";
import { TRANSFER_TOPIC, type RpcLog } from "../normalize";

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ZW = "0x" + "0".repeat(64);
const W = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const hash = (n: number) => "0x" + n.toString(16).padStart(64, "a");
const T0 = 1_790_000_000;

interface Chain {
  head: number;
  finalized: number;
  chainId: number;
  logs: Record<number, RpcLog[]>;
  supply: (block: number) => bigint;
  decimals: number;
  maxRange?: number; // HTTP 400 above this many blocks, like dRPC
  fail?: boolean; // HTTP 500 on everything
  forkHashAt?: number;
  tsZero?: boolean; // logs carry blockTimestamp 0x0 (Arbitrum's node)
}
let chain: Chain;
let seen: { method: string; params: unknown[] }[];

function answer(method: string, params: unknown[]): unknown {
  if (method === "eth_chainId") return "0x" + chain.chainId.toString(16);
  if (method === "eth_getBlockByNumber") {
    const tag = params[0] as string;
    const n = tag === "latest" ? chain.head : tag === "finalized" ? chain.finalized : Number(BigInt(tag));
    return { number: "0x" + n.toString(16), hash: chain.forkHashAt === n ? "0x" + "f".repeat(64) : hash(n), timestamp: "0x" + (T0 + n * 2).toString(16) };
  }
  if (method === "eth_call") {
    const data = (params[0] as { data: string }).data;
    if (data === "0x313ce567") return "0x" + chain.decimals.toString(16).padStart(64, "0");
    const n = params[1] === "latest" ? chain.head : Number(BigInt(params[1] as string));
    return "0x" + chain.supply(n).toString(16).padStart(64, "0");
  }
  if (method === "eth_getLogs") {
    const f = params[0] as { fromBlock: string; toBlock: string };
    const a = Number(BigInt(f.fromBlock));
    const b = Number(BigInt(f.toBlock));
    if (chain.maxRange && b - a + 1 > chain.maxRange) throw Object.assign(new Error(`ranges over ${chain.maxRange} blocks are not supported`), { http400: true });
    const out: RpcLog[] = [];
    for (let n = a; n <= b; n++) out.push(...(chain.logs[n] ?? []).map((l) => ({ ...l, blockTimestamp: chain.tsZero ? "0x0" : undefined })));
    return out;
  }
  throw new Error(`unexpected ${method}`);
}

function installNode(url = "http://base.node") {
  seen = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init: RequestInit) => {
      if (chain.fail) return new Response("down", { status: 500 });
      const body = JSON.parse(String(init.body));
      const one = (c: { id: number; method: string; params: unknown[] }) => {
        seen.push({ method: c.method, params: c.params });
        try {
          return { jsonrpc: "2.0", id: c.id, result: answer(c.method, c.params) };
        } catch (e) {
          return { jsonrpc: "2.0", id: c.id, error: { code: -32000, message: (e as Error).message }, http400: (e as { http400?: boolean }).http400 };
        }
      };
      if (Array.isArray(body)) return new Response(JSON.stringify(body.map(one)), { status: 200 });
      const r = one(body) as { http400?: boolean; error?: unknown };
      if (r.http400) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: r.error }), { status: 400 });
      return new Response(JSON.stringify(r), { status: 200 });
    })
  );
  void url;
}

const log = (n: number, idx: number, from: string, to: string, raw: bigint): RpcLog => ({
  address: USDC_BASE,
  topics: [TRANSFER_TOPIC, from, to],
  data: "0x" + raw.toString(16).padStart(64, "0"),
  blockNumber: "0x" + n.toString(16),
  blockHash: hash(n),
  transactionHash: "0x" + (n * 100 + idx).toString(16).padStart(64, "0"),
  logIndex: "0x" + idx.toString(16),
});

const commits = () => calls.filter((c) => c.fn === "onchain_asset_commit").map((c) => c.args);
const touches = () => calls.filter((c) => c.fn === "onchain_indexer_touch").map((c) => c.args);
const forever = () => false;

beforeEach(() => {
  calls.length = 0;
  store.cursor = { last_block: 100, last_block_hash: hash(100) };
  store.commit = () => ({ ok: true, reconciled: true });
  chain = { head: 130, finalized: 120, chainId: 8453, logs: {}, supply: () => 1_000_000n, decimals: 6 };
  vi.stubEnv("BASE_RPC_URL", "http://base.node");
  installNode();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("asset registry: USDC vs USDC.e", () => {
  it("separates native USDC and bridged USDC.e by CONTRACT (both report symbol USDC on-chain)", () => {
    expect(classifyContract("polygon", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359")?.id).toBe("usdc");
    expect(classifyContract("polygon", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174")?.id).toBe("usdc.e");
    expect(classifyContract("arbitrum", "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8")?.id).toBe("usdc.e");
    expect(classifyContract("polygon", "0x" + "1".repeat(40))).toBeNull();
  });
  it("indexes native USDC on all five chains and never USDC.e; the exclusion is stated", () => {
    for (const c of ["ethereum", "base", "arbitrum", "polygon", "solana"]) expect(indexedAssetsOn(c).map((x) => x.asset.id)).toEqual(["usdc"]);
    const e = assetRegistry().find((a) => a.id === "usdc.e")!;
    expect(e.indexed).toBe(false);
    expect(e.exclusion).toMatch(/not summed into USDC/);
  });
});

describe("bucketize", () => {
  it("per-minute transfers/mints/burns, exact; duplicates counted once and reported", () => {
    const a = log(101, 0, W(1), W(2), 5n);
    const logs = [a, { ...a }, log(101, 1, ZW, W(3), 7n), log(131, 0, W(4), ZW, 2n), { ...log(131, 1, W(1), W(2), 1n), address: "0x" + "9".repeat(40) }];
    const r = bucketize(logs, USDC_BASE, (n) => T0 + n * 2);
    expect(r.duplicates).toBe(1);
    expect(r.malformed).toBe(1); // a different contract's log is never counted
    expect(r.totals).toEqual({ transfers: 1, transfer_raw: "5", mints: 1, mint_raw: "7", burns: 1, burn_raw: "2" });
    expect(r.rows.map((x) => x.bucket)).toEqual([new Date(Math.floor((T0 + 202) / 60) * 60000).toISOString(), new Date(Math.floor((T0 + 262) / 60) * 60000).toISOString()]);
  });
});

describe("scanAsset", () => {
  it("missing RPC -> not_configured; USDC.e is never indexed", async () => {
    vi.stubEnv("BASE_RPC_URL", "");
    expect((await scanAsset("base", "usdc", { deadline: forever })).status).toBe("not_configured");
    vi.stubEnv("POLYGON_RPC_URL", "http://p");
    expect((await scanAsset("polygon", "usdc.e", { deadline: forever })).status).toBe("not_configured");
    expect(commits()).toEqual([]);
  });

  it("first pass anchors at the finalized block with its exact supply; refuses a contract with other decimals", async () => {
    store.cursor = null;
    chain.supply = (n) => 5_000_000n + BigInt(n);
    const r = await scanAsset("base", "usdc", { deadline: forever });
    expect(r.status).toBe("caught_up");
    const a = calls.find((c) => c.fn === "onchain_asset_anchor")!.args;
    expect(a).toMatchObject({ p_block: 120, p_hash: hash(120), p_supply_raw: "5000120", p_decimals: 6 });
    store.cursor = null;
    chain.decimals = 18;
    calls.length = 0;
    const bad = await scanAsset("base", "usdc", { deadline: forever });
    expect(bad.status).toBe("failed");
    expect(bad.errors[0]).toMatch(/18 decimals/);
  });

  it("commits contiguous finalized ranges with parent hashes, exact totals and supply; never the unfinalized tip", async () => {
    chain.logs = { 105: [log(105, 0, W(1), W(2), 1_500_000n)], 112: [log(112, 0, ZW, W(2), 9n)], 125: [log(125, 0, W(1), W(2), 99n)] };
    const r = await scanAsset("base", "usdc", { deadline: forever, rangeBlocks: 10 });
    expect(r).toMatchObject({ status: "ok", cursorBefore: 100, cursorAfter: 120, commits: 2, reconciled: true });
    const c = commits();
    expect(c.map((x) => [x.p_expected, x.p_from, x.p_to, x.p_parent_hash])).toEqual([
      [100, 101, 110, hash(100)],
      [110, 111, 120, hash(110)],
    ]);
    expect(c[0].p_totals).toEqual({ transfers: 1, transfer_raw: "1500000", mints: 0, mint_raw: "0", burns: 0, burn_raw: "0" });
    expect(c[1].p_totals).toMatchObject({ mints: 1, mint_raw: "9" });
    expect(c.every((x) => x.p_supply_raw === "1000000")).toBe(true);
    // block 125 is above finalized: not aggregated
    expect(JSON.stringify(c)).not.toContain('"last_block":125');
    expect(touches().at(-1)).toMatchObject({ p_ok: true, p_indexed: 120, p_finalized: 120, p_head: 130 });
  });

  it("logs with blockTimestamp 0x0 are dated from headers fetched in ONE batch request", async () => {
    chain.tsZero = true;
    chain.logs = { 105: [log(105, 0, W(1), W(2), 1n)] };
    await scanAsset("base", "usdc", { deadline: forever, rangeBlocks: 50 });
    const b = (commits()[0].p_buckets as { bucket: string }[])[0];
    expect(b.bucket).toBe(new Date(Math.floor((T0 + 210) / 60) * 60000).toISOString());
  });

  it("HTTP 400 range-too-large splits the range and still commits it whole", async () => {
    chain.maxRange = 4;
    chain.logs = { 101: [log(101, 0, W(1), W(2), 1n)], 109: [log(109, 0, W(1), W(2), 2n)] };
    const r = await scanAsset("base", "usdc", { deadline: forever, rangeBlocks: 20 });
    expect(r.status).toBe("ok");
    expect(seen.filter((s) => s.method === "eth_getLogs").length).toBeGreaterThan(1);
    expect(commits()[0].p_totals).toMatchObject({ transfers: 2, transfer_raw: "3" });
  });

  it("failed RPC -> failed, health records the error, nothing committed", async () => {
    chain.fail = true;
    const r = await scanAsset("base", "usdc", { deadline: forever });
    expect(r.status).toBe("failed");
    expect(commits()).toEqual([]);
    expect(touches().at(-1)).toMatchObject({ p_ok: false });
    expect(String(touches().at(-1)!.p_error)).not.toMatch(/base\.node/); // no URL leaks
  }, 20_000);

  it("resume after a crash: a range whose commit never landed is re-read from the same cursor", async () => {
    chain.logs = { 103: [log(103, 0, W(1), W(2), 4n)] };
    store.commit = () => new Error("connection reset");
    const r1 = await scanAsset("base", "usdc", { deadline: forever, rangeBlocks: 50 });
    expect(r1.status).toBe("failed");
    expect(store.cursor!.last_block).toBe(100);
    store.commit = () => ({ ok: true, reconciled: true });
    calls.length = 0;
    const r2 = await scanAsset("base", "usdc", { deadline: forever, rangeBlocks: 50 });
    expect(r2.status).toBe("ok");
    expect(commits()).toHaveLength(1);
    expect(commits()[0]).toMatchObject({ p_expected: 100, p_from: 101, p_to: 120 });
    expect(commits()[0].p_totals).toMatchObject({ transfers: 1, transfer_raw: "4" });
  });

  it("another worker already committed the range -> stops without double counting", async () => {
    store.commit = () => ({ ok: false, reason: "stale_cursor" });
    const r = await scanAsset("base", "usdc", { deadline: forever, rangeBlocks: 5 });
    expect(r.status).toBe("partial");
    expect(commits()).toHaveLength(1);
  });

  it("a finalized parent whose hash changed is refused (reorg inconsistency) and reported", async () => {
    store.commit = (a) => (a.p_parent_hash === hash(100) ? { ok: true } : { ok: false, reason: "parent_hash_mismatch" });
    chain.forkHashAt = 100;
    const r = await scanAsset("base", "usdc", { deadline: forever });
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toMatch(/parent_hash_mismatch/);
  });

  it("a second provider that disagrees on supply blocks the commit and records provider_disagreement", async () => {
    vi.stubEnv("BASE_RPC_URL_SECONDARY", "http://second.node");
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init: RequestInit) => {
        if (u === "http://second.node") {
          const b = JSON.parse(String(init.body));
          const res = b.method === "eth_call" ? "0x" + (999n).toString(16).padStart(64, "0") : answer(b.method, b.params);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: res }), { status: 200 });
        }
        return realFetch(u, init);
      })
    );
    const r = await scanAsset("base", "usdc", { deadline: forever });
    expect(r.status).toBe("failed");
    expect(commits()).toEqual([]);
    expect(calls.find((c) => c.fn === "onchain_record_issue")!.args).toMatchObject({ p_kind: "provider_disagreement" });
  });

  it("duplicate events in a range are counted once and recorded as an integrity issue", async () => {
    const a = log(104, 0, W(1), W(2), 10n);
    chain.logs = { 104: [a, a] };
    await scanAsset("base", "usdc", { deadline: forever, rangeBlocks: 50 });
    expect(commits()[0].p_totals).toMatchObject({ transfers: 1, transfer_raw: "10" });
    expect(calls.find((c) => c.fn === "onchain_record_issue")!.args).toMatchObject({ p_kind: "duplicate_event" });
  });

  it("scanAssets covers exactly the chains opted in to node indexing", async () => {
    vi.stubEnv("ONCHAIN_NODE_CHAINS", "base");
    const r = await scanAssets({ deadline: forever });
    expect(r.map((x) => `${x.asset}@${x.chain}`)).toEqual(["usdc@base"]);
  });
});
