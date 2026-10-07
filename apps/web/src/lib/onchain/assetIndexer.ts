import { getChain } from "@/lib/services/chainRegistry";
import { sbInsertIgnoreDuplicates, sbRpc, sbSelect, supabaseBackend } from "@/lib/supabase";
import { evmRpcFor, solanaRpc } from "./balances";
import { getAsset, indexedAssetsOn, type AssetId } from "./assets";
import { indexerEvent } from "./indexerLog";
import { getLogsAdaptive, nodeChains, nodeRpc, nodeRpcBatch, usableTimestamp } from "./nodeIndexer";
import { TRANSFER_TOPIC, type RpcLog } from "./normalize";

// ---------------------------------------------------------------------------
// Network-wide asset indexer (USDC first): EVERY Transfer log of an indexed
// asset's contract, read from the chain's own node, aggregated per UTC minute
// and committed with the asset's exact supply at the range's last block.
//
// Correctness rests on the database (migration 0034, onchain_asset_commit):
//   - FINALIZED blocks only, so nothing committed is ever reorged away;
//   - each range continues the cursor exactly (no gap) and its parent hash
//     must equal the hash recorded at the cursor (no silent fork);
//   - compare-and-set on the cursor: a range is aggregated exactly once even
//     with several workers or a worker restarted mid-pass;
//   - supply reconciliation: supply(prev) + minted - burned must equal
//     supply(now) exactly, or the range is flagged (supply_mismatch).
//
// A crash between reading and committing loses nothing: the cursor did not
// move, so the next pass re-reads the same range. Downtime is caught up range
// by range from the cursor. An optional second provider per chain
// (<CHAIN>_RPC_URL_SECONDARY) must agree on the range's last block hash and
// supply, or the range is not committed (provider_disagreement).
// ---------------------------------------------------------------------------

const ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_RANGE = 500;
/** Solana supply is snapshotted at most this often (slots move every ~400 ms). */
const SOLANA_SNAPSHOT_EVERY_MS = 60_000;

export interface AssetScanReport {
  chain: string;
  asset: AssetId;
  status: "ok" | "caught_up" | "partial" | "failed" | "not_configured";
  reason?: string;
  head: number | null;
  finalized: number | null;
  cursorBefore: number | null;
  cursorAfter: number | null;
  commits: number;
  logs: number;
  /** null when no commit reconciled supply in this pass (first anchor, or supply unreadable). */
  reconciled: boolean | null;
  durationMs: number;
  errors: string[];
}

interface Block {
  number: string;
  hash: string;
  timestamp: string;
}

export interface MinuteBucket {
  bucket: string;
  transfers: number;
  transfer_raw: string;
  mints: number;
  mint_raw: string;
  burns: number;
  burn_raw: string;
  first_block: number;
  last_block: number;
}

/**
 * Pure: Transfer logs of ONE contract -> per-minute buckets and range totals.
 * `blockTime(n)` gives the block's unix seconds. Duplicate (tx, logIndex)
 * pairs are counted once and reported; malformed logs are counted and skipped.
 */
/**
 * Bucket width in seconds (ONCHAIN_ASSET_BUCKET_SECONDS: 60, 300, 900 or
 * 3600; default 60). Wider buckets need fewer header reads (see
 * resolveBuckets), which matters on a metered RPC plan; history rolls up to
 * hour/day either way.
 */
export function bucketSeconds(): number {
  const v = Number(process.env.ONCHAIN_ASSET_BUCKET_SECONDS ?? "60");
  return [60, 300, 900, 3600].includes(v) ? v : 60;
}

/**
 * Exact time bucket for every block that has a log, reading as few headers as
 * possible. Block timestamps never decrease, so if both ends of a block
 * interval fall in the same bucket, every block between them does too; only
 * intervals that straddle a boundary AND contain log blocks are split (one
 * batched header read per level). Cost ≈ boundaries × log2(blocks) headers
 * instead of one header per active block — no estimate, no interpolation.
 * Headers read along the way are checked against the logs' block hashes.
 */
export async function resolveBuckets(
  url: string,
  lo: { n: bigint; ts: number; hash: string },
  hi: { n: bigint; ts: number; hash: string },
  logs: RpcLog[],
  width: number,
  own: Map<bigint, number> = new Map()
): Promise<{ bucket: Map<bigint, number>; headersRead: number; mismatch: { block: bigint; log: string; header: string } | null }> {
  const b = (t: number) => Math.floor(t / width) * width;
  const blocks = [...new Set(logs.filter((l) => l.blockNumber).map((l) => BigInt(l.blockNumber!)))].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const logHash = new Map(logs.filter((l) => l.blockNumber && l.blockHash).map((l) => [BigInt(l.blockNumber!), String(l.blockHash).toLowerCase()]));
  const known = new Map<bigint, number>([[lo.n, lo.ts], [hi.n, hi.ts], ...own]);
  const bucket = new Map<bigint, number>();
  for (const [n, t] of own) bucket.set(n, b(t));
  let headersRead = 0;
  // Intervals [a, c] with known ends, holding log blocks in (a, c].
  let level: [bigint, bigint][] = [[lo.n, hi.n]];
  while (level.length) {
    const next: [bigint, bigint][] = [];
    const want = new Set<bigint>();
    for (const [a, c] of level) {
      const inside = blocks.filter((n) => n > a && n <= c && !bucket.has(n));
      if (!inside.length) continue;
      if (b(known.get(a)!) === b(known.get(c)!)) {
        for (const n of inside) bucket.set(n, b(known.get(c)!));
        continue;
      }
      if (c - a <= 1n) {
        bucket.set(c, b(known.get(c)!));
        continue;
      }
      const mid = a + (c - a) / 2n;
      if (!known.has(mid)) want.add(mid);
      next.push([a, mid], [mid, c]);
    }
    if (want.size) {
      const nums = [...want];
      const hdrs = await nodeRpcBatch<Block | null>(url, nums.map((n) => ({ method: "eth_getBlockByNumber", params: [hex(n), false] })));
      headersRead += nums.length;
      for (let i = 0; i < nums.length; i++) {
        const h = hdrs[i];
        if (!h) throw new Error(`node did not return header ${nums[i]}`);
        const lh = logHash.get(nums[i]);
        if (lh && h.hash.toLowerCase() !== lh) return { bucket, headersRead, mismatch: { block: nums[i], log: lh, header: h.hash.toLowerCase() } };
        known.set(nums[i], Number(BigInt(h.timestamp)));
      }
    }
    level = next;
  }
  for (const n of blocks) if (!bucket.has(n)) throw new Error(`could not place block ${n} in a time bucket`);
  return { bucket, headersRead, mismatch: null };
}

export function bucketize(logs: RpcLog[], contract: string, blockTime: (block: number) => number, width = 60) {
  const buckets = new Map<number, { t: number; tr: bigint; m: number; mr: bigint; b: number; br: bigint; fb: number; lb: number }>();
  const seen = new Set<string>();
  let duplicates = 0;
  let malformed = 0;
  const totals = { transfers: 0, transfer_raw: 0n, mints: 0, mint_raw: 0n, burns: 0, burn_raw: 0n };
  for (const l of logs) {
    if (l.removed) continue;
    if (String(l.address).toLowerCase() !== contract) {
      malformed++;
      continue;
    }
    const t = (l.topics ?? []).map((x) => String(x).toLowerCase());
    if (t.length !== 3 || t[0] !== TRANSFER_TOPIC || !/^0x[0-9a-f]{64}$/i.test(l.data ?? "") || !l.blockNumber || !l.transactionHash || !l.logIndex) {
      malformed++;
      continue;
    }
    const id = `${l.transactionHash}:${l.logIndex}`.toLowerCase();
    if (seen.has(id)) {
      duplicates++;
      continue;
    }
    seen.add(id);
    const n = Number(BigInt(l.blockNumber));
    const minute = Math.floor(blockTime(n) / width) * width;
    const raw = BigInt(l.data);
    const from = `0x${t[1].slice(26)}`;
    const to = `0x${t[2].slice(26)}`;
    const b = buckets.get(minute) ?? { t: 0, tr: 0n, m: 0, mr: 0n, b: 0, br: 0n, fb: n, lb: n };
    if (from === ZERO) {
      b.m++;
      b.mr += raw;
      totals.mints++;
      totals.mint_raw += raw;
    } else if (to === ZERO) {
      b.b++;
      b.br += raw;
      totals.burns++;
      totals.burn_raw += raw;
    } else {
      b.t++;
      b.tr += raw;
      totals.transfers++;
      totals.transfer_raw += raw;
    }
    b.fb = Math.min(b.fb, n);
    b.lb = Math.max(b.lb, n);
    buckets.set(minute, b);
  }
  const rows: MinuteBucket[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([m, b]) => ({ bucket: new Date(m * 1000).toISOString(), transfers: b.t, transfer_raw: b.tr.toString(), mints: b.m, mint_raw: b.mr.toString(), burns: b.b, burn_raw: b.br.toString(), first_block: b.fb, last_block: b.lb }));
  return {
    rows,
    totals: { transfers: totals.transfers, transfer_raw: totals.transfer_raw.toString(), mints: totals.mints, mint_raw: totals.mint_raw.toString(), burns: totals.burns, burn_raw: totals.burn_raw.toString() },
    duplicates,
    malformed,
  };
}

const hex = (n: bigint) => `0x${n.toString(16)}`;

async function supplyAt(url: string, contract: string, block: bigint): Promise<bigint | null> {
  const r = await nodeRpc<string>(url, "eth_call", [{ to: contract, data: "0x18160ddd" }, hex(block)]).catch(() => null);
  return r && /^0x[0-9a-f]{1,64}$/i.test(r) ? BigInt(r) : null;
}

async function issue(chain: string, asset: string, kind: string, block: number | null, detail: string) {
  indexerEvent("integrity_issue", { chain, asset, kind, block, detail });
  await sbRpc("onchain_record_issue", { p_chain: chain, p_asset: asset, p_kind: kind, p_block: block, p_detail: detail }).catch(() => {});
}

async function touch(chain: string, asset: string, ok: boolean, f: { head?: Block | null; finalized?: bigint | null; indexed?: number | null; indexedTime?: string | null; error?: string; durationMs: number; detail?: Record<string, unknown> }) {
  await sbRpc("onchain_indexer_touch", {
    p_indexer: "asset",
    p_chain: chain,
    p_asset: asset,
    p_ok: ok,
    p_head: f.head ? Number(BigInt(f.head.number)) : null,
    p_head_time: f.head ? new Date(Number(BigInt(f.head.timestamp)) * 1000).toISOString() : null,
    p_finalized: f.finalized === undefined || f.finalized === null ? null : Number(f.finalized),
    p_indexed: f.indexed ?? null,
    p_indexed_time: f.indexedTime ?? null,
    p_error: f.error ?? null,
    p_duration_ms: f.durationMs,
    p_detail: f.detail ?? {},
  }).catch(() => {});
}

/**
 * One pass for one (chain, asset): commit finalized ranges from the cursor
 * until caught up, the deadline, or an error. Never throws.
 */
export async function scanAsset(chain: string, assetId: AssetId, opts: { deadline: () => boolean; rangeBlocks?: number }): Promise<AssetScanReport> {
  const started = Date.now();
  const report: AssetScanReport = { chain, asset: assetId, status: "ok", head: null, finalized: null, cursorBefore: null, cursorAfter: null, commits: 0, logs: 0, reconciled: null, durationMs: 0, errors: [] };
  const done = (r: AssetScanReport) => ({ ...r, durationMs: Date.now() - started });
  const asset = getAsset(assetId);
  const contract = asset?.deployments[chain];
  if (!asset || !contract || !asset.indexed) return done({ ...report, status: "not_configured", reason: `${assetId} is not indexed on ${chain}.` });
  const url = evmRpcFor(chain);
  if (!url) return done({ ...report, status: "not_configured", reason: `No RPC URL for ${chain}.` });
  if (supabaseBackend !== "supabase") return done({ ...report, status: "not_configured", reason: "No durable store (SUPABASE_URL)." });
  const chainId = getChain(chain)?.chainId;
  if (!chainId) return done({ ...report, status: "not_configured", reason: `${chain} is not in the chain registry.` });
  const secondary = process.env[`${chain.toUpperCase()}_RPC_URL_SECONDARY`]?.trim() || null;
  let head: Block | null = null;
  let fin: bigint | null = null;

  try {
    const id = Number(BigInt(await nodeRpc<string>(url, "eth_chainId", [])));
    if (id !== chainId) throw new Error(`endpoint answered chain id ${id}, expected ${chainId}`);
    const [h, f] = await Promise.all([nodeRpc<Block>(url, "eth_getBlockByNumber", ["latest", false]), nodeRpc<Block | null>(url, "eth_getBlockByNumber", ["finalized", false])]);
    if (!f) throw new Error("node does not serve the 'finalized' block tag");
    head = h;
    fin = BigInt(f.number);
    report.head = Number(BigInt(h.number));
    report.finalized = Number(fin);
    const decimals = asset.decimals; // checked against the contract on first anchor

    const [cur] = await sbSelect<{ last_block: string | number; last_block_hash: string }>("onchain_asset_cursors", `select=last_block,last_block_hash&chain=eq.${encodeURIComponent(chain)}&asset=eq.${encodeURIComponent(assetId)}&limit=1`);
    if (!cur) {
      // First run: anchor at the finalized tip with its supply. History before it is not implied.
      const dRaw = await nodeRpc<string>(url, "eth_call", [{ to: contract, data: "0x313ce567" }, "latest"]);
      const dec = Number(BigInt(dRaw));
      if (dec !== decimals) throw new Error(`${assetId} on ${chain} reports ${dec} decimals; registry expects ${decimals}`);
      const supply = await supplyAt(url, contract, fin);
      const anchored = await sbRpc<boolean>("onchain_asset_anchor", {
        p_chain: chain,
        p_asset: assetId,
        p_contract: contract,
        p_chain_id: chainId,
        p_block: Number(fin),
        p_hash: f.hash.toLowerCase(),
        p_time: new Date(Number(BigInt(f.timestamp)) * 1000).toISOString(),
        p_supply_raw: supply === null ? null : supply.toString(),
        p_decimals: decimals,
        p_provider: "node_rpc",
      });
      report.cursorAfter = Number(fin);
      report.status = "caught_up";
      if (anchored) indexerEvent("indexer_checkpoint_saved", { indexer: "asset", chain, asset: assetId, block: Number(fin), anchor: true });
      await touch(chain, assetId, true, { head, finalized: fin, indexed: Number(fin), indexedTime: new Date(Number(BigInt(f.timestamp)) * 1000).toISOString(), durationMs: Date.now() - started });
      return done(report);
    }

    let cursor = BigInt(cur.last_block);
    const width = bucketSeconds();
    report.cursorBefore = Number(cursor);
    const span = BigInt(Math.max(1, opts.rangeBlocks ?? DEFAULT_RANGE));
    let lastTime: string | null = null;
    while (cursor < fin) {
      if (opts.deadline()) {
        report.status = "partial";
        report.errors.push(`budget expired at block ${cursor + 1n}`);
        break;
      }
      const t0 = Date.now();
      const from = cursor + 1n;
      const to = from + span - 1n < fin ? from + span - 1n : fin;
      const logs = await getLogsAdaptive(url, { address: [contract], topics: [TRANSFER_TOPIC] }, from, to);
      report.logs += logs.length;

      // Headers: the parent (fork check) and the range end; then only the few
      // headers needed to place each log block in its time bucket.
      const [parent, end] = await nodeRpcBatch<Block | null>(url, [cursor, to].map((n) => ({ method: "eth_getBlockByNumber", params: [hex(n), false] })));
      if (!parent || !end) throw new Error(`node did not return header ${!parent ? cursor : to}`);
      const own = new Map<bigint, number>();
      for (const l of logs) {
        const t = usableTimestamp(l.blockTimestamp);
        if (t && l.blockNumber) own.set(BigInt(l.blockNumber), Number(BigInt(t)));
      }
      const placed = await resolveBuckets(url, { n: cursor, ts: Number(BigInt(parent.timestamp)), hash: parent.hash }, { n: to, ts: Number(BigInt(end.timestamp)), hash: end.hash }, logs, width, own);
      if (placed.mismatch) {
        await issue(chain, assetId, "provider_disagreement", Number(placed.mismatch.block), `log block hash ${placed.mismatch.log.slice(0, 18)} differs from the header ${placed.mismatch.header.slice(0, 18)} at finalized block ${placed.mismatch.block}`);
        throw new Error(`inconsistent finalized block ${placed.mismatch.block} from the node`);
      }
      const agg = bucketize(logs, contract, (n) => placed.bucket.get(BigInt(n))!, width);
      if (agg.duplicates > 0) await issue(chain, assetId, "duplicate_event", Number(to), `${agg.duplicates} duplicate (tx, logIndex) in blocks ${from}..${to}; counted once`);
      if (agg.malformed > 0) report.errors.push(`${agg.malformed} malformed log(s) skipped in ${from}..${to}`);

      const supply = await supplyAt(url, contract, to);
      if (secondary) {
        const [h2, s2] = await Promise.all([nodeRpc<Block>(secondary, "eth_getBlockByNumber", [hex(to), false]), supplyAt(secondary, contract, to)]);
        if (h2.hash.toLowerCase() !== end.hash.toLowerCase() || (supply !== null && s2 !== null && s2 !== supply)) {
          await issue(chain, assetId, "provider_disagreement", Number(to), `secondary provider: hash ${h2.hash.slice(0, 18)} vs ${end.hash.slice(0, 18)}; supply ${s2} vs ${supply}`);
          throw new Error(`providers disagree at block ${to}`);
        }
      }

      const toTime = new Date(Number(BigInt(end.timestamp)) * 1000).toISOString();
      const r = await sbRpc<{ ok: boolean; reason?: string; reconciled?: boolean | null }>("onchain_asset_commit", {
        p_chain: chain,
        p_asset: assetId,
        p_chain_id: chainId,
        p_expected: Number(cursor),
        p_from: Number(from),
        p_to: Number(to),
        p_parent_hash: parent.hash.toLowerCase(),
        p_to_hash: end.hash.toLowerCase(),
        p_to_time: toTime,
        p_totals: agg.totals,
        p_buckets: agg.rows,
        p_supply_raw: supply === null ? null : supply.toString(),
        p_decimals: decimals,
        p_provider: secondary ? "node_rpc+secondary" : "node_rpc",
        p_duration_ms: Date.now() - t0,
      });
      if (!r.ok) {
        if (r.reason === "stale_cursor") {
          // Another worker committed this range. Not an error: resume from the store.
          report.status = "partial";
          report.errors.push("another worker advanced the cursor; resuming next pass");
          break;
        }
        if (r.reason === "parent_hash_mismatch") indexerEvent("indexer_reorg_detected", { indexer: "asset", chain, asset: assetId, block: Number(cursor) });
        throw new Error(`commit refused: ${r.reason}`);
      }
      report.commits++;
      if (r.reconciled !== null && r.reconciled !== undefined) report.reconciled = report.reconciled === false ? false : r.reconciled;
      if (r.reconciled === false) report.errors.push(`supply did not reconcile at block ${to}`);
      indexerEvent("block_indexed", { indexer: "asset", chain, asset: assetId, from: Number(from), to: Number(to), logs: logs.length, transfers: agg.totals.transfers, mints: agg.totals.mints, burns: agg.totals.burns, reconciled: r.reconciled ?? null, ms: Date.now() - t0 });
      indexerEvent("indexer_checkpoint_saved", { indexer: "asset", chain, asset: assetId, block: Number(to) });
      cursor = to;
      lastTime = toTime;
    }
    report.cursorAfter = Number(cursor);
    if (report.status === "ok" && report.commits === 0) report.status = "caught_up";
    await touch(chain, assetId, true, { head, finalized: fin, indexed: Number(cursor), indexedTime: lastTime, durationMs: Date.now() - started, detail: { lastPassCommits: report.commits, secondary: Boolean(secondary) } });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 200);
    report.status = "failed";
    report.errors.push(msg);
    indexerEvent("indexer_error", { indexer: "asset", chain, asset: assetId, error: msg });
    await touch(chain, assetId, false, { head, finalized: fin, error: msg, durationMs: Date.now() - started });
  }
  return done(report);
}

/** Solana: supply only (no network-wide transfer enumeration without Geyser). */
export async function snapshotSolanaSupply(assetId: AssetId = "usdc"): Promise<AssetScanReport> {
  const started = Date.now();
  const report: AssetScanReport = { chain: "solana", asset: assetId, status: "ok", head: null, finalized: null, cursorBefore: null, cursorAfter: null, commits: 0, logs: 0, reconciled: null, durationMs: 0, errors: [] };
  const mint = getAsset(assetId)?.deployments.solana;
  const url = solanaRpc();
  if (!mint || !url || supabaseBackend !== "supabase") return { ...report, status: "not_configured", reason: !mint ? "no Solana mint" : !url ? "No RPC URL for solana." : "No durable store (SUPABASE_URL).", durationMs: Date.now() - started };
  try {
    const [last] = await sbSelect<{ block_time: string }>("onchain_supply_snapshots", `select=block_time&chain=eq.solana&asset=eq.${encodeURIComponent(assetId)}&order=block.desc&limit=1`);
    if (last && Date.now() - Date.parse(last.block_time) < SOLANA_SNAPSHOT_EVERY_MS) return { ...report, status: "caught_up", durationMs: Date.now() - started };
    const slot = await nodeRpc<number>(url, "getSlot", [{ commitment: "finalized" }]);
    const [s, t] = await Promise.all([nodeRpc<{ context: { slot: number }; value: { amount: string; decimals: number } }>(url, "getTokenSupply", [mint, { commitment: "finalized" }]), nodeRpc<number | null>(url, "getBlockTime", [slot])]);
    if (!/^\d+$/.test(s.value.amount) || !t) throw new Error("supply or block time missing");
    const at = s.context?.slot ?? slot;
    await sbInsertIgnoreDuplicates("onchain_supply_snapshots", { chain: "solana", asset: assetId, block: at, block_time: new Date(t * 1000).toISOString(), supply_raw: s.value.amount, decimals: s.value.decimals, commitment: "finalized", provider: "node_rpc" });
    report.finalized = slot;
    report.cursorAfter = at;
    indexerEvent("solana_slot_indexed", { indexer: "asset", chain: "solana", asset: assetId, slot: at, supplyRaw: s.value.amount });
    await sbRpc("onchain_indexer_touch", { p_indexer: "asset", p_chain: "solana", p_asset: assetId, p_ok: true, p_head: null, p_head_time: null, p_finalized: slot, p_indexed: at, p_indexed_time: new Date(t * 1000).toISOString(), p_error: null, p_duration_ms: Date.now() - started, p_detail: { mode: "supply_only" } }).catch(() => {});
  } catch (e) {
    report.status = "failed";
    report.errors.push((e as Error).message.slice(0, 200));
    indexerEvent("indexer_error", { indexer: "asset", chain: "solana", asset: assetId, error: report.errors[0] });
    await sbRpc("onchain_indexer_touch", { p_indexer: "asset", p_chain: "solana", p_asset: assetId, p_ok: false, p_head: null, p_head_time: null, p_finalized: null, p_indexed: null, p_indexed_time: null, p_error: report.errors[0], p_duration_ms: Date.now() - started, p_detail: {} }).catch(() => {});
  }
  return { ...report, durationMs: Date.now() - started };
}

/**
 * Every indexed asset on every chain the operator opted in to node indexing
 * (ONCHAIN_NODE_CHAINS — one list for wallet and asset indexing), or only `only`.
 */
export async function scanAssets(opts: { deadline: () => boolean; only?: string[]; rangeBlocks?: number }): Promise<AssetScanReport[]> {
  const out: AssetScanReport[] = [];
  for (const chain of nodeChains()) {
    if (opts.only && !opts.only.includes(chain)) continue;
    if (opts.deadline()) break;
    if (chain === "solana") {
      for (const { asset } of indexedAssetsOn("solana")) out.push(await snapshotSolanaSupply(asset.id));
      continue;
    }
    for (const { asset } of indexedAssetsOn(chain)) out.push(await scanAsset(chain, asset.id, opts));
  }
  return out;
}
