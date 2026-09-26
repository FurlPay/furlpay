// The threat feed: published exploits, and sanctioned-address screening.
//
// Two independent sources, both keyless, both verified answering on 2026-09-08:
//
//   api.llama.fi/hacks  — 200, 342KB, 1,257 incidents, newest dated the day
//                         before. Fields: date, name, classification,
//                         technique, amount, chain[], bridgeHack, targetType,
//                         source, returnedFunds. This is a curated record of
//                         *published* incidents, so it is authoritative about
//                         what has been reported and says nothing about what
//                         has not. The embeds word it that way.
//
//   the OFAC sanctioned digital-currency address list — 200, 532 Bitcoin
//                         addresses. Held locally so screening a block costs
//                         zero extra requests.
//
// Neither source is a real-time exploit detector, and this module does not
// pretend otherwise. An incident appears here when someone published it. The
// only thing here that observes the chain directly is the sanctions screen.

import { hacks, sanctions } from "../db/mempool.js";
import type { HackIncident } from "./types.js";
import { makeLogger } from "../util/logger.js";
import { HttpError, withRetry, withTimeout } from "../util/resilience.js";

const log = makeLogger("threats");

export const HACKS_URL = "https://api.llama.fi/hacks";

/**
 * The OFAC-sanctioned Bitcoin address list.
 *
 * Sourced from 0xB10C's published mirror, which tracks the Treasury SDN list.
 * It is a mirror, not the Treasury itself, and the alert wording says
 * "OFAC-listed per <source>" rather than asserting a legal determination.
 */
export const OFAC_XBT_URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.json";

/** The upstream record, exactly as the feed publishes it. */
interface RawHack {
  date: number;
  name: string;
  classification?: string | null;
  technique?: string | null;
  amount?: number | null;
  chain?: string[] | null;
  bridgeHack?: boolean;
  targetType?: string | null;
  source?: string | null;
  returnedFunds?: number | null;
}

async function getJson<T>(url: string, timeoutMs = 30_000): Promise<T> {
  return withRetry(
    async () => {
      const res = await withTimeout(fetch(url, { headers: { accept: "application/json" } }), timeoutMs, url);
      if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ""), url);
      return (await res.json()) as T;
    },
    { attempts: 3, baseMs: 800 },
  );
}

/* ------------------------------------------------------------------ */
/* Incidents                                                           */
/* ------------------------------------------------------------------ */

export interface HackRefresh {
  fetched: number;
  /** Incidents never recorded before. These are what get alerted. */
  fresh: HackIncident[];
  /** True on the very first run, when every incident is technically "new". */
  seeded: boolean;
  error: string | null;
}

/**
 * Pull the incident feed and record it.
 *
 * The first run SEEDS: 1,257 historical incidents are not 1,257 alerts, so on
 * an empty table everything is stored and nothing is queued. After that, only a
 * key the store has never seen is new. The feed republishes its whole history
 * on every fetch and revises loss figures on old entries, so identity has to
 * come from the record (name + date) and never from position or arrival.
 */
export async function refreshHacks(opts: { maxAgeDays?: number } = {}): Promise<HackRefresh> {
  const seeded = hacks.size() === 0;
  let raw: RawHack[];
  try {
    raw = await getJson<RawHack[]>(HACKS_URL);
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    log.error("hack feed unavailable", { err: msg });
    return { fetched: 0, fresh: [], seeded, error: msg };
  }
  if (!Array.isArray(raw)) {
    return { fetched: 0, fresh: [], seeded, error: "hack feed did not return an array" };
  }

  // A "new" incident dated years ago is a late backfill of history, not news.
  // Alerting on it would be wrong; storing it is still right.
  const maxAgeMs = (opts.maxAgeDays ?? 30) * 86_400_000;
  const now = Date.now();
  const fresh: HackIncident[] = [];

  for (const r of raw) {
    if (!r || typeof r.name !== "string" || !Number.isFinite(r.date)) continue;
    const ts = r.date * 1000;
    const incident: HackIncident = {
      key: incidentKey(r.name, r.date),
      name: r.name,
      ts,
      amountUsd: Number.isFinite(r.amount as number) ? (r.amount as number) : null,
      classification: r.classification ?? null,
      technique: r.technique ?? null,
      chains: Array.isArray(r.chain) ? r.chain.map(String) : [],
      targetType: r.targetType ?? null,
      bridgeHack: Boolean(r.bridgeHack),
      returnedFunds: Number.isFinite(r.returnedFunds as number) ? (r.returnedFunds as number) : null,
      sourceUrl: r.source && r.source.trim() ? r.source.trim() : null,
      firstSeen: now,
    };
    const { isNew } = hacks.insert(incident);
    if (isNew && !seeded && now - ts <= maxAgeMs) fresh.push(incident);
  }

  fresh.sort((a, b) => (b.amountUsd ?? 0) - (a.amountUsd ?? 0));
  log.info("hack feed refreshed", {
    fetched: raw.length,
    fresh: fresh.length,
    seeded: seeded || undefined,
  });
  return { fetched: raw.length, fresh, seeded, error: null };
}

/** The dataset's own identity for an incident: its name and the day it is dated. */
export function incidentKey(name: string, dateSec: number): string {
  return `${name.trim().toLowerCase()}|${dateSec}`;
}

/* ------------------------------------------------------------------ */
/* Sanctions                                                           */
/* ------------------------------------------------------------------ */

export interface SanctionsRefresh {
  count: number;
  /** Age of the stored list when the fetch failed and the cache was kept. */
  staleMs: number | null;
  error: string | null;
}

/**
 * Refresh the sanctioned-address list, keeping the stored copy on failure.
 *
 * Falling back to the cache matters: an empty set silently disables screening,
 * and a screen that finds nothing because it was never armed looks exactly like
 * a screen that found nothing because the chain was clean. The caller is told
 * how old the cache is so the board can say so.
 */
export async function refreshSanctions(): Promise<SanctionsRefresh> {
  try {
    const list = await getJson<string[]>(OFAC_XBT_URL);
    if (!Array.isArray(list) || !list.length) {
      throw new Error("sanctions list was empty — refusing to clear the stored copy");
    }
    const n = sanctions.replace("XBT", list.filter((a) => typeof a === "string" && a.length > 20));
    log.info("sanctions list refreshed", { addresses: n });
    return { count: n, staleMs: null, error: null };
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    const stored = sanctions.all("XBT");
    const at = sanctions.fetchedAt("XBT");
    log.warn("sanctions refresh failed — keeping stored list", {
      err: msg,
      stored: stored.length,
      ageHours: at ? Math.round((Date.now() - at) / 3_600_000) : null,
    });
    return { count: stored.length, staleMs: at ? Date.now() - at : null, error: msg };
  }
}

/** The screening set. Empty means screening is OFF, and callers must say so. */
export function sanctionedSet(): Set<string> {
  return new Set(sanctions.all("XBT"));
}
