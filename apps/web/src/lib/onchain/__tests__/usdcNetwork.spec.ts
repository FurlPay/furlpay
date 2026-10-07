import { afterEach, describe, expect, it, vi } from "vitest";
import { addDec, aggregateUsdcLogs, summarize, usdcNetwork, type UsdcChain } from "../usdcNetwork";
import { TRANSFER_TOPIC, type RpcLog } from "../normalize";

const ZERO_W = "0x" + "0".repeat(64);
const addrW = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const amt = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
let i = 0;
const log = (from: string, to: string, raw: bigint, extra: Partial<RpcLog> = {}): RpcLog => ({
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  topics: [TRANSFER_TOPIC, from, to],
  data: amt(raw),
  blockNumber: "0x10",
  blockHash: "0x" + "b".repeat(64),
  transactionHash: "0x" + (++i).toString(16).padStart(64, "0"),
  logIndex: "0x0",
  ...extra,
});

describe("aggregateUsdcLogs", () => {
  it("separates transfers, mints and burns, exactly", () => {
    const logs = [log(addrW(1), addrW(2), 1_500_000n), log(addrW(2), addrW(3), 250_000_000n), log(ZERO_W, addrW(4), 10_000_000_000n), log(addrW(5), ZERO_W, 3_000_000n)];
    const w = aggregateUsdcLogs(logs, 6, { fromBlock: 1, toBlock: 5, seconds: 10 });
    expect(w.transfers).toBe(2);
    expect(w.volume).toBe("251.5");
    expect(w.mints).toBe(1);
    expect(w.mintVolume).toBe("10000");
    expect(w.burns).toBe(1);
    expect(w.burnVolume).toBe("3");
    expect(w.netSupplyChange).toBe("9997");
    expect(w.uniqueSenders).toBe(3); // 1, 2, 5 (burner)
    expect(w.uniqueRecipients).toBe(3); // 2, 3, 4 (minted to)
    expect(w.activeAddresses).toBe(5);
    expect(w.eventsPerSecond).toBe(0.4);
    expect(w.largest[0].amount).toBe("250");
  });
  it("net supply change is signed when burns exceed mints", () => {
    const w = aggregateUsdcLogs([log(addrW(5), ZERO_W, 7_000_000n), log(ZERO_W, addrW(4), 2_000_000n)], 6, { fromBlock: 1, toBlock: 1, seconds: 1 });
    expect(w.netSupplyChange).toBe("-5");
  });
  it("ignores removed logs, duplicates, NFT-shaped and malformed logs", () => {
    const a = log(addrW(1), addrW(2), 1n);
    const logs = [a, { ...a }, log(addrW(1), addrW(2), 1n, { removed: true }), { ...log(addrW(1), addrW(2), 1n), topics: [TRANSFER_TOPIC, addrW(1), addrW(2), addrW(9)] }, { ...log(addrW(1), addrW(2), 1n), data: "0x01" }];
    expect(aggregateUsdcLogs(logs, 6, { fromBlock: 1, toBlock: 1, seconds: 1 }).transfers).toBe(1);
  });
  it("keeps a full uint256 without floats", () => {
    const max = (1n << 256n) - 1n;
    expect(aggregateUsdcLogs([log(addrW(1), addrW(2), max)], 6, { fromBlock: 1, toBlock: 1, seconds: 1 }).volume).toBe(
      "115792089237316195423570985008687907853269984665640564039457584007913129.639935"
    );
  });
});

describe("addDec", () => {
  it("adds signed decimal strings exactly", () => {
    expect(addDec("0", "1.5", 6)).toBe("1.5");
    expect(addDec("49074818839.70144", "4409670325.141638", 6)).toBe("53484489164.843078");
    expect(addDec("1", "-3.25", 6)).toBe("-2.25");
  });
});

const chain = (c: string, over: Partial<UsdcChain> = {}): UsdcChain => ({
  chain: c,
  status: "ok",
  reason: null,
  token: "t",
  explorer: null,
  decimals: 6,
  latestBlock: 1,
  finalizedBlock: 1,
  headAgeSeconds: 1,
  supply: { latest: "100.5", finalized: "100" },
  window: aggregateUsdcLogs([log(addrW(1), addrW(2), 2_000_000n)], 6, { fromBlock: 1, toBlock: 1, seconds: 2 }),
  windowReason: null,
  rpcLatencyMs: 5,
  readAt: "x",
  ...over,
});

describe("summarize", () => {
  it("totals only healthy chains and says which ones are included", () => {
    const s = summarize([chain("ethereum"), chain("base"), chain("polygon", { status: "unavailable", reason: "node down", supply: null, window: null }), chain("solana", { window: null })], 60);
    expect(s.totals.supplyChains).toEqual(["ethereum", "base", "solana"]);
    expect(s.totals.supply).toBe("301.5");
    expect(s.totals.windowChains).toEqual(["ethereum", "base"]);
    expect(s.totals.volume).toBe("4");
    expect(s.totals.transfers).toBe(2);
  });
  it("excludes a chain whose decimals disagree instead of mis-adding it", () => {
    const s = summarize([chain("ethereum"), chain("odd", { decimals: 18 })], 60);
    expect(s.totals.supplyChains).toEqual(["ethereum"]);
  });
  it("no healthy chain -> supply is null, not zero", () => {
    expect(summarize([chain("ethereum", { status: "not_configured", supply: null, window: null, decimals: null })], 60).totals.supply).toBeNull();
  });
});

describe("usdcNetwork", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("with no RPC configured every chain reports not_configured, and nothing is invented", async () => {
    for (const c of ["ETHEREUM", "BASE", "ARBITRUM", "POLYGON", "SOLANA", "HELIUS"]) vi.stubEnv(`${c}_RPC_URL`, "");
    const n = await usdcNetwork(300, Date.now() + 10 ** 9);
    expect(n.chains.every((c) => c.status === "not_configured" && c.supply === null && c.window === null)).toBe(true);
    expect(n.totals.supply).toBeNull();
    expect(n.totals.transfers).toBe(0);
  });
});

describe("live window is opt-in (RPC budget)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("a chain not in ONCHAIN_LIVE_WINDOW_CHAINS gets head + supply but no log scan: window null with the reason, never zeros", async () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "http://eth.node");
    for (const c of ["BASE", "ARBITRUM", "POLYGON", "SOLANA", "HELIUS"]) vi.stubEnv(`${c}_RPC_URL`, "");
    vi.stubEnv("ONCHAIN_LIVE_WINDOW_CHAINS", "");
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: RequestInit) => {
        const b = JSON.parse(String(init.body));
        methods.push(b.method);
        const result =
          b.method === "eth_chainId" ? "0x1" : b.method === "eth_getBlockByNumber" ? { number: "0x10", hash: "0x" + "a".repeat(64), timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16) } : b.params?.[0]?.data === "0x313ce567" ? "0x" + "6".padStart(64, "0") : "0x" + (5_000_000n).toString(16).padStart(64, "0");
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
      })
    );
    const n = await usdcNetwork(60, Date.now() + 10 ** 10);
    const eth = n.chains.find((c) => c.chain === "ethereum")!;
    expect(eth.status).toBe("ok");
    expect(eth.supply?.latest).toBe("5");
    expect(eth.window).toBeNull();
    expect(eth.windowReason).toMatch(/ONCHAIN_LIVE_WINDOW_CHAINS/);
    expect(methods).not.toContain("eth_getLogs");
    expect(n.totals.windowChains).toEqual([]);
  });
});
