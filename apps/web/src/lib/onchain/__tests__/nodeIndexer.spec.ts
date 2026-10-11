import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Direct-to-node source. Fixtures marked REAL were read from Ethereum mainnet
// (ethereum-rpc.publicnode.com) on 2026-10-07; the scan tests run the real
// scanChain against a scripted JSON-RPC node so every branch is exercised.

const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
const db = { cursor: null as null | { last_block: number; chain_id: number }, stored: [] as Record<string, unknown>[] };

vi.mock("@/lib/supabase", async (orig) => ({
  ...(await orig<typeof import("@/lib/supabase")>()),
  supabaseBackend: "supabase",
  sbRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === "onchain_ingest") return { inserted: (args.p_events as unknown[]).length, duplicates: 0, promoted: 0, reorg_replaced: 0, reinstated: 0, conflicts: 0, blocked_keys: [] };
    if (fn === "onchain_node_cursor_advance") {
      db.cursor = { last_block: Number(args.p_next), chain_id: Number(args.p_chain_id) };
      return true;
    }
    return true;
  }),
  sbSelect: vi.fn(async (table: string) => {
    if (table === "onchain_node_cursors") return db.cursor ? [db.cursor] : [];
    if (table === "onchain_events") return db.stored;
    return [];
  }),
}));
vi.mock("@/lib/kv", async (orig) => ({ ...(await orig<typeof import("@/lib/kv")>()), kvSet: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/events", () => ({ recordSecurityEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/linkedWalletStore", () => ({ findLinkedWalletOwner: vi.fn(async () => null) }));

import { decodeSymbol, getLogsAdaptive, nodeChains, scanChain, tokenAllowlist } from "../nodeIndexer";
import { formatUnits, normalizeTransferLog, TRANSFER_TOPIC, type RpcLog } from "../normalize";

// REAL: USDC Transfer, Ethereum block 0x18ed737, log 0x11.
const REAL_LOG: RpcLog = {
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  topics: [TRANSFER_TOPIC, "0x000000000000000000000000c9101faaac077d2f7a30c60d3d89955e1a89fa8b", "0x000000000000000000000000b4e16d0168e52d35cacd2c6185b44281ec28c9dc"],
  data: "0x0000000000000000000000000000000000000000000000000000000003c45982",
  blockNumber: "0x18ed737",
  transactionHash: "0x9f4630512fb265e0e10779f5f17ea48b8f10f2606eea9515c48659f2905fed44",
  blockHash: "0xd6bce793fe975f91d3c069469010598d7c348d4b1f34b4b310fc03d661e35eac",
  logIndex: "0x11",
  removed: false,
  blockTimestamp: "0x6ac5d8b3",
};
const REAL_TS = new Date(0x6ac5d8b3 * 1000).toISOString();

describe("normalizeTransferLog", () => {
  it("decodes a real mainnet USDC transfer exactly, with Allium's identity", () => {
    const t = normalizeTransferLog("ethereum", REAL_LOG, { blockTimestamp: REAL_TS, finalizedBlock: 0x18ed737n, token: { decimals: 6, symbol: "USDC" } })!;
    expect(t.event_key).toBe("ethereum:0x9f4630512fb265e0e10779f5f17ea48b8f10f2606eea9515c48659f2905fed44:17");
    expect(t.source).toBe("node_rpc");
    expect(t.from_address).toBe("0xc9101faaac077d2f7a30c60d3d89955e1a89fa8b");
    expect(t.to_address).toBe("0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc");
    expect(t.amount_raw).toBe("63199618");
    expect(t.amount).toBe("63.199618");
    expect(t.block_number).toBe(0x18ed737);
    expect(t.confirmation_state).toBe("finalized");
    expect(t.amount_usd).toBeNull(); // no invented price
  });
  it("is 'observed' above the node's finalized block, and amount stays null without decimals", () => {
    const t = normalizeTransferLog("ethereum", REAL_LOG, { blockTimestamp: REAL_TS, finalizedBlock: 0x18ed736n })!;
    expect(t.confirmation_state).toBe("observed");
    expect(t.amount).toBeNull();
    expect(t.amount_raw).toBe("63199618");
  });
  it("rejects removed logs, ERC-721 transfers, dirty address words and malformed data", () => {
    const ctx = { blockTimestamp: REAL_TS, finalizedBlock: 0n };
    expect(normalizeTransferLog("ethereum", { ...REAL_LOG, removed: true }, ctx)).toBeNull();
    expect(normalizeTransferLog("ethereum", { ...REAL_LOG, topics: [...REAL_LOG.topics, "0x" + "0".repeat(63) + "1"], data: "0x" }, ctx)).toBeNull();
    expect(normalizeTransferLog("ethereum", { ...REAL_LOG, topics: [TRANSFER_TOPIC, "0x" + "f".repeat(64), REAL_LOG.topics[2]] }, ctx)).toBeNull();
    expect(normalizeTransferLog("ethereum", { ...REAL_LOG, data: "0x01" }, ctx)).toBeNull();
    expect(normalizeTransferLog("ethereum", { ...REAL_LOG, topics: ["0x" + "1".repeat(64), REAL_LOG.topics[1], REAL_LOG.topics[2]] }, ctx)).toBeNull();
  });
  it("keeps a full uint256 exactly and labels mints", () => {
    const max = "0x" + "f".repeat(64);
    const t = normalizeTransferLog("ethereum", { ...REAL_LOG, data: max, topics: [TRANSFER_TOPIC, "0x" + "0".repeat(64), REAL_LOG.topics[2]] }, { blockTimestamp: REAL_TS, finalizedBlock: 0n, token: { decimals: 18, symbol: null } })!;
    expect(t.amount_raw).toBe("115792089237316195423570985008687907853269984665640564039457584007913129639935");
    expect(t.amount).toBe("115792089237316195423570985008687907853269984665640564039457.584007913129639935");
    expect(t.activity_type).toBe("mint");
  });
});

describe("helpers", () => {
  it("formatUnits is exact string arithmetic", () => {
    expect(formatUnits("1", 6)).toBe("0.000001");
    expect(formatUnits("1000000", 6)).toBe("1");
    expect(formatUnits("0", 18)).toBe("0");
    expect(formatUnits("123", 0)).toBe("123");
  });
  it("decodeSymbol reads ABI strings and legacy bytes32 (REAL USDC and MKR returns)", () => {
    expect(decodeSymbol("0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553444300000000000000000000000000000000000000000000000000000000")).toBe("USDC");
    expect(decodeSymbol("0x4d4b520000000000000000000000000000000000000000000000000000000000")).toBe("MKR");
    expect(decodeSymbol("0x")).toBeNull();
  });
  it("opt-in: a chain scans only when listed AND it has an RPC URL", () => {
    vi.stubEnv("ONCHAIN_NODE_CHAINS", "ethereum, base,ethereum");
    vi.stubEnv("ETHEREUM_RPC_URL", "http://node.local");
    vi.stubEnv("BASE_RPC_URL", "");
    expect(nodeChains()).toEqual(["ethereum"]);
    vi.stubEnv("ONCHAIN_NODE_TOKENS", "ethereum:0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eB48,*:0x" + "1".repeat(40) + ",base:0x" + "2".repeat(40) + ",junk");
    expect(tokenAllowlist("ethereum")).toEqual(["0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "0x" + "1".repeat(40)]);
    vi.unstubAllEnvs();
  });
});

// ── A scripted JSON-RPC node ────────────────────────────────────────────────

type Handler = (method: string, params: unknown[]) => unknown;
function node(handler: Handler) {
  const seen: { method: string; params: unknown[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(String(init.body));
      seen.push({ method, params });
      try {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: handler(method, params) }), { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: (e as Error).message } }), { status: 200 });
      }
    })
  );
  return seen;
}

describe("getLogsAdaptive", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("splits a range the node refuses as too large, and only then", async () => {
    const seen = node((_m, p) => {
      const f = p[0] as { fromBlock: string; toBlock: string };
      if (BigInt(f.toBlock) - BigInt(f.fromBlock) > 100n) throw new Error("query returned more than 10000 results");
      return [];
    });
    await getLogsAdaptive("http://n", { topics: [TRANSFER_TOPIC] }, 0n, 399n);
    const spans = seen.map((s) => (s.params[0] as { fromBlock: string; toBlock: string })).map((f) => Number(BigInt(f.toBlock) - BigInt(f.fromBlock)) + 1);
    expect(spans.filter((n) => n <= 101).reduce((a, b) => a + b, 0)).toBe(400); // covered exactly once
  });
  it("does not split on a rate limit or any other refusal", async () => {
    node(() => {
      throw new Error("rate limit exceeded");
    });
    await expect(getLogsAdaptive("http://n", { topics: [TRANSFER_TOPIC] }, 0n, 399n)).rejects.toThrow(/rate limit/);
    node(() => {
      throw new Error("Please specify an address in your request");
    });
    await expect(getLogsAdaptive("http://n", { topics: [TRANSFER_TOPIC] }, 0n, 399n)).rejects.toThrow(/specify an address/);
  });
});

describe("scanChain", () => {
  const WATCH = "0x" + "ab".repeat(20);
  const OTHER = "0x" + "cd".repeat(20);
  const word = (a: string) => "0x" + a.slice(2).padStart(64, "0");
  const blockHash = (n: number) => "0x" + n.toString(16).padStart(64, "0");
  const txHash = (n: number) => "0x" + (0xaa0000 + n).toString(16).padStart(64, "0");
  let chain: { head: number; finalized: number; chainId: number; logsAt: Record<number, RpcLog[]>; receipts: Record<string, unknown>; forkAt?: number };

  const logAt = (n: number, idx: number, from = OTHER, to = WATCH): RpcLog => ({
    address: "0x" + "ee".repeat(20),
    topics: [TRANSFER_TOPIC, word(from), word(to)],
    data: "0x" + (1_000_000n * BigInt(n)).toString(16).padStart(64, "0"),
    blockNumber: "0x" + n.toString(16),
    blockHash: blockHash(n),
    transactionHash: txHash(n),
    logIndex: "0x" + idx.toString(16),
  });

  beforeEach(() => {
    vi.stubEnv("ONCHAIN_NODE_CHAINS", "ethereum");
    vi.stubEnv("ETHEREUM_RPC_URL", "http://node.local");
    vi.stubEnv("ONCHAIN_WATCH_ADDRESSES", `ethereum:${WATCH}`);
    rpcCalls.length = 0;
    db.cursor = null;
    db.stored = [];
    chain = { head: 120, finalized: 100, chainId: 1, logsAt: {}, receipts: {} };
    node((method, params) => {
      if (method === "eth_chainId") return "0x" + chain.chainId.toString(16);
      if (method === "eth_getBlockByNumber") {
        const tag = params[0] as string;
        const n = tag === "latest" ? chain.head : tag === "finalized" ? chain.finalized : Number(BigInt(tag));
        const hash = chain.forkAt === n ? "0x" + "99".repeat(32) : blockHash(n);
        return { number: "0x" + n.toString(16), hash, timestamp: "0x" + (1_790_000_000 + n * 12).toString(16) };
      }
      if (method === "eth_getLogs") {
        const f = params[0] as { fromBlock: string; toBlock: string; topics: (string | string[] | null)[] };
        const out: RpcLog[] = [];
        for (let n = Number(BigInt(f.fromBlock)); n <= Number(BigInt(f.toBlock)); n++)
          for (const l of chain.logsAt[n] ?? []) {
            const fromOk = !f.topics[1] || (f.topics[1] as string[]).includes(l.topics[1]);
            const toOk = !f.topics[2] || (f.topics[2] as string[]).includes(l.topics[2]);
            if (fromOk && toOk) out.push(l);
          }
        return out;
      }
      if (method === "eth_call") return "0x" + "6".padStart(64, "0"); // decimals 6; symbol undecodable -> null
      if (method === "eth_getTransactionReceipt") return chain.receipts[params[0] as string] ?? null;
      throw new Error(`unexpected ${method}`);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const ingested = () => rpcCalls.filter((c) => c.fn === "onchain_ingest").flatMap((c) => c.args.p_events as Record<string, unknown>[]);

  it("is not_configured without an RPC URL, and refuses an endpoint serving another chain", async () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "");
    expect((await scanChain("ethereum", { deadline: () => false })).status).toBe("not_configured");
    vi.stubEnv("ETHEREUM_RPC_URL", "http://node.local");
    chain.chainId = 8453;
    const r = await scanChain("ethereum", { deadline: () => false });
    expect(r.status).toBe("failed");
    expect(r.errors[0]).toMatch(/chain id 8453, expected 1/);
    expect(ingested()).toHaveLength(0);
  });

  it("first pass anchors at the node's finalized block and reads only the unfinalized tip", async () => {
    chain.logsAt = { 90: [logAt(90, 0)], 110: [logAt(110, 3)] };
    const r = await scanChain("ethereum", { deadline: () => false });
    expect(r).toMatchObject({ status: "ok", from: 101, to: 120, finalized: 100, cursorAdvanced: true });
    expect(db.cursor).toEqual({ last_block: 100, chain_id: 1 });
    const ev = ingested();
    expect(ev.map((e) => e.block_number)).toEqual([110]); // block 90 is history: not read
    expect(ev[0]).toMatchObject({ source: "node_rpc", confirmation_state: "observed", direction: "in", scope: "watch", amount_raw: "110000000", amount: "110" });
    const advance = rpcCalls.find((c) => c.fn === "onchain_node_cursor_advance")!;
    expect(advance.args).toMatchObject({ p_expected: null, p_next: 100, p_chain_id: 1 });
  });

  it("a log carrying blockTimestamp 0x0 (Arbitrum's node, verified) is dated from the header, not dropped as 1970", async () => {
    chain.logsAt = { 110: [{ ...logAt(110, 3), blockTimestamp: "0x0" }] };
    await scanChain("ethereum", { deadline: () => false });
    const ev = ingested();
    expect(ev).toHaveLength(1);
    expect(ev[0].block_timestamp).toBe(new Date((1_790_000_000 + 110 * 12) * 1000).toISOString());
  });

  it("next pass re-reads from the cursor, finalizes what the node finalized, and advances by compare-and-set", async () => {
    db.cursor = { last_block: 100, chain_id: 1 };
    chain.finalized = 112;
    chain.logsAt = { 105: [logAt(105, 0)], 110: [logAt(110, 1, WATCH, OTHER)], 118: [logAt(118, 2)] };
    const r = await scanChain("ethereum", { deadline: () => false });
    expect(r).toMatchObject({ status: "ok", from: 101, to: 120, scannedThrough: 120, cursorAdvanced: true });
    const ev = ingested();
    expect(Object.fromEntries(ev.map((e) => [e.block_number, e.confirmation_state]))).toEqual({ 105: "finalized", 110: "finalized", 118: "observed" });
    expect(ev.find((e) => e.block_number === 110)!.direction).toBe("out");
    expect(rpcCalls.find((c) => c.fn === "onchain_node_cursor_advance")!.args).toMatchObject({ p_expected: 100, p_next: 112, p_hash: blockHash(112) });
  });

  it("proves orphans against the node: receipt gone -> reorged (final); canonical but unmatched -> left alone", async () => {
    db.cursor = { last_block: 100, chain_id: 1 };
    chain.finalized = 112;
    const ghost = "0x" + "77".repeat(32);
    const canonical = "0x" + "88".repeat(32);
    chain.receipts[canonical] = { blockHash: blockHash(104), blockNumber: "0x68" };
    db.stored = [
      { event_key: `ethereum:${ghost}:0`, tx_hash: ghost, block_hash: "0x" + "12".repeat(32), tracked_address: WATCH, asset_address: null },
      { event_key: `ethereum:${canonical}:4`, tx_hash: canonical, block_hash: blockHash(104), tracked_address: WATCH, asset_address: null },
      { event_key: `ethereum:${ghost}:9`, tx_hash: ghost, block_hash: null, tracked_address: "0x" + "00".repeat(20), asset_address: null }, // not tracked any more
    ];
    const r = await scanChain("ethereum", { deadline: () => false });
    expect(r.markedReorged).toBe(1);
    expect(r.unverified).toBe(1);
    const marks = rpcCalls.filter((c) => c.fn === "onchain_mark_reorged");
    expect(marks).toHaveLength(1);
    expect(marks[0].args).toMatchObject({ p_event_key: `ethereum:${ghost}:0`, p_final: true });
  });

  it("a tip that reorganises mid-scan is not trusted: partial, cursor untouched", async () => {
    db.cursor = { last_block: 100, chain_id: 1 };
    chain.finalized = 112;
    chain.logsAt = { 115: [logAt(115, 0)] };
    chain.forkAt = 115; // the header now has a different hash than the log claimed
    const r = await scanChain("ethereum", { deadline: () => false });
    expect(r.status).toBe("partial");
    expect(r.cursorAdvanced).toBe(false);
    expect(rpcCalls.some((c) => c.fn === "onchain_node_cursor_advance")).toBe(false);
    expect(ingested()).toHaveLength(0);
  });

  it("a pass cut short by its budget advances the cursor only as far as it scanned", async () => {
    db.cursor = { last_block: 0, chain_id: 1 };
    chain.head = 5_000;
    chain.finalized = 4_990;
    let windows = 0;
    const r = await scanChain("ethereum", { deadline: () => windows++ >= 1 });
    expect(r.status).toBe("partial");
    expect(r.scannedThrough).toBe(2_000);
    expect(rpcCalls.find((c) => c.fn === "onchain_node_cursor_advance")!.args).toMatchObject({ p_expected: 0, p_next: 2_000 });
  });

  it("a historical re-read (fromBlock) never moves the cursor", async () => {
    db.cursor = { last_block: 100, chain_id: 1 };
    chain.logsAt = { 50: [logAt(50, 0)] };
    const r = await scanChain("ethereum", { deadline: () => false, fromBlock: 40, maxBlocks: 20 });
    expect(r).toMatchObject({ from: 40, to: 59, cursorAdvanced: false });
    expect(ingested().map((e) => e.confirmation_state)).toEqual(["finalized"]);
    expect(rpcCalls.some((c) => c.fn === "onchain_node_cursor_advance")).toBe(false);
  });
});
