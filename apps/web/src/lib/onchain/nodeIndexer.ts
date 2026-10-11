import { getChain } from "@/lib/services/chainRegistry";
import { sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { log } from "@/lib/log";
import { evmRpcFor, solanaRpc } from "./balances";
import { normalizeTransferLog, TRANSFER_TOPIC, type RpcLog, type Transfer } from "./normalize";
import { persist, scopeTransfers, touchSource, trackedAddresses, ZERO_COUNTS, type IngestCounts } from "./ingest";
import { scanSolana } from "./solanaNodeIndexer";
import { indexerEvent, scrub } from "./indexerLog";

// ---------------------------------------------------------------------------
// Direct-to-node source: the chain's own client, no data provider in between.
//
// Reads ERC-20 Transfer logs for every tracked address straight from an EVM
// node (a self-hosted Reth/Geth/op-reth/Nitro/Bor, or any JSON-RPC endpoint
// the operator configures via the existing <CHAIN>_RPC_URL variables) and
// feeds them through the SAME scope + onchain_ingest path as Allium. One
// pipeline, one identity ("<chain>:<tx>:<log_index>"), so:
//
//   - the node and Allium deduplicate against each other;
//   - a disagreement between them (different block for a finalized event,
//     different exact amount) is FLAGGED by onchain_ingest, never merged;
//   - finality is the node's own `finalized` block tag (post-Merge Ethereum,
//     OP Stack, Arbitrum Nitro and Bor all serve it; verified on public nodes
//     2026-10-07), not a fixed time margin;
//   - a stored event absent from the canonical chain at a finalized height is
//     PROVEN orphaned via eth_getTransactionReceipt and marked reorged with
//     reorg_final, which no later delivery of the orphaned block can undo.
//
// Standard JSON-RPC only: eth_chainId, eth_getBlockByNumber, eth_getLogs,
// eth_getTransactionReceipt, eth_call. The URL is never logged (it often
// carries a key). Opt-in per chain with ONCHAIN_NODE_CHAINS; nothing scans
// because an RPC URL happens to exist for balance reads.
//
// Not covered here: native-coin transfers (no log). Solana has its own
// scanner over the same pipeline (solanaNodeIndexer.ts, chain "solana" in
// ONCHAIN_NODE_CHAINS). Bitcoin/TRON keep coming from Allium where configured.
// ---------------------------------------------------------------------------

export const NODE_SOURCE = "node_rpc";
const RPC_TIMEOUT_MS = 12_000;
/** First eth_getLogs window. Halved on a range/size refusal, down to 1 block. */
const INITIAL_SPAN = 2_000;
const ADDRESS_CHUNK = 100;
const MAX_RECEIPT_CHECKS = 200;

export class JsonRpcError extends Error {
  constructor(public code: number | null, message: string) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Longest Retry-After honoured; a longer one fails the call (and the pass) visibly instead of stalling it. */
const MAX_RETRY_AFTER_MS = 15_000;

/**
 * One JSON-RPC call. Transport failures and 429/5xx retry with backoff; a
 * JSON-RPC error does not. A 429 with Retry-After waits exactly that long
 * (hosted endpoints rate-limit per method, e.g. 10 getTransaction / 10 s on
 * Solana's public RPC); a self-hosted node never sends one.
 */
export async function nodeRpc<T>(url: string, method: string, params: unknown[], attempts = 3): Promise<T> {
  let last: Error = new Error("no attempt");
  for (let i = 0; i < attempts; i++) {
    let waitMs: number | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`node responded ${res.status}`);
        const ra = Number(res.headers.get("retry-after"));
        if (res.status === 429 && Number.isFinite(ra) && ra >= 0) {
          indexerEvent("rpc_rate_limited", { method, retryAfterS: ra, attempt: i + 1 });
          if (ra * 1000 > MAX_RETRY_AFTER_MS) throw new JsonRpcError(429, `node rate limit: retry after ${ra}s`);
          waitMs = ra * 1000;
        } else if (res.status === 429) indexerEvent("rpc_rate_limited", { method, attempt: i + 1 });
      } else if (!res.ok) {
        // Some providers send a JSON-RPC refusal (e.g. "ranges over N blocks")
        // with HTTP 400; keep its message so getLogsAdaptive can split on it.
        const body = (await res.json().catch(() => null)) as { error?: { code?: number; message?: string } } | null;
        const msg = body?.error?.message ? String(body.error.message).slice(0, 200) : null;
        throw new JsonRpcError(body?.error?.code ?? null, msg ? `node responded ${res.status}: ${msg}` : `node responded ${res.status}`);
      } else {
        const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string } };
        if (body.error) throw new JsonRpcError(body.error.code ?? null, String(body.error.message ?? "rpc error").slice(0, 200));
        if (!("result" in body)) throw new JsonRpcError(null, "node returned no result");
        return body.result as T;
      }
    } catch (e) {
      if (e instanceof JsonRpcError) throw e;
      last = e instanceof Error ? e : new Error(String(e));
    }
    if (i < attempts - 1) await sleep(waitMs ?? 400 * 2 ** i + Math.random() * 200);
  }
  indexerEvent("rpc_unavailable", { method, attempts, error: last.message });
  throw new Error(scrub(last.message));
}

/**
 * Several calls in one JSON-RPC batch (all four hosted EVM providers and every
 * node client accept arrays; verified 2026-10-07), chunked. Results come back
 * in request order; any error in a chunk fails the whole call — a partial
 * answer is never used.
 */
export async function nodeRpcBatch<T>(url: string, calls: { method: string; params: unknown[] }[], chunk = 50): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < calls.length; i += chunk) {
    const part = calls.slice(i, i + chunk);
    let attempt = 0;
    for (;;) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(part.map((c, j) => ({ jsonrpc: "2.0", id: j, method: c.method, params: c.params }))),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        cache: "no-store",
      }).catch((e: Error) => e);
      if (res instanceof Error || res.status === 429 || res.status >= 500) {
        const ra = res instanceof Error ? NaN : Number(res.headers.get("retry-after"));
        if (!(res instanceof Error) && res.status === 429) indexerEvent("rpc_rate_limited", { method: `batch:${part[0].method}`, retryAfterS: Number.isFinite(ra) ? ra : null });
        if (++attempt >= 3 || (Number.isFinite(ra) && ra * 1000 > MAX_RETRY_AFTER_MS)) {
          const msg = res instanceof Error ? res.message : `node responded ${res.status}`;
          indexerEvent("rpc_unavailable", { method: `batch:${part[0].method}`, error: msg });
          throw new Error(scrub(msg));
        }
        await sleep(Number.isFinite(ra) ? ra * 1000 : 400 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new JsonRpcError(null, `node responded ${res.status}`);
      const body = (await res.json()) as { id: number; result?: T; error?: { code?: number; message?: string } }[] | { error?: { message?: string } };
      if (!Array.isArray(body)) throw new JsonRpcError(null, String(body?.error?.message ?? "node does not support batch requests").slice(0, 200));
      const byId = new Map(body.map((b) => [b.id, b]));
      for (let j = 0; j < part.length; j++) {
        const b = byId.get(j);
        if (!b) throw new JsonRpcError(null, "batch response is missing an item");
        if (b.error) throw new JsonRpcError(b.error.code ?? null, String(b.error.message ?? "rpc error").slice(0, 200));
        out.push(b.result as T);
      }
      break;
    }
  }
  return out;
}

/** Chains the operator opted in to scanning (ONCHAIN_NODE_CHAINS) that also have an RPC URL. */
export function nodeChains(): string[] {
  return (process.env.ONCHAIN_NODE_CHAINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((c, i, all) => c && all.indexOf(c) === i && (c === "solana" ? solanaRpc() !== null : evmRpcFor(c) !== null));
}

/** One pass over one opted-in chain, whichever RPC family it speaks. */
export function scanNode(chain: string, opts: { deadline: () => boolean; maxBlocks?: number; fromBlock?: number }): Promise<NodeScanReport> {
  if (chain === "solana") return scanSolana({ deadline: opts.deadline, maxTransactions: opts.maxBlocks, fromSlot: opts.fromBlock });
  return scanChain(chain, opts);
}

/** Optional token allowlist (ONCHAIN_NODE_TOKENS="chain:0x…,*:0x…"). Null = every token. */
export function tokenAllowlist(chain: string): string[] | null {
  const out = (process.env.ONCHAIN_NODE_TOKENS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      return i > 0 ? { chain: s.slice(0, i).toLowerCase(), address: s.slice(i + 1).toLowerCase() } : { chain: "*", address: s.toLowerCase() };
    })
    .filter((t) => (t.chain === "*" || t.chain === chain) && /^0x[0-9a-f]{40}$/.test(t.address))
    .map((t) => t.address);
  return out.length ? [...new Set(out)] : null;
}

const RANGE_REFUSAL = /range|too many|limit|exceed|response size|more than|query returned|block count|timeout/i;

/**
 * Largest eth_getLogs block span each endpoint has STATED it accepts
 * ("…with up to a 10 block range", Alchemy Free, verified 2026-10-07). Learned
 * from the first refusal, so later ranges go straight to exact chunks instead
 * of paying for a cascade of refused halvings (every refused call is billed).
 */
const statedSpan = new Map<string, bigint>();
const STATED_SPAN = /up to (?:a |an )?([\d,]+)[- ]block range|range (?:of|is limited to|limit(?:ed)? (?:of|to)) ([\d,]+) blocks|maximum (?:block )?range (?:of |is )?([\d,]+)/i;
export function learnedSpan(url: string): bigint | null {
  return statedSpan.get(url) ?? null;
}
export function resetLearnedSpans() {
  statedSpan.clear();
}
const CHUNKS_PER_BATCH = 20;

/**
 * eth_getLogs over [from, to]. When the endpoint has stated its maximum span,
 * the range is read in exact chunks of that span, batched; otherwise a range
 * refusal halves the range. Any other refusal is thrown (and reported), never
 * skipped. Every block is covered exactly once.
 */
export async function getLogsAdaptive(url: string, filter: { address?: string[]; topics: (string | string[] | null)[] }, from: bigint, to: bigint): Promise<RpcLog[]> {
  const span = statedSpan.get(url);
  if (span && to - from + 1n > span) {
    const chunks: [bigint, bigint][] = [];
    for (let a = from; a <= to; a += span) chunks.push([a, a + span - 1n < to ? a + span - 1n : to]);
    const out: RpcLog[] = [];
    for (let i = 0; i < chunks.length; i += CHUNKS_PER_BATCH) {
      const part = chunks.slice(i, i + CHUNKS_PER_BATCH);
      const res = await nodeRpcBatch<RpcLog[]>(url, part.map(([a, b]) => ({ method: "eth_getLogs", params: [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }] }))).catch(async (e) => {
        // The stated span shrank (plan change) or batching is refused: fall back per chunk.
        if (!(e instanceof JsonRpcError)) throw e;
        const one: RpcLog[][] = [];
        for (const [a, b] of part) one.push(await getLogsDirect(url, filter, a, b));
        return one;
      });
      for (const logs of res) for (const l of logs) out.push(l);
    }
    return out;
  }
  return getLogsDirect(url, filter, from, to);
}

async function getLogsDirect(url: string, filter: { address?: string[]; topics: (string | string[] | null)[] }, from: bigint, to: bigint): Promise<RpcLog[]> {
  try {
    return await nodeRpc<RpcLog[]>(url, "eth_getLogs", [{ ...filter, fromBlock: hex(from), toBlock: hex(to) }]);
  } catch (e) {
    // A rate limit is not a range refusal: splitting would multiply the calls.
    if (e instanceof JsonRpcError && RANGE_REFUSAL.test(e.message) && !/rate/i.test(e.message) && to > from) {
      const m = STATED_SPAN.exec(e.message);
      const stated = m ? BigInt((m[1] ?? m[2] ?? m[3]).replace(/,/g, "")) : null;
      if (stated && stated > 0n && stated < to - from + 1n && statedSpan.get(url) !== stated) {
        statedSpan.set(url, stated);
        indexerEvent("range_split", { from: Number(from), to: Number(to), learnedSpan: Number(stated), reason: e.message });
        return getLogsAdaptive(url, filter, from, to);
      }
      const mid = from + (to - from) / 2n;
      indexerEvent("range_split", { from: Number(from), to: Number(to), mid: Number(mid), reason: e.message });
      const a = await getLogsDirect(url, filter, from, mid);
      const b = await getLogsDirect(url, filter, mid + 1n, to);
      for (const l of b) a.push(l);
      return a;
    }
    throw e;
  }
}

/** A log's blockTimestamp only when it is a real time (non-zero hex); otherwise null. */
export function usableTimestamp(v: string | undefined | null): string | null {
  return typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) && BigInt(v) > 0n ? v : null;
}

const hex = (n: bigint) => `0x${n.toString(16)}`;
const topicFor = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

interface Block {
  number: string;
  hash: string;
  timestamp: string;
}

/** decimals()/symbol() as the token contract itself reports them. Cached per process. */
const tokenCache = new Map<string, { decimals: number | null; symbol: string | null }>();
export async function tokenMeta(url: string, chain: string, token: string) {
  const key = `${chain}:${token}`;
  const hit = tokenCache.get(key);
  if (hit) return hit;
  const call = (data: string) => nodeRpc<string>(url, "eth_call", [{ to: token, data }, "latest"]).catch(() => "0x");
  const [d, s] = await Promise.all([call("0x313ce567"), call("0x95d89b41")]);
  const dec = /^0x[0-9a-f]{64}$/i.test(d) ? Number(BigInt(d)) : NaN;
  const meta = { decimals: Number.isInteger(dec) && dec >= 0 && dec <= 255 ? dec : null, symbol: decodeSymbol(s) };
  tokenCache.set(key, meta);
  return meta;
}

/** ABI `string` or legacy `bytes32` symbol; null unless it is short printable text. */
export function decodeSymbol(ret: string): string | null {
  const h = ret.replace(/^0x/, "");
  let bytes: Buffer | null = null;
  if (h.length >= 192) {
    const off = Number(BigInt(`0x${h.slice(0, 64)}`)) * 2;
    const len = Number(BigInt(`0x${h.slice(off, off + 64)}`));
    if (len > 0 && len <= 64) bytes = Buffer.from(h.slice(off + 64, off + 64 + len * 2), "hex");
  } else if (h.length === 64) {
    bytes = Buffer.from(h, "hex");
    const end = bytes.indexOf(0);
    bytes = end >= 0 ? bytes.subarray(0, end) : bytes;
  }
  const s = bytes?.toString("utf8") ?? "";
  return s && s.length <= 32 && /^[\x20-\x7e]+$/.test(s) ? s.trim() || null : null;
}

export interface NodeScanReport {
  chain: string;
  status: "ok" | "partial" | "failed" | "not_configured";
  reason?: string;
  from: number | null;
  to: number | null;
  head: number | null;
  finalized: number | null;
  scannedThrough: number | null;
  addresses: number;
  logs: number;
  counts: IngestCounts;
  markedReorged: number;
  unverified: number;
  cursorAdvanced: boolean;
  errors: string[];
  /** Chain-specific extras (Solana: token accounts scanned, known-but-gone accounts). */
  detail?: Record<string, unknown>;
}

/**
 * One pass over one chain: [cursor+1 .. head] (bounded by maxBlocks), where
 * the cursor is the newest finalized block already fully scanned. The
 * unfinalized tip is re-read every pass; only the finalized part advances the
 * cursor. `deadline()` is checked between windows; a pass cut short advances
 * the cursor only as far as it actually scanned.
 */
export async function scanChain(chain: string, opts: { deadline: () => boolean; maxBlocks?: number; fromBlock?: number }): Promise<NodeScanReport> {
  const report: NodeScanReport = {
    chain,
    status: "ok",
    from: null,
    to: null,
    head: null,
    finalized: null,
    scannedThrough: null,
    addresses: 0,
    logs: 0,
    counts: { ...ZERO_COUNTS },
    markedReorged: 0,
    unverified: 0,
    cursorAdvanced: false,
    errors: [],
  };
  const url = evmRpcFor(chain);
  if (!url) return { ...report, status: "not_configured", reason: `No RPC URL for ${chain}.` };
  if (supabaseBackend !== "supabase") return { ...report, status: "not_configured", reason: "No durable store (SUPABASE_URL)." };
  const expectedId = getChain(chain)?.chainId;
  if (!expectedId) return { ...report, status: "not_configured", reason: `${chain} is not in the chain registry.` };

  // Nothing tracked on this chain: no RPC call at all (each pass would
  // otherwise pay for chainId + two headers on a metered plan). When an
  // address is added later, its first pass anchors at the finalized block.
  const trackedHere = (await trackedAddresses()).filter((t) => (t.chains === "evm" || t.chains.includes(chain)) && /^0x[0-9a-f]{40}$/.test(t.address));
  if (trackedHere.length === 0) return { ...report, reason: `No tracked addresses on ${chain}; nothing to scan (no RPC calls made).` };

  try {
    // 1. Pin the endpoint to the chain it claims to serve.
    const id = Number(BigInt(await nodeRpc<string>(url, "eth_chainId", [])));
    if (id !== expectedId) throw new Error(`endpoint for ${chain} answered chain id ${id}, expected ${expectedId}`);

    // 2. Where the chain is, and what it has finalized — from the node itself.
    const [head, fin] = await Promise.all([nodeRpc<Block>(url, "eth_getBlockByNumber", ["latest", false]), nodeRpc<Block | null>(url, "eth_getBlockByNumber", ["finalized", false])]);
    if (!fin) throw new Error("node does not serve the 'finalized' block tag");
    const headN = BigInt(head.number);
    const finN = BigInt(fin.number);
    report.head = Number(headN);
    report.finalized = Number(finN);

    const [cursor] = await sbSelect<{ last_block: number | string; chain_id: number | string }>("onchain_node_cursors", `select=last_block,chain_id&chain=eq.${encodeURIComponent(chain)}&limit=1`);
    if (cursor && Number(cursor.chain_id) !== id) throw new Error(`${chain} is pinned to chain id ${cursor.chain_id}`);
    const cursorN = cursor ? BigInt(cursor.last_block) : null;
    // No cursor yet: start at the finalized tip (history is a backfill, not a side effect).
    const from = opts.fromBlock !== undefined ? BigInt(opts.fromBlock) : cursorN !== null ? cursorN + 1n : finN + 1n;
    const maxBlocks = BigInt(Math.max(1, opts.maxBlocks ?? 10_000));
    const to = headN < from + maxBlocks - 1n ? headN : from + maxBlocks - 1n;
    report.from = Number(from);
    report.to = Number(to);

    // 3. Who to look for.
    const tracked = await trackedAddresses();
    const addresses = [...new Set(tracked.filter((t) => (t.chains === "evm" || t.chains.includes(chain)) && /^0x[0-9a-f]{40}$/.test(t.address)).map((t) => t.address))];
    report.addresses = addresses.length;
    const tokens = tokenAllowlist(chain);

    // 4. Scan window by window; every address chunk, both directions.
    const byKey = new Map<string, RpcLog>();
    let scanned: bigint | null = null;
    if (addresses.length > 0 && from <= to) {
      for (let w = from; w <= to; w += BigInt(INITIAL_SPAN)) {
        if (opts.deadline()) {
          report.status = "partial";
          report.errors.push(`budget expired at block ${w}`);
          break;
        }
        const wEnd = w + BigInt(INITIAL_SPAN) - 1n < to ? w + BigInt(INITIAL_SPAN) - 1n : to;
        for (let i = 0; i < addresses.length; i += ADDRESS_CHUNK) {
          const topics = addresses.slice(i, i + ADDRESS_CHUNK).map(topicFor);
          for (const filter of [
            { topics: [TRANSFER_TOPIC, topics] },
            { topics: [TRANSFER_TOPIC, null, topics] },
          ]) {
            const logs = await getLogsAdaptive(url, tokens ? { ...filter, address: tokens } : filter, w, wEnd);
            for (const l of logs) byKey.set(`${l.transactionHash}:${l.logIndex}`.toLowerCase(), l);
          }
        }
        scanned = wEnd;
      }
    } else if (from <= to) {
      scanned = to; // nothing tracked: the range is trivially complete
    }
    report.scannedThrough = scanned === null ? null : Number(scanned);
    report.logs = byKey.size;

    // 5. Normalize. Timestamps come with the log when the client includes a
    // real one (Arbitrum's node answers "0x0" — verified 2026-10-07 — which
    // would date every transfer 1970 and drop it); otherwise from the block
    // header, whose hash must match the log's.
    const blocks = new Map<string, Block>();
    const transfers: Transfer[] = [];
    let reorgedMidScan = false;
    for (const l of byKey.values()) {
      let tsHex = usableTimestamp(l.blockTimestamp);
      if (!tsHex && l.blockNumber) {
        let b = blocks.get(l.blockNumber);
        if (!b) {
          b = await nodeRpc<Block>(url, "eth_getBlockByNumber", [l.blockNumber, false]);
          blocks.set(l.blockNumber, b);
        }
        if (b.hash.toLowerCase() !== String(l.blockHash).toLowerCase()) {
          reorgedMidScan = true;
          continue;
        }
        tsHex = b.timestamp;
      }
      if (!tsHex) continue;
      const token = await tokenMeta(url, chain, l.address.toLowerCase());
      const t = normalizeTransferLog(chain, l, { blockTimestamp: new Date(Number(BigInt(tsHex)) * 1000).toISOString(), finalizedBlock: finN, token });
      if (t) transfers.push(t);
    }
    if (reorgedMidScan) {
      // The tip moved under us. Ingest what is consistent; do not advance.
      report.status = "partial";
      report.errors.push("chain reorganised during the scan; tip will be re-read next pass");
    }

    // 6. One write path: scope, OFAC screen, onchain_ingest.
    const { scoped } = await scopeTransfers(transfers);
    report.counts = await persist(scoped);

    // 7. Prove orphans in the finalized part of what was scanned.
    const finalScanned = scanned === null ? null : scanned < finN ? scanned : finN;
    if (finalScanned !== null && finalScanned >= from && addresses.length > 0) {
      const returned = new Set(transfers.map((t) => t.event_key));
      const stored = await sbSelect<{ event_key: string; tx_hash: string; block_hash: string | null; tracked_address: string; asset_address: string | null }>(
        "onchain_events",
        `select=event_key,tx_hash,block_hash,tracked_address,asset_address&chain=eq.${encodeURIComponent(chain)}&block_number=gte.${from}&block_number=lte.${finalScanned}&confirmation_state=neq.reorged&log_index=not.is.null&limit=5000`
      );
      const tracked = new Set(addresses);
      let checks = 0;
      for (const s of stored) {
        if (returned.has(s.event_key) || !tracked.has(s.tracked_address)) continue;
        if (tokens && (!s.asset_address || !tokens.includes(s.asset_address))) continue;
        if (checks++ >= MAX_RECEIPT_CHECKS) {
          report.errors.push(`receipt check budget reached (${MAX_RECEIPT_CHECKS})`);
          break;
        }
        const receipt = await nodeRpc<{ blockHash: string; blockNumber: string } | null>(url, "eth_getTransactionReceipt", [s.tx_hash]);
        const orphaned = receipt === null || (s.block_hash !== null && receipt.blockHash.toLowerCase() !== s.block_hash && BigInt(receipt.blockNumber) <= finN);
        if (orphaned) {
          const marked = await sbRpc<boolean>("onchain_mark_reorged", {
            p_event_key: s.event_key,
            p_reason: receipt === null ? `transaction absent from ${chain} at finalized block ${finN}` : `transaction is in finalized block ${receipt.blockHash.slice(0, 18)}, not the stored one`,
            p_final: true,
          });
          if (marked) report.markedReorged++;
        } else {
          // The transaction is canonical but our filter did not return this
          // log (not a 3-topic Transfer, or a token outside the allowlist).
          // Left exactly as it is; counted for operators.
          report.unverified++;
        }
      }
    }

    // 8. Advance the cursor over the finalized part only, compare-and-set.
    if (!reorgedMidScan && finalScanned !== null && (cursorN === null || finalScanned > cursorN) && opts.fromBlock === undefined) {
      const at = finalScanned === finN ? fin : await nodeRpc<Block>(url, "eth_getBlockByNumber", [hex(finalScanned), false]);
      report.cursorAdvanced = await sbRpc<boolean>("onchain_node_cursor_advance", {
        p_chain: chain,
        p_chain_id: id,
        p_expected: cursorN === null ? null : Number(cursorN),
        p_next: Number(finalScanned),
        p_hash: at.hash.toLowerCase(),
      });
    } else if (cursorN === null && opts.fromBlock === undefined) {
      // First pass with nothing finalized in range: anchor at the finalized tip.
      report.cursorAdvanced = await sbRpc<boolean>("onchain_node_cursor_advance", { p_chain: chain, p_chain_id: id, p_expected: null, p_next: Number(finN), p_hash: fin.hash.toLowerCase() });
    }

    await touchSource(`node:${chain}`, true, { dataAt: new Date(Number(BigInt(head.timestamp)) * 1000).toISOString() });
    if (reorgedMidScan || report.markedReorged > 0) indexerEvent("indexer_reorg_detected", { indexer: "wallet", chain, midScan: reorgedMidScan, provenOrphans: report.markedReorged });
    indexerEvent("block_indexed", { indexer: "wallet", chain, from: report.from, through: report.scannedThrough, head: report.head, finalized: report.finalized, logs: report.logs, inserted: report.counts.inserted, status: report.status });
    if (report.cursorAdvanced) indexerEvent("indexer_checkpoint_saved", { indexer: "wallet", chain, block: report.finalized });
    await walletStatus(chain, true, { head: report.head, headTime: new Date(Number(BigInt(head.timestamp)) * 1000).toISOString(), finalized: report.finalized, indexed: report.scannedThrough });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200);
    report.status = "failed";
    report.errors.push(msg);
    indexerEvent("indexer_error", { indexer: "wallet", chain, error: msg });
    await touchSource(`node:${chain}`, false, { error: msg });
    await walletStatus(chain, false, { head: report.head, headTime: null, finalized: report.finalized, indexed: null, error: msg });
  }
  return report;
}

/** Wallet-indexer health (onchain_indexer_status, migration 0034). Never throws; absent before 0034. */
async function walletStatus(chain: string, ok: boolean, f: { head: number | null; headTime: string | null; finalized: number | null; indexed: number | null; error?: string }) {
  await sbRpc("onchain_indexer_touch", {
    p_indexer: "wallet",
    p_chain: chain,
    p_asset: "",
    p_ok: ok,
    p_head: f.head,
    p_head_time: f.headTime,
    p_finalized: f.finalized,
    p_indexed: f.indexed,
    p_indexed_time: null,
    p_error: f.error ?? null,
    p_duration_ms: null,
    p_detail: {},
  }).catch(() => {});
}

/** Every opted-in chain (or just `only`), sequentially, inside one budget. */
export async function scanNodes(opts: { deadline: () => boolean; maxBlocks?: number; only?: string[] }): Promise<NodeScanReport[]> {
  const out: NodeScanReport[] = [];
  for (const chain of nodeChains()) {
    if (opts.only && !opts.only.includes(chain)) continue;
    if (opts.deadline()) break;
    out.push(await scanNode(chain, opts));
  }
  return out;
}
