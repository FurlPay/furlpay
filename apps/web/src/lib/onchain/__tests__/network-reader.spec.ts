import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORKS, units } from "../networks";
import { readNetwork, readTransferRange, SOLANA_MAINNET_GENESIS, verifyNetwork } from "../network-reader";
import { searchInput, searchNetwork } from "../network-search";
const network = NETWORKS[0];
const hash = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const blocks = [1, 2, 3, 4].map((n) => ({ number: `0x${n}`, hash: hash(n), parentHash: hash(n - 1), timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16) }));
const topic = (digit: string) => "0x" + "0".repeat(24) + digit.repeat(40);
const transfer = { address: network.token, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", topic("1"), topic("2")], data: hash(1234567), blockNumber: "0x4", blockHash: hash(4), transactionHash: hash(55), logIndex: "0x0", removed: false };
function node(logs: unknown[], changedAnchor = false) {
  let tipReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    let result: unknown;
    if (method === "eth_chainId") result = "0x1";
    else if (method === "eth_getBlockByNumber") {
      const n = Number(BigInt(params[0]));
      result = n === 4 && ++tipReads > 1 && changedAnchor ? { ...blocks[3], hash: hash(9) } : blocks[n - 1];
    } else if (method === "eth_getLogs") result = params[0].blockHash === hash(4) ? logs : [];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("live transfer sample", () => {
  it("deduplicates delivery but keeps two different logs in the same transaction", async () => {
    node([transfer, transfer, { ...transfer, logIndex: "0x1" }, { ...transfer, logIndex: "0x2", topics: [transfer.topics[0], topic("0"), topic("2")] }]);
    const data = await readTransferRange(network, blocks[3], 3n, AbortSignal.timeout(1000));
    expect(data.transfers).toBe(2); expect(data.volumeRaw).toBe("2469134"); expect(data.mintedRaw).toBe("1234567");
    expect(data.senders).toBe(1); expect(data.events).toHaveLength(3); expect(data.events.every((e) => !e.finalized)).toBe(true);
  });
  it("rejects a conflicting duplicate", async () => {
    node([transfer, { ...transfer, data: hash(1) }]);
    await expect(readTransferRange(network, blocks[3], 4n, AbortSignal.timeout(1000))).rejects.toThrow("Conflicting duplicate");
  });
  it("rejects a replaced anchor instead of publishing mixed-fork totals", async () => {
    node([transfer], true);
    await expect(readTransferRange(network, blocks[3], 3n, AbortSignal.timeout(1000))).rejects.toThrow("Reorg");
  });
  it("rejects removed, malformed and wrong-contract logs", async () => {
    for (const log of [{ ...transfer, removed: true }, { ...transfer, address: "0x" + "f".repeat(40) }, { ...transfer, topics: [transfer.topics[0], hash(1), "0x" + "f".repeat(64)] }]) {
      node([log]); await expect(readTransferRange(network, blocks[3], 4n, AbortSignal.timeout(1000))).rejects.toThrow();
    }
  });
  it("refuses the wrong chain and keeps endpoint credentials out of responses", async () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "https://private.node/secret-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2105" }))));
    const data = await readNetwork(network);
    expect(data.state).toBe("unavailable"); expect(data.head).toBeNull(); expect(JSON.stringify(data)).not.toContain("secret-key");
  });
  it("preserves uint256 precision and rejects partial addresses or arbitrary chains", () => {
    const max = (2n ** 256n - 1n).toString();
    expect(units(max, 6).replace(".", "")).toBe(max);
    expect(searchInput.safeParse({ chain: "ethereum", q: "0x1234" }).success).toBe(false);
    expect(searchInput.safeParse({ chain: "https://evil.test", q: network.token }).success).toBe(false);
    expect(searchInput.safeParse({ chain: "solana", q: NETWORKS[4].token }).success).toBe(true);
  });
});

describe("Solana network identity", () => {
  const solana = NETWORKS.find((n) => n.id === "solana")!;
  const answer = (result: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }))));
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the real 44-character mainnet-beta genesis hash a node returns", async () => {
    // Value returned by api.mainnet-beta.solana.com getGenesisHash.
    answer("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    await expect(verifyNetwork(solana, AbortSignal.timeout(1000))).resolves.toBeUndefined();
    expect(SOLANA_MAINNET_GENESIS).toHaveLength(44);
  });
  it("rejects the 32-character CAIP-2 reference and other clusters", async () => {
    answer("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    await expect(verifyNetwork(solana, AbortSignal.timeout(1000))).rejects.toThrow("Wrong network");
    answer("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"); // devnet
    await expect(verifyNetwork(solana, AbortSignal.timeout(1000))).rejects.toThrow("Wrong network");
  });
});

describe("Solana address lookup", () => {
  afterEach(() => vi.unstubAllGlobals());
  const rpc = (balance: number) =>
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const { method } = JSON.parse(String(init.body));
      const result = method === "getGenesisHash" ? SOLANA_MAINNET_GENESIS : { context: { slot: 454_601_080 }, value: balance };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    }));
  const wallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

  it("reports an exact balance below 2^53 lamports", async () => {
    rpc(1_500_000_000);
    const r = await searchNetwork({ chain: "solana", q: wallet });
    expect(r.fields[0]).toEqual({ label: "SOL balance (confirmed)", value: "1.5" });
  });
  it("labels a balance above 2^53 lamports approximate instead of failing", async () => {
    rpc(10_572_652_082_892_308);
    const r = await searchNetwork({ chain: "solana", q: wallet });
    expect(r.fields[0].label).toBe("SOL balance (confirmed, approximate)");
    expect(r.fields[0].value.startsWith("≈ 10572652.")).toBe(true);
  });
});
