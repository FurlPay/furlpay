import { z } from "zod";
import { rpcEndpointList } from "@/lib/rpcEnv";
import { paymentChain, type PaymentChainId } from "./registry";
import { suiStartCheckpoint, verifySuiChain } from "./sui";
export const hex = z.string().regex(/^0x[0-9a-f]+$/i);
export const hash = z.string().regex(/^0x[0-9a-f]{64}$/i);
export const address = z.string().regex(/^0x[0-9a-f]{40}$/i);
export const blockSchema = z.object({ number: hex, hash, timestamp: hex });
// ---------------------------------------------------------------------------
// Payment-chain reader with failover.
//
// Endpoints per chain: the comma-separated list in the chain's env var (first is
// preferred), then the public endpoint from the registry. A transport failure,
// non-2xx, oversized or malformed answer, or JSON-RPC error moves to the next
// endpoint; an endpoint that fails is skipped for COOLDOWN_MS (per process).
//
// Every endpoint must prove it serves the RIGHT chain before its first answer is
// used (eth_chainId / Solana genesis hash), and the proof is cached per process.
// Without this, failover could quietly read payments from a misconfigured URL on
// another network after a single verifyChain() succeeded on a different endpoint.
// ---------------------------------------------------------------------------
const COOLDOWN_MS = 30_000;
type EndpointState = { failures: number; until: number };
const health: Map<string, EndpointState> = ((globalThis as unknown as { __furlpayRpcHealth?: Map<string, EndpointState> }).__furlpayRpcHealth ??= new Map());
const verified: Set<string> = ((globalThis as unknown as { __furlpayRpcVerified?: Set<string> }).__furlpayRpcVerified ??= new Set());

export function endpointsFor(chainId: PaymentChainId, env: Record<string, string | undefined> = process.env): string[] {
  const c = paymentChain(chainId);
  const configured = rpcEndpointList(c.env ? env[c.env] : undefined);
  return [...new Set([...configured, c.rpc])];
}

async function postRaw(endpoint: string, method: string, params: unknown[]): Promise<{ result?: unknown; error?: unknown }> {
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok || !res.body) throw new Error("Network reader unavailable");
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const {done,value} = await reader.read(); if(done) break; size+=value.length; if(size>2_000_000) throw new Error("Network read exceeded budget"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return z.object({ id: z.literal(1), result: z.unknown(), error: z.unknown().optional() }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
async function post(endpoint: string, method: string, params: unknown[]): Promise<unknown> {
  const body = await postRaw(endpoint, method, params);
  if(body.error || body.result === undefined) throw new Error("Network reader unavailable");
  return body.result;
}

const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
async function proveChain(chainId: PaymentChainId, endpoint: string) {
  const key = `${chainId}|${endpoint}`;
  if (verified.has(key)) return;
  const c = paymentChain(chainId);
  if (c.family === "solana") {
    if (await post(endpoint, "getGenesisHash", []) !== SOLANA_MAINNET_GENESIS) throw new Error("Wrong Solana cluster");
  } else if (c.family === "evm") {
    if (BigInt(hex.parse(await post(endpoint, "eth_chainId", []))) !== BigInt(c.chainId as number)) throw new Error("Wrong network");
  } else throw new Error("Not a JSON-RPC chain");
  verified.add(key);
}

export async function rpc(chainId: PaymentChainId, method: string, params: unknown[]): Promise<unknown> {
  const endpoints = endpointsFor(chainId);
  const now = Date.now();
  // Healthy endpoints first (in configured order), cooling-down ones as a last resort.
  // Wrong-chain endpoints (until = Infinity) are never used again in this process.
  const ordered = [...endpoints.filter(e => (health.get(e)?.until ?? 0) <= now), ...endpoints.filter(e => { const u = health.get(e)?.until ?? 0; return u > now && u !== Infinity; })];
  let wrongChain: Error | null = null;
  for (const endpoint of ordered) {
    try {
      await proveChain(chainId, endpoint);
      const result = await post(endpoint, method, params);
      health.delete(endpoint);
      return result;
    } catch (e) {
      const h = health.get(endpoint) ?? { failures: 0, until: 0 };
      // A wrong-chain endpoint is a configuration error: never use it, never "recover" it.
      const isWrong = e instanceof Error && /Wrong (network|Solana cluster)/.test(e.message);
      if (isWrong) wrongChain = e as Error;
      health.set(endpoint, { failures: h.failures + 1, until: isWrong ? Infinity : Date.now() + COOLDOWN_MS });
    }
  }
  // A misconfigured (wrong-chain) endpoint is reported even if others were merely down.
  throw wrongChain ?? new Error("Network reader unavailable");
}

/** Per-endpoint health for operators (no secrets: query strings are stripped). */
export function rpcHealth(chainId: PaymentChainId) {
  const now = Date.now();
  return endpointsFor(chainId).map(e => {
    const h = health.get(e); const u = new URL(e);
    return { endpoint: `${u.protocol}//${u.host}${u.pathname === "/" ? "" : "/…"}`, verified: verified.has(`${chainId}|${e}`), failures: h?.failures ?? 0, coolingDown: (h?.until ?? 0) > now };
  });
}

export async function verifyChain(chain: PaymentChainId) {
  const c = paymentChain(chain);
  if(c.family === "sui") return verifySuiChain();
  // rpc() proves the chain of whichever endpoint answers; one round trip is enough here.
  if(c.family === "solana") await rpc(chain,"getGenesisHash",[]);
  else await rpc(chain,"eth_chainId",[]);
}
export async function startBlock(chain: PaymentChainId): Promise<string> {
  if(paymentChain(chain).family === "sui") return suiStartCheckpoint();
  await verifyChain(chain);
  if(chain === "solana") return String(z.number().int().nonnegative().parse(await rpc(chain,"getSlot",[{commitment:"finalized"}])));
  const b = blockSchema.parse(await rpc(chain,"eth_getBlockByNumber",["latest",false]));
  if(Math.abs(Date.now()/1000 - Number(BigInt(b.timestamp)))>120) throw new Error("Network head is stale");
  // No payment can precede reservation of this never-reused destination.
  return (BigInt(b.number)+1n).toString();
}

/** For the wallet proxy (/api/chain/rpc): same failover and per-endpoint chain proof as rpc(), but a
 *  JSON-RPC error from a PROVEN endpoint is the node's authoritative answer (e.g. a rejected
 *  broadcast) and is returned to the caller, not retried elsewhere. */
export async function proxyRpc(chainId: PaymentChainId, method: string, params: unknown[]): Promise<{ result: unknown } | { rpcError: string }> {
  const endpoints = endpointsFor(chainId);
  const now = Date.now();
  const ordered = [...endpoints.filter(e => (health.get(e)?.until ?? 0) <= now), ...endpoints.filter(e => { const u = health.get(e)?.until ?? 0; return u > now && u !== Infinity; })];
  let wrongChain: Error | null = null;
  for (const endpoint of ordered) {
    try {
      await proveChain(chainId, endpoint);
      const body = await postRaw(endpoint, method, params);
      health.delete(endpoint);
      if (body.error !== undefined) {
        const message = z.object({ message: z.string() }).safeParse(body.error);
        return { rpcError: message.success ? message.data.message : "The node rejected the call." };
      }
      return { result: body.result ?? null };
    } catch (e) {
      const isWrong = e instanceof Error && /Wrong (network|Solana cluster)/.test(e.message);
      if (isWrong) wrongChain = e as Error;
      const h = health.get(endpoint) ?? { failures: 0, until: 0 };
      health.set(endpoint, { failures: h.failures + 1, until: isWrong ? Infinity : Date.now() + COOLDOWN_MS });
    }
  }
  throw wrongChain ?? new Error("Network reader unavailable");
}
