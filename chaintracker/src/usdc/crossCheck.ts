// Provider cross-validation.
//
// THE ASSUMPTION THIS REMOVES. `EvmProvider` takes the first endpoint that answers
// and trusts it completely. That is correct for availability and blind for
// correctness: a provider serving a stale, forked or simply wrong view of a chain is
// indistinguishable from a provider serving the truth, and every downstream figure
// inherits the error silently.
//
// Alchemy is not the source of truth. The chain is, and the closest we can get to it
// without running a node is to ask two independent endpoints the same question.
//
// WHAT IS COMPARED, AND WHY IT IS THE BLOCK HASH. A block hash commits to the whole
// block — its transactions, its receipts, its parent. Two providers agreeing on the
// hash at a height agree about everything in it, so one cheap comparison covers the
// entire contents. Comparing log counts or balances would be weaker and far more
// expensive.
//
// DELIBERATELY A SAMPLE, NOT A GATE. Cross-checking every block would double the RPC
// cost of the whole system to detect something rare, and a disagreement does not
// tell us WHICH provider is wrong — only that one of them is. So this samples,
// records, and raises the operator's attention. It does not silently pick a winner.

import { getDb } from "../db/index.js";
import { evm } from "../providers/index.js";
import { makeLogger } from "../util/logger.js";
import { chainRowFor } from "./scanner.js";
import { confirmationFloor } from "./finality.js";
import type { UsdcAsset } from "./types.js";

const log = makeLogger("usdc:crosscheck");

export interface CrossCheckResult {
  chainSlug: string;
  blockNumber: number | null;
  providerA: string;
  providerB: string;
  hashA: string | null;
  hashB: string | null;
  /** null when the comparison could not be made at all. */
  agree: boolean | null;
  detail: string;
}

/**
 * Compare two endpoints on one block.
 *
 * The block chosen is deliberately BELOW the finality floor. Near the head the two
 * providers may legitimately differ simply because one has seen a block the other has
 * not, which is latency rather than disagreement — comparing there would generate
 * false alarms and teach the operator to ignore the signal.
 */
export async function crossCheckChain(asset: UsdcAsset): Promise<CrossCheckResult> {
  const chain = chainRowFor(asset);
  const endpoints = evm.endpointsFor(chain);

  const out: CrossCheckResult = {
    chainSlug: asset.chainSlug,
    blockNumber: null,
    providerA: endpoints[0]?.host ?? "none",
    providerB: endpoints[1]?.host ?? "none",
    hashA: null,
    hashB: null,
    agree: null,
    detail: "",
  };

  if (endpoints.length < 2) {
    // Honest, and worth saying: a chain with one endpoint cannot be cross-validated
    // at all, so its data rests on a single provider's word.
    out.detail = "only one endpoint configured — no independent view available";
    return out;
  }

  let head: number;
  try {
    head = await evm.blockNumber(chain);
  } catch (err) {
    out.detail = `head unreadable: ${(err as Error).message.slice(0, 60)}`;
    return out;
  }

  // Well behind the head, so latency cannot masquerade as disagreement.
  const target = head - confirmationFloor(asset.chainSlug) - 1;
  if (target <= 0) {
    out.detail = "chain too short to sample below the finality floor";
    return out;
  }
  out.blockNumber = target;

  const [a, b] = await Promise.all([
    evm.hashFromEndpoint(endpoints[0]!.url, target),
    evm.hashFromEndpoint(endpoints[1]!.url, target),
  ]);
  out.hashA = a;
  out.hashB = b;

  if (a === null || b === null) {
    // One side not answering is an availability problem, not a disagreement. Recorded
    // as inconclusive rather than as agreement, because treating silence as assent is
    // how a broken cross-check reports green forever.
    out.detail = `inconclusive — ${a === null ? out.providerA : out.providerB} did not answer`;
    return out;
  }

  out.agree = a.toLowerCase() === b.toLowerCase();
  out.detail = out.agree ? "hashes match" : "HASHES DIFFER";

  store(out);

  if (!out.agree) {
    // Loud, and without naming a winner: a hash mismatch below the finality floor
    // means one provider is serving a view of the chain that is not the chain. Which
    // one cannot be determined from two samples.
    log.error("PROVIDER DISAGREEMENT — one of these endpoints is wrong", {
      chain: asset.chainSlug,
      block: target,
      [out.providerA]: a,
      [out.providerB]: b,
    });
  }

  return out;
}

function store(r: CrossCheckResult): void {
  if (r.blockNumber === null) return;
  getDb()
    .prepare(
      `INSERT INTO usdc_provider_checks (
         chain_slug, block_number, provider_a, hash_a, provider_b, hash_b, agree, checked_at
       ) VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      r.chainSlug,
      r.blockNumber,
      r.providerA,
      r.hashA,
      r.providerB,
      r.hashB,
      r.agree === true ? 1 : 0,
      Date.now()
    );
}

/**
 * Cross-check a rotating subset of chains.
 *
 * Rotation is persisted in the same way the Solana watchlist position is, and for
 * the same reason: every tick is a fresh process, so a module-level counter would
 * reset to zero and only ever check the first chains. Checking every chain every
 * tick would add twenty-four extra calls for a signal that changes rarely.
 */
export async function crossCheckSome(
  assets: readonly UsdcAsset[],
  perTick = 3
): Promise<CrossCheckResult[]> {
  if (assets.length === 0) return [];
  const db = getDb();

  const row = db
    .prepare("SELECT last_block AS pos FROM scan_cursors WHERE chain_slug = ? AND scanner = ?")
    .get("_global", "usdc-crosscheck") as { pos: number | null } | undefined;
  const start = ((row?.pos ?? 0) % assets.length + assets.length) % assets.length;

  const out: CrossCheckResult[] = [];
  for (let i = 0; i < Math.min(perTick, assets.length); i++) {
    out.push(await crossCheckChain(assets[(start + i) % assets.length]!));
  }

  db.prepare(
    `INSERT INTO scan_cursors (chain_slug, scanner, last_block, last_value, updated_at)
     VALUES ('_global','usdc-crosscheck',?,NULL,?)
     ON CONFLICT(chain_slug, scanner) DO UPDATE SET
       last_block = excluded.last_block, updated_at = excluded.updated_at`
  ).run((start + Math.min(perTick, assets.length)) % assets.length, Date.now());

  return out;
}

/** Recent disagreements, for `doctor` and the daily report's caveats. */
export function recentDisagreements(sinceMs: number): Array<{
  chainSlug: string;
  blockNumber: number;
  providerA: string;
  providerB: string;
  checkedAt: number;
}> {
  return getDb()
    .prepare(
      `SELECT chain_slug AS chainSlug, block_number AS blockNumber,
              provider_a AS providerA, provider_b AS providerB, checked_at AS checkedAt
         FROM usdc_provider_checks
        WHERE checked_at >= ? AND agree = 0
        ORDER BY checked_at DESC LIMIT 20`
    )
    .all(sinceMs) as Array<{
    chainSlug: string;
    blockNumber: number;
    providerA: string;
    providerB: string;
    checkedAt: number;
  }>;
}

/** Cross-check coverage: which chains have ever been independently verified. */
export function crossCheckSummary(sinceMs: number): Array<{
  chainSlug: string;
  checks: number;
  disagreements: number;
  lastCheckedAt: number | null;
}> {
  return getDb()
    .prepare(
      `SELECT chain_slug AS chainSlug, COUNT(*) AS checks,
              SUM(CASE WHEN agree = 0 THEN 1 ELSE 0 END) AS disagreements,
              MAX(checked_at) AS lastCheckedAt
         FROM usdc_provider_checks
        WHERE checked_at >= ?
        GROUP BY chain_slug ORDER BY chain_slug`
    )
    .all(sinceMs) as Array<{
    chainSlug: string;
    checks: number;
    disagreements: number;
    lastCheckedAt: number | null;
  }>;
}
