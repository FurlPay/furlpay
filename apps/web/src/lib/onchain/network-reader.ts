import { z } from "zod";
import { NETWORKS, type Network } from "./networks";
import { networkSnapshotSchema, type NetworkStatus, type NetworkSnapshot, type NetworkTransfer } from "./network-contract";

const quantity = z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/i);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/i);
const address = z.string().regex(/^0x[0-9a-f]{40}$/i);
const word = z.string().regex(/^0x[0-9a-f]{64}$/i);
const header = z.object({ number: quantity, hash, parentHash: hash, timestamp: quantity });
const logSchema = z.object({ address, topics: z.array(word), data: word, blockNumber: quantity, blockHash: hash, transactionHash: hash, logIndex: quantity, removed: z.boolean().optional() });
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO = "0x" + "0".repeat(40);
const hex = (n: bigint) => `0x${n.toString(16)}`;

export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export function rpcEndpoint(network: Network): string {
  return process.env[network.env]?.trim() || network.publicRpc;
}

/** Fixed, server-owned endpoints only. Neither URLs nor upstream error bodies leave this module. */
export async function nodeRead(network: Network, method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
  const response = await fetch(rpcEndpoint(network), {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok || !response.body) throw new Error("RPC unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("RPC response exceeds read budget");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = z.object({ jsonrpc: z.literal("2.0"), id: z.literal(1), result: z.unknown(), error: z.unknown().optional() }).parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (body.error || body.result === undefined) throw new Error("RPC method unavailable");
  return body.result;
}

export async function verifyNetwork(network: Network, signal: AbortSignal) {
  if (network.chainId === null) {
    // Mainnet-beta genesis identity, not a provider-selected cluster name. The full
    // 44-char hash: CAIP-2's "solana:5eykt4Us…KvdP" is a 32-char truncation of it.
    if (await nodeRead(network, "getGenesisHash", [], signal) !== SOLANA_MAINNET_GENESIS) throw new Error("Wrong network");
  } else if (BigInt(quantity.parse(await nodeRead(network, "eth_chainId", [], signal))) !== BigInt(network.chainId)) {
    throw new Error("Wrong network");
  }
}

/** Validate a complete, bounded range. No transaction-level dedup: repeated logs in one transaction can be real. */
export async function readTransferRange(network: Network, tip: z.infer<typeof header>, finalized: bigint | null, signal: AbortSignal): Promise<NonNullable<NetworkStatus["activity"]>> {
  const end = BigInt(tip.number), start = end > 3n ? end - 3n : 0n;
  const blockNumbers = Array.from({ length: Number(end - start + 1n) }, (_, i) => start + BigInt(i));
  const blocks = await Promise.all(blockNumbers.map(async (number) => header.parse(await nodeRead(network, "eth_getBlockByNumber", [hex(number), false], signal))));
  blocks.forEach((block, i) => {
    if (BigInt(block.number) !== blockNumbers[i] || (i > 0 && block.parentHash.toLowerCase() !== blocks[i - 1].hash.toLowerCase())) throw new Error("Inconsistent range");
  });
  if (blocks[blocks.length - 1].hash.toLowerCase() !== tip.hash.toLowerCase()) throw new Error("Reorg during read");
  // One block per request works with small provider log-range limits; failures do not become empty ranges.
  const raw = (await Promise.all(blocks.map((block) => nodeRead(network, "eth_getLogs", [{ address: network.token, blockHash: block.hash, topics: [TRANSFER] }], signal)))).flatMap((value) => z.array(logSchema).max(3000).parse(value));
  const events = new Map<string, NetworkTransfer>();
  const blockHashes = new Map(blocks.map((b) => [BigInt(b.number).toString(), b.hash.toLowerCase()]));
  for (const log of raw) {
    if (log.removed || log.address.toLowerCase() !== network.token.toLowerCase() || log.topics.length !== 3 || log.topics[0].toLowerCase() !== TRANSFER) throw new Error("Unexpected transfer log");
    if (!log.topics.slice(1).every((topic) => /^0x0{24}[0-9a-f]{40}$/i.test(topic))) throw new Error("Invalid address topic");
    const block = BigInt(log.blockNumber).toString();
    if (blockHashes.get(block) !== log.blockHash.toLowerCase()) throw new Error("Log outside canonical range");
    const from = `0x${log.topics[1].slice(-40)}`.toLowerCase(), to = `0x${log.topics[2].slice(-40)}`.toLowerCase();
    const key = `${network.id}:${log.blockHash.toLowerCase()}:${log.transactionHash.toLowerCase()}:${BigInt(log.logIndex)}`;
    const event: NetworkTransfer = { key, chain: network.id, hash: log.transactionHash.toLowerCase(), blockHash: log.blockHash.toLowerCase(), block, from, to, amountRaw: BigInt(log.data).toString(), kind: from === ZERO ? "mint" : to === ZERO ? "burn" : "transfer", finalized: finalized !== null && BigInt(block) <= finalized };
    const existing = events.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) throw new Error("Conflicting duplicate event");
    events.set(key, event);
  }
  // Confirm the anchor survived all reads before returning an aggregate.
  const anchor = header.parse(await nodeRead(network, "eth_getBlockByNumber", [tip.number, false], signal));
  if (anchor.hash.toLowerCase() !== tip.hash.toLowerCase()) throw new Error("Reorg during read");
  let volume = 0n, minted = 0n, burned = 0n, transfers = 0;
  const senders = new Set<string>(), receivers = new Set<string>();
  for (const event of events.values()) {
    if (event.kind === "mint") minted += BigInt(event.amountRaw);
    else if (event.kind === "burn") burned += BigInt(event.amountRaw);
    else { volume += BigInt(event.amountRaw); transfers++; senders.add(event.from); receivers.add(event.to); }
  }
  return { fromBlock: start.toString(), toBlock: end.toString(), transfers, volumeRaw: volume.toString(), mintedRaw: minted.toString(), burnedRaw: burned.toString(), senders: senders.size, receivers: receivers.size,
    events: [...events.values()].sort((a, b) => BigInt(a.amountRaw) > BigInt(b.amountRaw) ? -1 : BigInt(a.amountRaw) < BigInt(b.amountRaw) ? 1 : a.key.localeCompare(b.key)).slice(0, 20) };
}

export async function readNetwork(network: Network): Promise<NetworkStatus> {
  const signal = AbortSignal.timeout(10_000);
  const out: NetworkStatus = { chain: network.id, source: process.env[network.env]?.trim() ? "configured_rpc" : "public_rpc", state: "unavailable", checkedAt: new Date().toISOString(), reason: null, head: null, finalized: null, supplyRaw: null, supplyBlock: null, rpcMs: null, activity: null };
  try {
    const started = performance.now();
    await verifyNetwork(network, signal);
    out.rpcMs = Math.round(performance.now() - started);
    if (network.chainId === null) {
      const slot = z.number().int().nonnegative().safe();
      const [head, finalized, supply] = await Promise.all([
        nodeRead(network, "getSlot", [{ commitment: "confirmed" }], signal), nodeRead(network, "getSlot", [{ commitment: "finalized" }], signal),
        nodeRead(network, "getTokenSupply", [network.token, { commitment: "confirmed" }], signal),
      ]);
      out.head = String(slot.parse(head)); out.finalized = String(slot.parse(finalized));
      const parsed = z.object({ context: z.object({ slot }), value: z.object({ amount: z.string().regex(/^\d+$/), decimals: z.literal(6) }) }).parse(supply);
      out.supplyRaw = parsed.value.amount; out.supplyBlock = String(parsed.context.slot);
      out.state = "ready"; out.reason = "Supply and slots only. Network transfer enumeration requires a Geyser indexer.";
    } else {
      const tip = header.parse(await nodeRead(network, "eth_getBlockByNumber", ["latest", false], signal));
      const age = Date.now() / 1000 - Number(BigInt(tip.timestamp));
      if (age < -60 || age > 300) throw new Error("Stale node head");
      out.head = BigInt(tip.number).toString();
      const [fin, supply] = await Promise.allSettled([
        nodeRead(network, "eth_getBlockByNumber", ["finalized", false], signal).then((v) => header.parse(v)),
        nodeRead(network, "eth_call", [{ to: network.token, data: "0x18160ddd" }, { blockHash: tip.hash, requireCanonical: true }], signal).then((v) => word.parse(v)),
      ]);
      if (fin.status === "fulfilled" && BigInt(fin.value.number) <= BigInt(tip.number)) out.finalized = BigInt(fin.value.number).toString();
      if (supply.status === "fulfilled") { out.supplyRaw = BigInt(supply.value).toString(); out.supplyBlock = out.head; }
      try { out.activity = await readTransferRange(network, tip, out.finalized === null ? null : BigInt(out.finalized), signal); }
      catch { out.reason = "Recent transfers unavailable; no complete range could be verified."; }
      out.state = out.activity && out.supplyRaw !== null && out.finalized !== null ? "ready" : "degraded";
      if (out.state === "degraded" && !out.reason) out.reason = "Some node methods are unavailable.";
    }
  } catch { out.reason = "Node unavailable, stale, or serving a different network. Try refreshing."; }
  out.checkedAt = new Date().toISOString();
  return out;
}

let cached: NetworkSnapshot | null = null;
let expires = 0;
let pending: Promise<NetworkSnapshot> | null = null;
export async function readNetworks(): Promise<NetworkSnapshot> {
  if (cached && Date.now() < expires) return cached;
  if (pending) return pending;
  pending = Promise.all(NETWORKS.map(readNetwork)).then((chains) => {
    cached = networkSnapshotSchema.parse({ generatedAt: new Date().toISOString(), chains });
    expires = Date.now() + 15_000;
    return cached;
  }).finally(() => { pending = null; });
  return pending;
}
