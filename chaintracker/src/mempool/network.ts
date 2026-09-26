// Bitcoin network state: congestion, fee pressure, difficulty, hashrate, price.
//
// Every field is fetched independently and every one of them is allowed to be
// null. A host that serves Esplora but not /v1 gives us the mempool backlog and
// the tip but no recommended fee, and the right answer then is a blank fee band
// with a stated reason — not a fee invented from the backlog, and not a whole
// snapshot thrown away because one endpoint was missing.

import type { BitcoinClient } from "./client.js";
import type { NetworkSnapshot } from "./types.js";
import { makeLogger } from "../util/logger.js";

const log = makeLogger("btc-network");

interface MempoolStats {
  count: number;
  vsize: number;
  total_fee: number;
  fee_histogram: Array<[number, number]>;
}

interface RecommendedFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

interface ProjectedBlock {
  blockSize: number;
  blockVSize: number;
  nTx: number;
  totalFees: number;
  medianFee: number;
  feeRange: number[];
}

interface DifficultyAdjustment {
  progressPercent: number;
  difficultyChange: number;
  estimatedRetargetDate: number;
  remainingBlocks: number;
  remainingTime: number;
}

interface HashrateSeries {
  hashrates: Array<{ timestamp: number; avgHashrate: number }>;
  currentHashrate?: number;
  currentDifficulty?: number;
}

/**
 * Read everything at once. Failures are logged and become nulls; the caller
 * gets a snapshot describing what was actually readable at this instant.
 */
export async function readNetwork(client: BitcoinClient): Promise<NetworkSnapshot> {
  const sources = new Set<string>();
  const ts = Date.now();

  const note = (host: string) => {
    sources.add(host);
  };
  const attempt = async <T>(what: string, fn: () => Promise<{ data: T; host: string }>): Promise<T | null> => {
    try {
      const { data, host } = await fn();
      note(host);
      return data;
    } catch (err) {
      log.warn("network field unavailable", {
        field: what,
        err: (err as Error).message.slice(0, 160),
      });
      return null;
    }
  };

  // Esplora first: these are the fields every host can serve, so a snapshot is
  // never entirely empty just because the /v1 hosts are unreachable.
  const [tipRaw, pool] = await Promise.all([
    attempt("tip", () => client.fetchText("esplora", "/blocks/tip/height")),
    attempt<MempoolStats>("mempool", () => client.fetchJson<MempoolStats>("esplora", "/mempool")),
  ]);

  const [fees, projected, diff, hash, price] = await Promise.all([
    attempt<RecommendedFees>("fees", () => client.fetchJson<RecommendedFees>("v1", "/v1/fees/recommended")),
    attempt<ProjectedBlock[]>("projected", () => client.fetchJson<ProjectedBlock[]>("v1", "/v1/fees/mempool-blocks")),
    attempt<DifficultyAdjustment>("difficulty", () => client.fetchJson<DifficultyAdjustment>("v1", "/v1/difficulty-adjustment")),
    attempt<HashrateSeries>("hashrate", () => client.fetchJson<HashrateSeries>("v1", "/v1/mining/hashrate/3d")),
    attempt<Record<string, number>>("price", () => client.fetchJson<Record<string, number>>("v1", "/v1/prices")),
  ]);

  const tipHeight = tipRaw !== null && /^\d+$/.test(tipRaw) ? Number(tipRaw) : null;

  return {
    ts,
    tipHeight,
    mempoolCount: pool?.count ?? null,
    mempoolVsize: pool?.vsize ?? null,
    mempoolTotalFee: pool?.total_fee ?? null,
    fees: {
      fastest: fees?.fastestFee ?? null,
      halfHour: fees?.halfHourFee ?? null,
      hour: fees?.hourFee ?? null,
      economy: fees?.economyFee ?? null,
      minimum: fees?.minimumFee ?? null,
    },
    projectedBlocks: projected?.length ?? null,
    difficultyChangePct: diff?.difficultyChange ?? null,
    difficultyProgressPct: diff?.progressPercent ?? null,
    retargetEta: diff?.estimatedRetargetDate ?? null,
    hashrate: latestHashrate(hash),
    priceUsd: typeof price?.USD === "number" ? price.USD : null,
    sources: [...sources],
  };
}

/**
 * The most recent point of the hashrate series.
 *
 * `currentHashrate` is preferred when the host sends it, but the field is not
 * present on every instance, so the series tail is the fallback. Averaging the
 * series would be wrong — it spans three days and the question is "now".
 */
function latestHashrate(h: HashrateSeries | null): number | null {
  if (!h) return null;
  if (typeof h.currentHashrate === "number" && Number.isFinite(h.currentHashrate)) {
    return h.currentHashrate;
  }
  const series = Array.isArray(h.hashrates) ? h.hashrates : [];
  if (!series.length) return null;
  const last = series.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  return Number.isFinite(last.avgHashrate) ? last.avgHashrate : null;
}

/**
 * How congested the mempool is, as a band rather than a raw number.
 *
 * The thresholds are on the backlog in *virtual bytes*, converted to how many
 * blocks deep it is — one block holds ~1,000,000 vbytes. That is a property of
 * the protocol, not a tuning knob, so the bands mean the same thing on any day.
 */
export type Congestion = "clear" | "normal" | "busy" | "congested" | "backlogged";

export function congestionOf(vsize: number | null): { band: Congestion; blocksDeep: number } | null {
  if (vsize === null || !Number.isFinite(vsize)) return null;
  const blocksDeep = vsize / 1_000_000;
  const band: Congestion =
    blocksDeep < 1 ? "clear"
    : blocksDeep < 4 ? "normal"
    : blocksDeep < 12 ? "busy"
    : blocksDeep < 40 ? "congested"
    : "backlogged";
  return { band, blocksDeep };
}

/** Human sentence for a congestion band, with the measurement that produced it. */
export function congestionLabel(c: { band: Congestion; blocksDeep: number }): string {
  const depth = c.blocksDeep < 1 ? "under one block" : `${c.blocksDeep.toFixed(1)} blocks`;
  return `${c.band} · backlog is ${depth} deep`;
}

/** Hashes per second → "915.0 EH/s". */
export function hashrateStr(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return "N/A";
  const units = [
    { v: 1e21, s: "ZH/s" },
    { v: 1e18, s: "EH/s" },
    { v: 1e15, s: "PH/s" },
    { v: 1e12, s: "TH/s" },
  ];
  for (const u of units) {
    if (h >= u.v) return `${(h / u.v).toFixed(1)} ${u.s}`;
  }
  return `${h.toExponential(2)} H/s`;
}
