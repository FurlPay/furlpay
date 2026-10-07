import { sbSelect, supabaseBackend } from "@/lib/supabase";
import type { UsdcChain } from "./usdcNetwork";

// ---------------------------------------------------------------------------
// Per-chain state for the USDC panel, from two independent observations:
//   live     the node read just now (lib/onchain/usdcNetwork.ts)
//   indexer  what the stored index has committed (onchain_indexer_status,
//            onchain_asset_commits, onchain_integrity_issues — migration 0034)
//
//   NOT_CONFIGURED  no RPC URL for the chain
//   UNAVAILABLE     the node could not be read now (reason shown)
//   DEGRADED        readable, but: head stale, indexer failing, not indexed,
//                   or an open integrity issue
//   INDEXING        healthy and catching up (finalized data behind > 10 min)
//   LIVE            healthy and indexed up to the node's finalized block
// ---------------------------------------------------------------------------

export type ChainState = "LIVE" | "INDEXING" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";

export interface IndexerRow {
  indexer: "asset" | "wallet";
  chain: string;
  asset: string;
  head_block: number | string | null;
  head_time: string | null;
  finalized_block: number | string | null;
  indexed_block: number | string | null;
  indexed_time: string | null;
  last_ok_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  last_duration_ms: number | null;
  detail: Record<string, unknown> | null;
}
export interface IssueRow {
  chain: string;
  asset: string;
  kind: string;
  block: number | string | null;
  detail: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
}
export interface CommitRow {
  chain: string;
  to_block: number | string;
  to_time: string;
  reconciled: boolean | null;
  duration_ms: number | null;
  committed_at: string;
}

export interface ChainHealth {
  state: ChainState;
  reasons: string[];
  /** Newest finalized block committed to the network index (EVM) / last processed slot (Solana wallet indexer). */
  indexedBlock: number | null;
  indexedAt: string | null;
  /** Head block (live) minus indexed block. */
  lagBlocks: number | null;
  /** Seconds between the head's time and the indexed block's time. */
  lagSeconds: number | null;
  /** Time to read + commit the newest range. */
  blockProcessingMs: number | null;
  lastCommitAt: string | null;
  supplyReconciled: boolean | null;
  indexerError: string | null;
  issues: IssueRow[];
  wallet: { indexedSlot: number | null; wallets: number | null; tokenAccounts: number | null; lagSlots: number | null; lastOkAt: string | null; error: string | null } | null;
}

/** Problems that make a chain's numbers questionable until an operator looks. */
const SERIOUS = new Set(["block_gap", "checkpoint_regression", "reorg_inconsistency", "negative_supply", "impossible_value", "supply_mismatch", "provider_disagreement"]);
const INDEXING_LAG_S = 600;
const STALE_HEAD_S = 120;

const n = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const after = (a: string | null, b: string | null) => Boolean(a && (!b || Date.parse(a) > Date.parse(b)));

/** Pure. */
export function chainHealth(live: UsdcChain, store: { asset: IndexerRow | null; wallet: IndexerRow | null; commit: CommitRow | null; issues: IssueRow[]; available: boolean; reason: string | null }): ChainHealth {
  const reasons: string[] = [];
  const a = store.asset;
  const indexedBlock = n(a?.indexed_block);
  const headTime = live.headAgeSeconds !== null ? Date.now() - live.headAgeSeconds * 1000 : a?.head_time ? Date.parse(a.head_time) : null;
  const lagSeconds = a?.indexed_time && headTime !== null ? Math.max(0, Math.round((headTime - Date.parse(a.indexed_time)) / 1000)) : null;
  const lagBlocks = indexedBlock !== null && live.latestBlock !== null ? Math.max(0, live.latestBlock - indexedBlock) : null;
  const w = store.wallet;
  const wallet = w
    ? {
        indexedSlot: n(w.indexed_block),
        wallets: typeof w.detail?.wallets === "number" ? (w.detail.wallets as number) : null,
        tokenAccounts: typeof w.detail?.tokenAccounts === "number" ? (w.detail.tokenAccounts as number) : null,
        lagSlots: n(w.indexed_block) !== null && live.latestBlock !== null ? Math.max(0, live.latestBlock - n(w.indexed_block)!) : null,
        lastOkAt: w.last_ok_at,
        error: after(w.last_error_at, w.last_ok_at) ? w.last_error : null,
      }
    : null;
  const base = {
    indexedBlock,
    indexedAt: a?.indexed_time ?? null,
    lagBlocks,
    lagSeconds,
    blockProcessingMs: store.commit?.duration_ms ?? null,
    lastCommitAt: store.commit?.committed_at ?? null,
    supplyReconciled: store.commit?.reconciled ?? null,
    indexerError: a && after(a.last_error_at, a.last_ok_at) ? a.last_error : null,
    issues: store.issues,
    wallet,
  };
  if (live.status === "not_configured") return { ...base, state: "NOT_CONFIGURED", reasons: [live.reason ?? "Not configured."] };
  if (live.status === "unavailable") return { ...base, state: "UNAVAILABLE", reasons: [live.reason ?? "Node unavailable."] };

  if (live.headAgeSeconds !== null && live.headAgeSeconds > STALE_HEAD_S) reasons.push(`Node head is ${live.headAgeSeconds}s old.`);
  const serious = store.issues.filter((i) => SERIOUS.has(i.kind));
  if (serious.length) reasons.push(`${serious.length} open integrity issue${serious.length === 1 ? "" : "s"}: ${[...new Set(serious.map((i) => i.kind))].join(", ")}.`);
  if (live.chain === "solana") {
    // Solana has no network index (needs Geyser); its index is the wallet indexer.
    if (!store.available) reasons.push(store.reason ?? "Index store unavailable.");
    else if (!wallet) reasons.push("Tracked-wallet indexer has not run: live supply and slots only (add solana to ONCHAIN_NODE_CHAINS and run the tail worker).");
    else if (wallet.error) reasons.push(`Wallet indexer failing: ${wallet.error}`);
  } else if (!store.available) {
    reasons.push(store.reason ?? "Network index unavailable.");
  } else if (!a) {
    reasons.push("Not indexed: live node reads only (add the chain to ONCHAIN_NODE_CHAINS and run the tail worker).");
  } else if (base.indexerError) {
    reasons.push(`Indexer failing: ${base.indexerError}`);
  }
  if (reasons.length) return { ...base, state: "DEGRADED", reasons };
  if (live.chain !== "solana" && lagSeconds !== null && a?.finalized_block !== null && indexedBlock !== null && indexedBlock < n(a!.finalized_block)! && lagSeconds > INDEXING_LAG_S) {
    return { ...base, state: "INDEXING", reasons: [`Catching up: ${lagBlocks} blocks behind the head.`] };
  }
  return { ...base, state: "LIVE", reasons: [] };
}

const missing = (e: unknown) => /does not exist|PGRST205|Could not find the table|42P01|PGRST202|Could not find the function/i.test((e as Error).message);

/** Reads the stored index state for `asset`. Never throws; says why when unavailable. */
export async function readIndexState(asset: string, chains: string[]) {
  if (supabaseBackend !== "supabase") return { available: false, reason: "No durable store configured (SUPABASE_URL): history and indexer health are not stored.", status: [] as IndexerRow[], issues: [] as IssueRow[], commits: new Map<string, CommitRow>() };
  try {
    const [status, issues, ...commits] = await Promise.all([
      sbSelect<IndexerRow>("onchain_indexer_status", "select=*&limit=200"),
      sbSelect<IssueRow>("onchain_integrity_issues", `select=chain,asset,kind,block,detail,occurrences,first_seen,last_seen&resolved_at=is.null&order=last_seen.desc&limit=50`),
      ...chains.map((c) => sbSelect<CommitRow>("onchain_asset_commits", `select=chain,to_block,to_time,reconciled,duration_ms,committed_at&chain=eq.${encodeURIComponent(c)}&asset=eq.${encodeURIComponent(asset)}&order=to_block.desc&limit=1`)),
    ]);
    const byChain = new Map<string, CommitRow>();
    commits.forEach((rows) => rows[0] && byChain.set(rows[0].chain, rows[0]));
    return { available: true, reason: null, status, issues, commits: byChain };
  } catch (e) {
    return { available: false, reason: missing(e) ? "Network index tables are not migrated yet (apply migration 0034)." : `Index store unreachable: ${(e as Error).message.slice(0, 120)}`, status: [] as IndexerRow[], issues: [] as IssueRow[], commits: new Map<string, CommitRow>() };
  }
}
