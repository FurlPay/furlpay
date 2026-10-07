import { afterAll, describe, expect, it, vi } from "vitest";

// LIVE: the USDC network reader against REAL mainnet nodes, cross-checked
// against a SECOND, independent provider for the same block range. Skipped
// unless ONCHAIN_LIVE_E2E=1. Nothing is mocked.

const LIVE = process.env.ONCHAIN_LIVE_E2E === "1";
const PRIMARY: Record<string, string> = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  polygon: "https://polygon-bor-rpc.publicnode.com",
};
const SECOND: Record<string, string> = {
  ethereum: "https://rpc.mevblocker.io",
  base: "https://base-rpc.publicnode.com",
  arbitrum: "https://arbitrum.drpc.org",
  polygon: "https://polygon.drpc.org",
};

import { getLogsAdaptive, nodeRpc } from "../nodeIndexer";
import { TRANSFER_TOPIC } from "../normalize";
import { aggregateUsdcLogs, usdcNetwork } from "../usdcNetwork";

describe.skipIf(!LIVE)("USDC network reader, live mainnet, cross-checked", () => {
  afterAll(() => vi.unstubAllEnvs());

  it("every EVM chain: supply and the transfer window match an independent provider exactly", async () => {
    for (const [c, url] of Object.entries(PRIMARY)) vi.stubEnv(`${c.toUpperCase()}_RPC_URL`, url);
    vi.stubEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com");
    const net = await usdcNetwork(60);
    for (const ch of net.chains) {
      const w = ch.window;
      console.log(`  ${ch.chain}: ${ch.status}${ch.reason ? ` (${ch.reason})` : ""} block ${ch.latestBlock} fin ${ch.finalizedBlock} supply ${ch.supply?.latest} | ${w ? `${w.transfers} transfers, ${w.volume} vol, ${w.mints}/${w.burns} mint/burn over ${w.seconds}s (${w.fromBlock}..${w.toBlock})` : ch.windowReason}`);
    }
    for (const chain of Object.keys(PRIMARY)) {
      const ch = net.chains.find((x) => x.chain === chain)!;
      expect(ch.status, `${chain}: ${ch.reason}`).toBe("ok");
      expect(ch.decimals).toBe(6);
      const w = ch.window!;
      expect(w, `${chain}: ${ch.windowReason}`).not.toBeNull();
      // Independent provider, same contract, same block range.
      const at = (step: string) => (e: Error) => {
        throw new Error(`${chain} ${step} on ${SECOND[chain]}: ${e.message}`);
      };
      const logs = await getLogsAdaptive(SECOND[chain], { address: [ch.token!], topics: [TRANSFER_TOPIC] }, BigInt(w.fromBlock), BigInt(w.toBlock)).catch(at("eth_getLogs"));
      const again = aggregateUsdcLogs(logs, 6, { fromBlock: w.fromBlock, toBlock: w.toBlock, seconds: w.seconds });
      expect(again.transfers).toBe(w.transfers);
      expect(again.volume).toBe(w.volume);
      expect(again.mintVolume).toBe(w.mintVolume);
      expect(again.burnVolume).toBe(w.burnVolume);
      expect(again.uniqueSenders).toBe(w.uniqueSenders);
      const supply = await nodeRpc<string>(SECOND[chain], "eth_call", [{ to: ch.token, data: "0x18160ddd" }, `0x${ch.latestBlock!.toString(16)}`]).catch(at("eth_call"));
      expect((Number(BigInt(supply)) / 1e6).toFixed(0)).toBe(Number(ch.supply!.latest).toFixed(0));
      expect(BigInt(supply).toString()).toBe(ch.supply!.latest.replace(".", "").replace(/^0+/, "").padEnd(BigInt(supply).toString().length, "0"));
    }
    const sol = net.chains.find((x) => x.chain === "solana")!;
    if (sol.status === "ok") expect(sol.window).toBeNull(); // honest: no Geyser here
    expect(net.totals.supplyChains.length).toBeGreaterThanOrEqual(4);
  }, 240_000);
});
