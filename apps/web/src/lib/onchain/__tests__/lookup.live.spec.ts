import { describe, expect, it } from "vitest";

// Live chain lookup against REAL mainnet (public test RPCs, set only here).
// Skipped unless ONCHAIN_LIVE_E2E=1. The reference transaction is a real
// Ethereum USDC transfer; its fields are cross-checked against a second
// provider's raw receipt, not against an explorer page.

const LIVE = process.env.ONCHAIN_LIVE_E2E === "1";
const ETH = "https://ethereum-rpc.publicnode.com";
const ETH2 = "https://eth.drpc.org";
const TX = "0x7bbbe0960fe33148558d87c72b5e5ef4c457b11dc43d939914001c78ae781556";

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const b = (await r.json()) as { result?: T; error?: { message: string } };
  if (b.error) throw new Error(b.error.message);
  return b.result as T;
}

describe.skipIf(!LIVE)("onchain lookup (live mainnet)", () => {
  it("reads the reference USDC transfer and matches an independent provider", async () => {
    process.env.ETHEREUM_RPC_URL = ETH;
    for (const k of ["BASE_RPC_URL", "ARBITRUM_RPC_URL", "POLYGON_RPC_URL"]) delete process.env[k];
    const { lookup } = await import("../lookup");
    const r = await lookup(TX);
    expect(r?.kind).toBe("evm_tx");
    const eth = r!.chains.find((c) => c.chain === "ethereum")!;
    expect(eth.status).toBe("found");
    expect(r!.chains.filter((c) => c.chain !== "ethereum").every((c) => c.status === "not_configured")).toBe(true);

    const ref = await rpc<{ blockNumber: string; logs: { address: string; topics: string[]; data: string }[] }>(ETH2, "eth_getTransactionReceipt", [TX]);
    expect(eth.block).toBe(BigInt(ref.blockNumber).toString());
    const usdc = ref.logs.filter((l) => l.address.toLowerCase() === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" && l.topics.length === 3);
    const mine = eth.transfers!.filter((t) => t.contract === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    expect(mine.map((t) => t.amountRaw)).toEqual(usdc.map((l) => BigInt(l.data).toString()));
    expect(mine.map((t) => t.from)).toEqual(usdc.map((l) => `0x${l.topics[1].slice(26)}`));
    expect(mine.map((t) => t.to)).toEqual(usdc.map((l) => `0x${l.topics[2].slice(26)}`));
    expect(mine.every((t) => t.asset === "USDC" && t.native === true)).toBe(true);
    console.log(JSON.stringify(eth, null, 1));
  }, 60_000);

  it("reads an address at one canonical block", async () => {
    process.env.ETHEREUM_RPC_URL = ETH;
    const { lookup } = await import("../lookup");
    const r = await lookup("0xFD9238dcD679316C6A95C08490E049fcaA9c979E");
    const eth = r!.chains.find((c) => c.chain === "ethereum")!;
    expect(eth.status).toBe("found");
    expect(eth.balances!.find((b) => b.asset === "USDC")).toBeTruthy();
    expect(r!.screening?.list).toMatch(/OFAC/);
    console.log(JSON.stringify(eth, null, 1));
  }, 60_000);
});
