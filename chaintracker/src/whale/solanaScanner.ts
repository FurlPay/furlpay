// Solana whale scanner — tracked-address strategy.
//
// Be clear about what this does and does not do. A complete Solana transfer
// firehose requires Geyser or webhook infrastructure that is not on the free
// tier, and pretending otherwise would mean shipping invented coverage. What
// IS free and reliable is per-address history, so this scanner polls a watch
// set and reports genuine movement through it:
//
//   * every labelled Solana address in the wallets table (DEX programs, token
//     programs, staking, plus any label an admin adds),
//   * every address a user has /watch-ed.
//
// The result is real exchange-flow and protocol-flow intelligence, correctly
// scoped. `/whales solana` states the strategy so nobody mistakes it for a
// full-chain scan.

import { cursors, wallets, whales, getDb } from "../db/index.js";
import { helius } from "../providers/index.js";
import { MINT_SYMBOLS, type SolTransfer } from "../providers/helius.js";
import { classifyEvent, minThresholdFor, tierFor } from "./classify.js";
import { valueSync, isStablecoinSymbol } from "./pricing.js";
import { pool } from "../util/resilience.js";
import { makeLogger } from "../util/logger.js";
import type { AddressCategory, ChainRow, WhaleEvent } from "../types/index.js";

const log = makeLogger("whale:sol");

/** Cap the watch set per tick so the free 1M credits/month is not burned. */
const MAX_WATCHED_PER_TICK = 12;
const TX_PER_ADDRESS = 25;

export interface SolScanResult {
  chainSlug: string;
  addressesPolled: number;
  transactionsSeen: number;
  eventsNew: number;
  dropped: { unpriced: number; belowThreshold: number };
  strategy: "tracked-address";
  error: string | null;
}

/** The accounts worth polling, most interesting first. */
function watchSet(limit: number): string[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT address FROM (
      SELECT address, 2 AS pri FROM wallets
        WHERE chain_slug='solana' AND category IN ('cex','exchange','bridge','treasury','foundation')
      UNION
      SELECT value AS address, 1 AS pri FROM watchlists
        WHERE kind='address' AND (chain_slug='solana' OR chain_slug IS NULL)
      UNION
      SELECT address, 0 AS pri FROM wallets
        WHERE chain_slug='solana' AND category IN ('dex','protocol','staking')
    ) ORDER BY pri DESC LIMIT ?
  `).all(limit) as Array<{ address: string }>;
  return rows.map((r) => r.address).filter((a) => a && a.length >= 32);
}

export async function scanSolana(chain: ChainRow): Promise<SolScanResult> {
  const result: SolScanResult = {
    chainSlug: chain.slug,
    addressesPolled: 0,
    transactionsSeen: 0,
    eventsNew: 0,
    dropped: { unpriced: 0, belowThreshold: 0 },
    strategy: "tracked-address",
    error: null,
  };

  if (!helius.configured) {
    result.error =
      "HELIUS_API_KEY not set — Solana whale detection needs the parsed-transaction API";
    return result;
  }

  const watched = watchSet(MAX_WATCHED_PER_TICK);
  if (!watched.length) {
    result.error = "no Solana addresses labelled or watched yet";
    return result;
  }
  result.addressesPolled = watched.length;

  const threshold = minThresholdFor(chain);
  const settled = await pool(watched, 3, async (address) => {
    const cursor = cursors.get(chain.slug, `whale:${address}`);
    const txs = await helius.addressTransactions(address, { limit: TX_PER_ADDRESS });
    if (!txs.length) return { address, events: [] as WhaleEvent[], newest: cursor.lastValue };

    // Stop at the last signature we already processed for this address.
    const seen = cursor.lastValue;
    const fresh: SolTransfer[] = [];
    for (const t of txs) {
      if (seen && t.signature === seen) break;
      fresh.push(t);
    }
    const events: WhaleEvent[] = [];
    for (const t of fresh) {
      events.push(...extractEvents(chain, t, threshold, result));
    }
    return { address, events, newest: txs[0]?.signature ?? seen };
  });

  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    const { address, events, newest } = s.value;
    result.transactionsSeen += events.length;
    for (const e of events) {
      if (whales.insert(e)) {
        result.eventsNew += 1;
        wallets.touch(chain.slug, e.fromAddress, e.timestamp);
        wallets.touch(chain.slug, e.toAddress, e.timestamp);
      }
    }
    if (newest) cursors.set(chain.slug, `whale:${address}`, null, newest);
  }

  if (result.eventsNew) {
    log.info("solana scan", {
      polled: result.addressesPolled,
      new: result.eventsNew,
      unpriced: result.dropped.unpriced,
    });
  }
  return result;
}

function extractEvents(
  chain: ChainRow,
  t: SolTransfer,
  threshold: number,
  result: SolScanResult,
): WhaleEvent[] {
  const out: WhaleEvent[] = [];
  const ts = t.timestamp || Date.now();
  let leg = 0;

  const emit = (
    from: string,
    to: string,
    symbol: string,
    amount: number,
    mint: string | null,
    coingeckoId: string | null,
  ): void => {
    if (!from || !to || !Number.isFinite(amount) || amount <= 0) return;
    const v = valueSync(amount, symbol, coingeckoId);
    if (!v) {
      result.dropped.unpriced += 1;
      return;
    }
    if (v.amountUsd < threshold) {
      result.dropped.belowThreshold += 1;
      return;
    }
    const fromW = wallets.get(chain.slug, from);
    const toW = wallets.get(chain.slug, to);
    const fromCategory: AddressCategory = fromW?.category ?? "unknown";
    const toCategory: AddressCategory = toW?.category ?? "unknown";

    out.push({
      chainSlug: chain.slug,
      txHash: t.signature,
      logIndex: leg++,
      blockNumber: t.slot,
      timestamp: ts,
      tokenSymbol: symbol,
      tokenAddress: mint,
      amount,
      amountUsd: v.amountUsd,
      priceUsd: v.priceUsd,
      fromAddress: from,
      toAddress: to,
      fromLabel: fromW?.label ?? null,
      toLabel: toW?.label ?? null,
      fromCategory,
      toCategory,
      eventType: classifyEvent(fromCategory, toCategory, mint === null, isStablecoinSymbol(symbol)),
      tier: tierFor(v.amountUsd),
      confidence: v.confidence,
      source: "helius",
      explorerUrl: `${chain.explorerUrl.replace(/\/$/, "")}/tx/${t.signature}`,
    });
  };

  for (const n of t.nativeTransfers) {
    emit(n.from, n.to, "SOL", n.lamports / 1e9, null, "solana");
  }
  for (const tk of t.tokenTransfers) {
    const symbol = tk.symbol ?? MINT_SYMBOLS[tk.mint] ?? null;
    // An unknown mint has no trustworthy symbol, so it cannot be priced or
    // named. Counting it as unpriced is the honest outcome.
    if (!symbol) {
      result.dropped.unpriced += 1;
      continue;
    }
    emit(tk.from, tk.to, symbol, tk.amount, tk.mint, mintCoingeckoId(symbol));
  }
  return out;
}

function mintCoingeckoId(symbol: string): string | null {
  const M: Record<string, string> = {
    SOL: "solana",
    USDC: "usd-coin",
    USDT: "tether",
    mSOL: "msol",
    jitoSOL: "jito-staked-sol",
    BONK: "bonk",
    JUP: "jupiter-exchange-solana",
  };
  return M[symbol] ?? null;
}

export { MAX_WATCHED_PER_TICK };
