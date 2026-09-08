import { getDb } from "@/lib/db";
import { track } from "@/lib/analytics";
import { captureException } from "@/lib/observability";
import { getBalance, type ChainSlug } from "@/lib/evm/rpc";
import { flagEnabled } from "@/lib/flags";
import type { ChainId } from "@/lib/swap/assets";
import { chainSlugFor, listCustomTokens } from "./customTokens";
import { readErc20Balance } from "./erc20Metadata";

// ---------------------------------------------------------------------------
// Finding what an address already holds.
//
// WHAT THIS IS AND IS NOT. It is a DISPLAY CACHE — "you appear to hold these
// assets on these chains", refreshed on demand. It is not a ledger and nothing
// spends from it. That distinction is why `discovered_assets` rows are safe to
// keep in an unencrypted SQLite file and why a stale row is a cosmetic problem
// rather than a financial one.
//
// THE HARD PART IS FAILURE, NOT SUCCESS. A sweep touches several chains and
// every token on each, over a proxy with a rate limit, from a phone on mobile
// data. Partial failure is the NORMAL case, not the exception, and the design
// follows from that:
//
//   - Every read is independent. One chain being down must not blank the
//     portfolio for the three that answered.
//   - A failed read leaves the PREVIOUS row in place rather than deleting it.
//     Deleting on failure makes a flaky connection look like assets vanishing,
//     which is the single most alarming thing a wallet can do.
//   - A zero balance DOES delete the row, because zero is an answer.
//   - `failures` is reported, not hidden. A screen that says "3 of 4 networks
//     checked" is honest; one that silently shows three is not.
//
// CONCURRENCY IS BOUNDED. The RPC proxy allows 120 requests/minute per user
// (apps/web/src/app/api/chain/rpc/route.ts). Firing every read at once on a
// list of forty tokens would exhaust that budget in one sweep and 429 the
// signer flow that actually needs it, so reads run in small batches.
// ---------------------------------------------------------------------------

/** Chains swept for a native balance, in the order results are reported. */
const NATIVE_CHAINS: Array<{ chain: ChainId; slug: ChainSlug; symbol: string }> = [
  { chain: "ethereum", slug: "ethereum", symbol: "ETH" },
  { chain: "arbitrum", slug: "arbitrum", symbol: "ETH" },
  { chain: "base", slug: "base", symbol: "ETH" },
  { chain: "polygon", slug: "polygon", symbol: "POL" },
];

/**
 * Reads in flight at once.
 *
 * Six is a compromise measured against the proxy's 120/min: a sweep of four
 * chains plus twenty tokens is 24 reads, which at six-wide is four round trips
 * and well inside the budget even if the user refreshes repeatedly.
 */
const CONCURRENCY = 6;

export interface DiscoveredAsset {
  id: string;
  chain: ChainId;
  /** Null for the chain's native asset. */
  address: string | null;
  symbol: string;
  decimals: number;
  rawBalance: bigint;
  discoveredAt: number;
}

export interface DiscoveryResult {
  assets: DiscoveredAsset[];
  /** Reads that failed. Surfaced to the UI — never swallowed. */
  failures: Array<{ chain: ChainId; symbol: string; reason: string }>;
  scannedChains: number;
  durationMs: number;
}

interface Row {
  id: string;
  chain: string;
  address: string | null;
  symbol: string;
  decimals: number;
  raw_balance: string;
  discovered_at: number;
}

function toAsset(r: Row): DiscoveredAsset {
  return {
    id: r.id,
    chain: r.chain as ChainId,
    address: r.address,
    symbol: r.symbol,
    decimals: r.decimals,
    // Stored as TEXT and parsed as bigint. A balance in wei exceeds 2^53 and a
    // REAL column would round it — silently, and only for large holdings.
    rawBalance: safeBigInt(r.raw_balance),
    discoveredAt: r.discovered_at,
  };
}

function safeBigInt(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

/** The last sweep's results, straight from cache. Renders instantly at launch. */
export function cachedAssets(chain?: ChainId): DiscoveredAsset[] {
  const rows = chain
    ? getDb().getAllSync<Row>("SELECT * FROM discovered_assets WHERE chain = ?", chain)
    : getDb().getAllSync<Row>("SELECT * FROM discovered_assets");
  return rows.map(toAsset);
}

function upsert(asset: DiscoveredAsset): void {
  getDb().runSync(
    `INSERT OR REPLACE INTO discovered_assets
       (id, chain, address, symbol, decimals, raw_balance, usd_value, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    asset.id,
    asset.chain,
    asset.address,
    asset.symbol,
    asset.decimals,
    asset.rawBalance.toString(),
    asset.discoveredAt,
  );
}

function remove(id: string): void {
  getDb().runSync("DELETE FROM discovered_assets WHERE id = ?", id);
}

/** Run `tasks` at most `limit` at a time, settling all of them. */
async function pooled<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Sweep every supported chain for native and token balances.
 *
 * `address` is the wallet being scanned. Returns what was found AND what could
 * not be checked; the caller renders both.
 */
export async function discoverAssets(address: string): Promise<DiscoveryResult> {
  const started = Date.now();

  if (!flagEnabled("asset_discovery")) {
    return { assets: cachedAssets(), failures: [], scannedChains: 0, durationMs: 0 };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("Cannot scan an invalid address.");
  }

  const failures: DiscoveryResult["failures"] = [];
  const found: DiscoveredAsset[] = [];

  type Task = { id: string; chain: ChainId; address: string | null; symbol: string; decimals: number; run: () => Promise<bigint | null> };

  const tasks: Task[] = [
    ...NATIVE_CHAINS.map((c) => ({
      id: `native:${c.chain}`,
      chain: c.chain,
      address: null,
      symbol: c.symbol,
      decimals: 18,
      run: () => getBalance(c.slug, address),
    })),
    ...listCustomTokens().flatMap((token) => {
      const slug = chainSlugFor(token.chain);
      if (!slug) return [];
      return [
        {
          id: token.id,
          chain: token.chain,
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
          run: () => readErc20Balance(slug, token.address, address),
        },
      ];
    }),
  ];

  const settled = await pooled(
    tasks.map((t) => async () => ({ task: t, balance: await t.run() })),
    CONCURRENCY,
  );

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const task = tasks[i];

    if (outcome.status === "rejected") {
      // The PREVIOUS row is left alone. Deleting here would make a flaky
      // connection look like assets disappearing.
      failures.push({ chain: task.chain, symbol: task.symbol, reason: describeError(outcome.reason) });
      continue;
    }

    const balance = outcome.value.balance;
    if (balance === null) {
      // readErc20Balance returns null for an unreadable balance, which is not
      // the same as zero and must not delete the row either.
      failures.push({ chain: task.chain, symbol: task.symbol, reason: "The balance could not be read." });
      continue;
    }

    if (balance === 0n) {
      // Zero IS an answer, so the row goes. Keeping it would leave a portfolio
      // full of assets the user has spent.
      remove(task.id);
      continue;
    }

    const asset: DiscoveredAsset = {
      id: task.id,
      chain: task.chain,
      address: task.address,
      symbol: task.symbol,
      decimals: task.decimals,
      rawBalance: balance,
      discoveredAt: Date.now(),
    };
    upsert(asset);
    found.push(asset);
  }

  const durationMs = Date.now() - started;
  track("asset_discovery_run", {
    chains: NATIVE_CHAINS.length,
    found: found.length,
    durationMs,
    failures: failures.length,
  });

  return { assets: found, failures, scannedChains: NATIVE_CHAINS.length, durationMs };
}

function describeError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  captureException(reason, { scope: "discovery.unknownError" });
  return "The network could not be reached.";
}

export { pooled as __pooledForTest };
