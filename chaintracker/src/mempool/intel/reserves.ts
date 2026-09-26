// The reserve watchlist and the drain detector.
//
// This is the highest-value detector in the system and the one that justifies
// the rest of it. The reasoning, from a real incident:
//
// On 2026-09-06 the Liquid Federation's Bitcoin reserve lost 3,996 of roughly
// 4,200 BTC through a peg-out bug in Elements. The mainnet transaction is
// 8db751a6...b140 — 4,019.44 BTC, 83 inputs into 13 outputs, 1.02 sat/vB.
// Judged on size alone that transaction is remarkable but not unique; Bitcoin
// sees multi-thousand-BTC exchange movements regularly and they are routine.
// What made it an incident is the RATIO: 95% of one custodian's holdings left
// at once. That ratio is only computable if the address was being watched
// before it happened, which is the whole point of this file.
//
// What this buys, stated precisely: detection at broadcast, about a day before
// the incident reached the public datasets. NOT prediction. The mint that
// created the unbacked L-BTC happened on the Liquid sidechain 35 minutes
// earlier and is invisible from Bitcoin mainnet.
//
// The list lives in data/watchlist.json and is re-read every tick, so entries
// can be added to a running watcher.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../../config/env.js";
import { makeLogger } from "../../util/logger.js";
import type { TxFeatures } from "./features.js";
import type { RawTx } from "./features.js";

const log = makeLogger("btc-reserves");

export interface WatchedAddress {
  address: string;
  label: string;
  category: string | null;
  note: string | null;
  source: string | null;
  /** Alert once this share of the tracked balance leaves at once. */
  alertFraction: number;
}

export interface Watchlist {
  reserves: WatchedAddress[];
  flagged: WatchedAddress[];
  watch: WatchedAddress[];
  loadedAt: number;
  path: string | null;
  error: string | null;
}

const EMPTY: Watchlist = {
  reserves: [], flagged: [], watch: [], loadedAt: 0, path: null, error: null,
};

let cache: Watchlist = EMPTY;
let cacheMtime = 0;

/**
 * Load the watchlist, re-reading only when the file has changed.
 *
 * A parse failure KEEPS THE PREVIOUS LIST rather than emptying it. An empty
 * watchlist silently disables every detector built on it, and a detector that
 * finds nothing because it was never armed is indistinguishable from one that
 * found nothing because the chain was quiet — which is exactly the failure
 * this system exists to avoid.
 */
export function loadWatchlist(path?: string): Watchlist {
  const file = path ?? resolve(ROOT, "data", "watchlist.json");
  if (!existsSync(file)) {
    if (cache.path !== null || cache.loadedAt === 0) {
      log.info("no watchlist — reserve and flagged-address detection are OFF", { expected: file });
      cache = { ...EMPTY, loadedAt: Date.now(), path: null };
    }
    return cache;
  }
  let mtime = 0;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return cache;
  }
  if (mtime === cacheMtime && cache.path === file) return cache;

  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const next: Watchlist = {
      reserves: parseList(raw.reserves, 0.1),
      flagged: parseList(raw.flagged, 0),
      watch: parseList(raw.watch, 0),
      loadedAt: Date.now(),
      path: file,
      error: null,
    };
    cache = next;
    cacheMtime = mtime;
    log.info("watchlist loaded", {
      reserves: next.reserves.length,
      flagged: next.flagged.length,
      watch: next.watch.length,
    });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    log.error("watchlist unreadable — KEEPING the previous list", { err: msg });
    cache = { ...cache, error: msg };
  }
  return cache;
}

function parseList(v: unknown, defaultFraction: number): WatchedAddress[] {
  if (!Array.isArray(v)) return [];
  const out: WatchedAddress[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const address = typeof r.address === "string" ? r.address.trim() : "";
    // Length check only: Bitcoin has four address formats and a strict
    // validator here would silently drop a future one. A wrong address simply
    // never matches, which is a harmless failure.
    if (address.length < 20) continue;
    out.push({
      address,
      label: typeof r.label === "string" && r.label ? r.label : address.slice(0, 12),
      category: typeof r.category === "string" ? r.category : null,
      note: typeof r.note === "string" ? r.note : null,
      source: typeof r.source === "string" ? r.source : null,
      alertFraction:
        typeof r.alertFraction === "number" && r.alertFraction > 0 && r.alertFraction <= 1
          ? r.alertFraction
          : defaultFraction,
    });
  }
  return out;
}

/** Index of every watched address, for O(1) lookup during a block walk. */
export function indexWatchlist(w: Watchlist): Map<string, { entry: WatchedAddress; kind: "reserve" | "flagged" | "watch" }> {
  const m = new Map<string, { entry: WatchedAddress; kind: "reserve" | "flagged" | "watch" }>();
  for (const e of w.watch) m.set(e.address, { entry: e, kind: "watch" });
  for (const e of w.reserves) m.set(e.address, { entry: e, kind: "reserve" });
  // Flagged last: it is the most serious classification and must win a tie.
  for (const e of w.flagged) m.set(e.address, { entry: e, kind: "flagged" });
  return m;
}

export interface DrainFinding {
  entry: WatchedAddress;
  /** Satoshis spent FROM the watched address by this transaction. */
  spentSats: number;
  /** The address's balance immediately before, in satoshis. */
  balanceBefore: number;
  fractionOfBalance: number;
}

/**
 * How much this transaction takes out of a watched reserve.
 *
 * `balanceOf` supplies the address's balance before the spend. It is passed in
 * rather than fetched here so the caller controls the request budget, and so
 * this function stays pure and testable.
 *
 * Only INPUTS count. An address receiving funds is not being drained, and
 * counting outputs would make every deposit look like a withdrawal.
 */
export function detectDrain(
  tx: RawTx,
  index: Map<string, { entry: WatchedAddress; kind: string }>,
  balanceOf: (address: string) => number | null,
): DrainFinding[] {
  const spentBy = new Map<string, number>();
  for (const i of tx.vin) {
    if (i.is_coinbase) continue;
    const addr = i.prevout?.scriptpubkey_address;
    if (!addr) continue;
    const hit = index.get(addr);
    if (!hit || hit.kind !== "reserve") continue;
    spentBy.set(addr, (spentBy.get(addr) ?? 0) + (Number(i.prevout?.value) || 0));
  }

  const out: DrainFinding[] = [];
  for (const [addr, spentSats] of spentBy) {
    const entry = index.get(addr)!.entry;
    const balanceNow = balanceOf(addr);
    if (balanceNow === null) continue;
    // The balance read back is AFTER the spend when the transaction has
    // confirmed, so the pre-spend balance is what remains plus what left.
    // Getting this backwards would report a 95% drain as a 100% one — or, on a
    // near-total drain, divide by something close to zero.
    const balanceBefore = balanceNow + spentSats;
    if (balanceBefore <= 0) continue;
    const fractionOfBalance = spentSats / balanceBefore;
    if (fractionOfBalance < entry.alertFraction) continue;
    out.push({ entry, spentSats, balanceBefore, fractionOfBalance });
  }
  return out.sort((a, b) => b.fractionOfBalance - a.fractionOfBalance);
}

/** Any watched address appearing anywhere on the transaction. */
export function matchFlagged(
  f: TxFeatures,
  tx: RawTx,
  index: Map<string, { entry: WatchedAddress; kind: string }>,
): { entry: WatchedAddress; side: "input" | "output" } | null {
  for (const i of tx.vin) {
    const a = i.prevout?.scriptpubkey_address;
    const hit = a ? index.get(a) : undefined;
    if (hit && hit.kind === "flagged") return { entry: hit.entry, side: "input" };
  }
  for (const o of tx.vout) {
    const a = o.scriptpubkey_address;
    const hit = a ? index.get(a) : undefined;
    if (hit && hit.kind === "flagged") return { entry: hit.entry, side: "output" };
  }
  void f;
  return null;
}
