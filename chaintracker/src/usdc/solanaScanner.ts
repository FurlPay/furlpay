// Solana native-USDC scanner.
//
// HONEST SCOPE, stated first because it shapes everything the daily report may
// claim. Solana coverage here is TRACKED-ADDRESS coverage, not a firehose. A
// complete SPL transfer stream needs Geyser or a paid webhook tier; what is
// free and reliable is per-address transaction history. So this adapter watches a
// known set of addresses — labelled exchange wallets and any FurlPay wallet — and
// reports what moves through them.
//
// That produces genuine exchange-flow and FurlPay-wallet intelligence, which is
// most of what the channel is for. It does NOT discover an unknown Solana whale,
// and the daily report must not imply otherwise. `coverageNote()` exists so the
// caller can say this out loud rather than leaving it to be inferred.
//
// This is the opposite trade-off from the EVM scanner, which reads every native
// USDC transfer chain-wide. The asymmetry is a property of what the two chains'
// free tiers actually offer, not a design preference, and pretending the two are
// equivalent would be the dishonest part.

import { helius } from "../providers/index.js";
import { env } from "../config/env.js";
import { usdcDb } from "../db/usdc.js";
import { makeLogger } from "../util/logger.js";
import { getUsdcAsset, isNativeUsdc } from "./registry.js";
import { buildTransfer, isUsableTimestamp, usdValue } from "./scanner.js";
import { knownAddressesForChain, loadFurlPayTrackedWallets } from "./entities.js";
import { recordScanRun } from "./scanRuns.js";
import { cursors } from "../db/index.js";
import type { UsdcTransfer } from "./types.js";

const log = makeLogger("usdc:solana");

export const SOLANA_SCANNER = "usdc-solana";

/** Transactions pulled per address per tick. */
const SIGNATURES_PER_ADDRESS = 25;

/**
 * Addresses checked per tick.
 *
 * Helius's free tier documents 10 RPS and the provider self-limits to 6. Each
 * address costs a signature fetch plus a parse, so a wide watchlist would spend
 * the whole tick budget on Solana alone and starve twelve EVM chains.
 */
const MAX_ADDRESSES_PER_TICK = 6;

/**
 * Round-robin position, PERSISTED.
 *
 * THE BUG THIS FIXES. This was a module-level `let rotation = 0`, and the comment
 * claimed every address would be reached over successive ticks. In this
 * architecture it never was: `run-usdc.cmd` starts a fresh process for every
 * scheduled tick, so the variable was reinitialised to 0 each time and only the
 * first MAX_ADDRESSES_PER_TICK addresses were ever scanned. Anything past the cap
 * was invisible forever, and the comment asserted the opposite.
 *
 * It happens to be harmless today — the watchlist is exactly 6 long and the cap is
 * 6 — which is precisely why it would have gone unnoticed until somebody added a
 * FurlPay Solana wallet and its movements silently never appeared.
 *
 * The position now lives in `scan_cursors.last_block` under the Solana scanner
 * key, which already exists and survives restart like every other checkpoint.
 */
function loadRotation(): number {
  const c = cursors.get("solana", SOLANA_SCANNER);
  const n = c.lastBlock ?? 0;
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function saveRotation(next: number): void {
  cursors.set("solana", SOLANA_SCANNER, next, null);
}

export interface SolanaScanResult {
  addressesChecked: number;
  transfersFound: number;
  rowsNew: number;
  dropped: { notNativeUsdc: number; unusable: number };
  error: string | null;
}

/**
 * The addresses this adapter watches: the labelled Solana entities plus every
 * configured FurlPay Solana wallet.
 *
 * FurlPay wallets come first in the returned order because a user's own money
 * moving matters more than an exchange rebalance, and the per-tick cap means
 * order decides what actually gets read.
 */
export function watchedAddresses(): string[] {
  const furlpay = loadFurlPayTrackedWallets()
    .filter((w) => w.chainSlug === "solana")
    .map((w) => w.address);
  // The rest are the labelled Solana addresses from the entity seed. Deriving
  // them rather than keeping a parallel list means an address can never be
  // watched without also being nameable in an alert.
  const labelled = knownAddressesForChain("solana");
  // De-duplicated while preserving priority order.
  return [...new Set([...furlpay, ...labelled])];
}

/**
 * What this adapter can and cannot see, in one sentence, for the report.
 *
 * Returned as data rather than logged so the daily embed can print it. A caveat
 * that only appears in a log file is a caveat nobody reads.
 */
export function coverageNote(): string {
  const n = watchedAddresses().length;
  if (n <= MAX_ADDRESSES_PER_TICK) {
    return `Solana: ${n} tracked addresses each tick (exchange + FurlPay wallets), not chain-wide`;
  }
  // Say the rotation out loud once the list outgrows a tick, because "N tracked
  // addresses" would otherwise imply all N were read every time.
  const ticks = Math.ceil(n / MAX_ADDRESSES_PER_TICK);
  return (
    `Solana: ${n} tracked addresses, ${MAX_ADDRESSES_PER_TICK} per tick ` +
    `(full pass every ${ticks} ticks), not chain-wide`
  );
}

/**
 * Scan the watchlist for native USDC movement.
 *
 * Every row goes through the same `buildTransfer` as the EVM path, so entity
 * resolution and classification cannot drift between chains.
 */
export async function scanSolanaUsdc(): Promise<SolanaScanResult> {
  const startedAt = Date.now();
  const result: SolanaScanResult = {
    addressesChecked: 0,
    transfersFound: 0,
    rowsNew: 0,
    dropped: { notNativeUsdc: 0, unusable: 0 },
    error: null,
  };

  const asset = getUsdcAsset("solana");
  if (!asset) {
    result.error = "solana is not in the USDC registry";
    return result;
  }

  // The parsed-transaction API is Helius-only: without a key the provider
  // returns an empty array rather than throwing, which would make an unkeyed
  // setup look like a scanned chain with no activity. Say so instead.
  if (!env.heliusKey) {
    result.error = "HELIUS_API_KEY is not set — Solana USDC cannot be read";
    return result;
  }

  const all = watchedAddresses();
  if (all.length === 0) {
    // Nothing configured is not a failure, but it must not look like "scanned,
    // found nothing" either.
    result.error = "no Solana addresses to watch — add FurlPay Solana wallets or seed entities";
    return result;
  }

  // Rotate through the watchlist so a list longer than the per-tick cap is fully
  // covered over several ticks instead of the tail never being read. The position
  // is persisted, because each tick is a separate process.
  const rotation = loadRotation() % all.length;
  const slice: string[] = [];
  for (let i = 0; i < Math.min(MAX_ADDRESSES_PER_TICK, all.length); i++) {
    slice.push(all[(rotation + i) % all.length]!);
  }
  saveRotation((rotation + slice.length) % all.length);

  for (const address of slice) {
    result.addressesChecked += 1;
    let txs: Awaited<ReturnType<typeof helius.addressTransactions>>;
    try {
      txs = await helius.addressTransactions(address, { limit: SIGNATURES_PER_ADDRESS });
    } catch (err) {
      result.error = (result.error ? result.error + "; " : "") + `${short(address)}: ${(err as Error).message.slice(0, 80)}`;
      continue;
    }

    for (const tx of txs ?? []) {
      for (let idx = 0; idx < (tx.tokenTransfers?.length ?? 0); idx++) {
        const leg = tx.tokenTransfers[idx]!;

        // The mint gate. Solana has many tokens whose metadata says "USDC";
        // exactly one is Circle's. Compared case-sensitively because base58 is.
        if (!isNativeUsdc("solana", leg.mint)) {
          result.dropped.notNativeUsdc += 1;
          continue;
        }

        const amountUsd = usdValue(leg.amount);
        if (amountUsd === null || !leg.from || !leg.to) {
          result.dropped.unusable += 1;
          continue;
        }

        result.transfersFound += 1;

        const built: UsdcTransfer = buildTransfer(asset, {
          txHash: tx.signature,
          // A Solana transaction has no log index, but the UNIQUE constraint is
          // (chain, tx, log_index) — so a transaction moving USDC twice needs two
          // distinct indices or the second leg would be silently dropped as a
          // duplicate. The position within tokenTransfers is stable for a given
          // parsed transaction, which is what makes it usable as one.
          logIndex: idx,
          blockNumber: tx.slot,
          // ALREADY MILLISECONDS. HeliusProvider.normalise() multiplies the API's
          // seconds by 1000 before handing a SolTransfer back, so multiplying again
          // here dated every Solana row to the year 58713 — caught by querying
          // MAX(ts) after a real scan, not by any type error.
          timestamp: tx.timestamp > 0 ? tx.timestamp : 0,
          from: leg.from,
          to: leg.to,
          amount: leg.amount,
          amountUsd,
          source: "helius",
        });

        // The same rule the EVM path uses — see isUsableTimestamp, which exists
        // because a seconds/milliseconds mix-up here dated every Solana row to the
        // year 58713 and nothing objected.
        if (!isUsableTimestamp(built.timestamp)) {
          result.dropped.unusable += 1;
          continue;
        }

        if (usdcDb.insert(built)) result.rowsNew += 1;
      }
    }
  }

  recordScanRun({
    chainSlug: "solana",
    scanner: SOLANA_SCANNER,
    fromBlock: null,
    toBlock: null,
    logsSeen: result.transfersFound,
    rowsNew: result.rowsNew,
    dropped: result.dropped.notNativeUsdc + result.dropped.unusable,
    droppedDetail:
      [
        result.dropped.notNativeUsdc ? `not-native-usdc=${result.dropped.notNativeUsdc}` : "",
        result.dropped.unusable ? `unusable=${result.dropped.unusable}` : "",
      ]
        .filter(Boolean)
        .join(" ") || null,
    endpoint: "helius",
    error: result.error,
    startedAt,
    finishedAt: Date.now(),
  });

  if (result.rowsNew || result.error) {
    log.info("solana scan", {
      addresses: result.addressesChecked,
      found: result.transfersFound,
      new: result.rowsNew,
      err: result.error ?? undefined,
    });
  }
  return result;
}

function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
