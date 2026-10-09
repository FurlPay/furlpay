import { z } from "zod";
import { paymentChain, type PaymentChainId } from "./registry";
import { suiStartCheckpoint, verifySuiChain } from "./sui";
export const hex = z.string().regex(/^0x[0-9a-f]+$/i);
export const hash = z.string().regex(/^0x[0-9a-f]{64}$/i);
export const address = z.string().regex(/^0x[0-9a-f]{40}$/i);
export const blockSchema = z.object({ number: hex, hash, timestamp: hex });
export async function rpc(chainId: PaymentChainId, method: string, params: unknown[]): Promise<unknown> {
  const c = paymentChain(chainId);
  const endpoint = (c.env && process.env[c.env]?.trim()) || c.rpc;
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok || !res.body) throw new Error("Network reader unavailable");
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const {done,value} = await reader.read(); if(done) break; size+=value.length; if(size>2_000_000) throw new Error("Network read exceeded budget"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const body = z.object({ id: z.literal(1), result: z.unknown(), error: z.unknown().optional() }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if(body.error || body.result === undefined) throw new Error("Network reader unavailable");
  return body.result;
}
export async function verifyChain(chain: PaymentChainId) {
  const c = paymentChain(chain);
  if(c.family === "sui") return verifySuiChain();
  if(c.family === "solana") {
    if(await rpc(chain,"getGenesisHash",[]) !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") throw new Error("Wrong Solana cluster");
  } else if(BigInt(hex.parse(await rpc(chain,"eth_chainId",[]))) !== BigInt(c.chainId)) throw new Error("Wrong network");
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
