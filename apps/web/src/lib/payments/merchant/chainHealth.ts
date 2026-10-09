import { PAYMENT_CHAINS, requiredConfirmations, type PaymentChainId } from "./registry";
import { blockSchema, rpc, rpcHealth } from "./rpc";
import { raiseAlert } from "@/lib/alerts";

/** A head older than this stops crediting in practice (Arc finalizes in under a second; Ethereum every ~12s). */
export const STALE_HEAD_SECONDS = 120;

export type ChainHealth = { chain: PaymentChainId; ok: boolean; height: string | null; headAgeSeconds: number | null; error?: string; endpoints: ReturnType<typeof rpcHealth> };
/** ARC-P5-002: live head freshness per collectable EVM chain (Arc included), with per-endpoint failover state. */
export async function chainHealth(): Promise<ChainHealth[]> {
  const chains = PAYMENT_CHAINS.filter(c => c.family === "evm" && requiredConfirmations(c.id) !== null).map(c => c.id);
  return Promise.all(chains.map(async (chain): Promise<ChainHealth> => {
    try {
      const b = blockSchema.parse(await rpc(chain, "eth_getBlockByNumber", ["latest", false]));
      return { chain, ok: true, height: BigInt(b.number).toString(), headAgeSeconds: Math.max(0, Math.round(Date.now() / 1000 - Number(BigInt(b.timestamp)))), endpoints: rpcHealth(chain) };
    } catch (e) {
      return { chain, ok: false, height: null, headAgeSeconds: null, error: (e as Error).message.slice(0, 120), endpoints: rpcHealth(chain) };
    }
  }));
}

/** Raise one fingerprinted alert per unhealthy chain (cooldown in lib/alerts keeps a standing outage to one page). */
export async function alertChainHealth(chains?: ChainHealth[]) {
  const list = chains ?? await chainHealth();
  let raised = 0;
  for (const c of list) {
    if (c.ok && (c.headAgeSeconds ?? 0) <= STALE_HEAD_SECONDS) continue;
    raised++;
    await raiseAlert(c.ok
      ? { kind: "merchant.chain_head_stale", severity: "high", title: `${c.chain} head is ${c.headAgeSeconds}s old`, detail: `Latest block ${c.height} on ${c.chain} is older than ${STALE_HEAD_SECONDS}s; payments on it will not be credited until it advances.`, dimensions: { chain: c.chain }, context: { height: c.height, headAgeSeconds: c.headAgeSeconds } }
      : { kind: "merchant.chain_unreachable", severity: "high", title: `${c.chain} RPC unreachable`, detail: `No proven endpoint answered for ${c.chain}: ${c.error ?? "unknown"}`, dimensions: { chain: c.chain }, context: { endpoints: c.endpoints.map(e => e.endpoint).join(", ") } });
  }
  return raised;
}
