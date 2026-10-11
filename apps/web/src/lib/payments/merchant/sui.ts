import { z } from "zod";
import nacl from "tweetnacl";
import { blake2b } from "@noble/hashes/blake2b";

// Sui support for merchant collection. Sources checked 2026-10-09:
//   * Native USDC (Circle): developers.circle.com/stablecoins/usdc-contract-addresses
//     — confirmed on-chain: coinMetadata(coinType) = { symbol USDC, decimals 6 }.
//     The type 0xdba34672…5523876882a4…::usdc::USDC seen in pasted specs has NO
//     metadata on mainnet: it does not exist.
//   * Reads use GraphQL: Sui JSON-RPC was disabled on Foundation mainnet nodes in
//     July 2026 (docs.sui.io/develop/accessing-data/json-rpc-migration).
//   * Finality: a transaction in a checkpoint certified by >2/3 of validators
//     cannot be reverted (docs.sui.io/concepts/transactions/transaction-lifecycle),
//     so one checkpoint is final depth.
//   * Signatures: flag(1) || signature || public key, over blake2b-256 of the
//     intent message (docs.sui.io/learn/cryptography/sui-intent-signing).
export const SUI_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const SUI_MAINNET_CHAIN_IDENTIFIER = "4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S";
export const SUI_GRAPHQL = "https://graphql.mainnet.sui.io/graphql";
export const suiAddress = z.string().regex(/^0x[0-9a-f]{64}$/, "A Sui address is 0x followed by 64 lowercase hex characters");

export function isSuiAddress(value: string): boolean {
  return /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value);
}

const blake = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 });
const hex = (bytes: Uint8Array) => "0x" + Buffer.from(bytes).toString("hex");

/** Address of an Ed25519 key: blake2b-256(0x00 || public key). Checked against live mainnet signatures. */
export function ed25519SuiAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("Ed25519 public keys are 32 bytes");
  return hex(blake(Uint8Array.from([0x00, ...publicKey])));
}

function uleb128(n: number): number[] {
  const out: number[] = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return out;
}

/** The 32 bytes a wallet signs for a personal message: blake2b-256([3,0,0] || BCS(vector<u8>)). */
export function personalMessageDigest(message: Uint8Array): Uint8Array {
  return blake(Uint8Array.from([3, 0, 0, ...uleb128(message.length), ...message]));
}

/** Verify a wallet's personal-message signature for `address`. Ed25519 only: secp256k1/r1,
 *  multisig and zkLogin signatures are refused rather than half-verified. */
export function verifySuiPersonalMessage(address: string, message: string, signatureBase64: string): boolean {
  if (!isSuiAddress(address)) return false;
  let bytes: Buffer;
  try { bytes = Buffer.from(signatureBase64, "base64"); } catch { return false; }
  if (bytes.length !== 97 || bytes[0] !== 0x00) return false;
  const signature = bytes.subarray(1, 65), publicKey = bytes.subarray(65, 97);
  if (ed25519SuiAddress(publicKey) !== address) return false;
  return nacl.sign.detached.verify(personalMessageDigest(new TextEncoder().encode(message)), signature, publicKey);
}

/** Endpoints: SUI_GRAPHQL_URL (comma-separated, first preferred), then the public Foundation endpoint. */
export function suiEndpoints(env: Record<string, string | undefined> = process.env): string[] {
  const configured = (env.SUI_GRAPHQL_URL ?? "").split(",").map(u => u.trim()).filter(u => u.startsWith("https://"));
  return [...new Set([...configured, SUI_GRAPHQL])];
}
const suiDown: Map<string, number> = ((globalThis as unknown as { __furlpaySuiDown?: Map<string, number> }).__furlpaySuiDown ??= new Map());
const suiProven: Set<string> = ((globalThis as unknown as { __furlpaySuiProven?: Set<string> }).__furlpaySuiProven ??= new Set());

async function suiPost<T>(endpoint: string, query: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok || !res.body) throw new Error("Network reader unavailable");
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new Error("Network read exceeded budget"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const body = z.object({ data: schema.nullable().optional(), errors: z.array(z.unknown()).optional() }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (body.errors?.length || body.data == null) throw new Error("Network reader unavailable");
  return body.data;
}

/** GraphQL with failover. Every endpoint proves it serves Sui MAINNET (chainIdentifier) before its
 *  first answer is used; a wrong-network endpoint is never used again in this process. */
export async function suiGraphql<T>(query: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const now = Date.now(); const list = suiEndpoints();
  const ordered = [...list.filter(e => (suiDown.get(e) ?? 0) <= now), ...list.filter(e => (suiDown.get(e) ?? 0) > now && suiDown.get(e) !== Infinity)];
  let wrongNetwork = false;
  for (const endpoint of ordered) {
    try {
      if (!suiProven.has(endpoint)) {
        const { chainIdentifier } = await suiPost(endpoint, "{ chainIdentifier }", {}, z.object({ chainIdentifier: z.string() }));
        if (chainIdentifier !== SUI_MAINNET_CHAIN_IDENTIFIER) { wrongNetwork = true; suiDown.set(endpoint, Infinity); continue; }
        suiProven.add(endpoint);
      }
      const data = await suiPost(endpoint, query, variables, schema);
      suiDown.delete(endpoint);
      return data;
    } catch { suiDown.set(endpoint, Date.now() + 30_000); }
  }
  throw new Error(wrongNetwork ? "Wrong Sui network" : "Network reader unavailable");
}

export async function verifySuiChain() {
  // suiGraphql proves the chain of whichever endpoint answers.
  await suiGraphql("{ chainIdentifier }", {}, z.object({ chainIdentifier: z.string() }));
}

/** Next checkpoint after the current one; a destination reserved now cannot have been paid before it. */
export async function suiStartCheckpoint(): Promise<string> {
  await verifySuiChain();
  const { checkpoint } = await suiGraphql("{ checkpoint { sequenceNumber timestamp } }", {}, z.object({ checkpoint: z.object({ sequenceNumber: z.number().int().nonnegative(), timestamp: z.string() }) }));
  if (Math.abs(Date.now() - Date.parse(checkpoint.timestamp)) > 120_000) throw new Error("Network head is stale");
  return String(checkpoint.sequenceNumber + 1);
}

const balanceChange = z.object({ owner: z.object({ address: z.string() }).nullable(), coinType: z.object({ repr: z.string() }), amount: z.string().regex(/^-?\d+$/) });
export const suiTransaction = z.object({
  digest: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  sender: z.object({ address: z.string() }).nullable(),
  effects: z.object({
    status: z.string(), timestamp: z.string().nullable(),
    checkpoint: z.object({ sequenceNumber: z.number().int().nonnegative(), digest: z.string() }).nullable(),
    balanceChanges: z.object({ nodes: z.array(balanceChange).max(50), pageInfo: z.object({ hasNextPage: z.boolean() }) }),
  }),
});
export type SuiTransaction = z.infer<typeof suiTransaction>;
const TX_FIELDS = "digest sender { address } effects { status timestamp checkpoint { sequenceNumber digest } balanceChanges(first: 50) { pageInfo { hasNextPage } nodes { owner { address } coinType { repr } amount } } }";

/** Transactions touching `address` from checkpoint `fromCheckpoint` on (oldest first), at most `pages` x 50. */
export async function suiTransactionsTo(address: string, fromCheckpoint: bigint, pages = 3): Promise<SuiTransaction[]> {
  const page = z.object({ transactions: z.object({ pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }), nodes: z.array(suiTransaction).max(50) }) });
  const out: SuiTransaction[] = []; let after: string | null = null;
  for (let i = 0; i < pages; i++) {
    const data: z.infer<typeof page> = await suiGraphql(
      `query($a: SuiAddress!, $c: UInt53, $after: String) { transactions(first: 50, after: $after, filter: { affectedAddress: $a, afterCheckpoint: $c }) { pageInfo { hasNextPage endCursor } nodes { ${TX_FIELDS} } } }`,
      // afterCheckpoint is exclusive.
      { a: address, c: fromCheckpoint > 0n ? Number(fromCheckpoint - 1n) : null, after }, page);
    out.push(...data.transactions.nodes);
    if (!data.transactions.pageInfo.hasNextPage) break;
    after = data.transactions.pageInfo.endCursor;
  }
  return out;
}

export async function fetchSuiTransaction(digest: string): Promise<SuiTransaction | null> {
  const data = await suiGraphql(`query($d: String!) { transaction(digest: $d) { ${TX_FIELDS} } }`, { d: digest }, z.object({ transaction: suiTransaction.nullable() }));
  return data.transaction;
}

/** Net native-USDC change for `owner` in one transaction (balance changes are already netted per owner and coin). */
export function usdcDelta(tx: SuiTransaction, owner: string): bigint {
  if (tx.effects.balanceChanges.pageInfo.hasNextPage) throw new Error("Too many balance changes to attribute");
  return tx.effects.balanceChanges.nodes.filter(b => b.coinType.repr === SUI_USDC && b.owner?.address === owner).reduce((n, b) => n + BigInt(b.amount), 0n);
}
