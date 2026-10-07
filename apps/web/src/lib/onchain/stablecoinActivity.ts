// ---------------------------------------------------------------------------
// Global stablecoin transfer activity from Allium's stablecoins.metrics.
// volume_daily (via the saved Explorer queries in lib/onchain/allium.ts).
// PURE: no I/O.
//
// Two rules, learned from the data itself (Allium aggregates daily with a
// lag — on 2026-10-07 the latest complete day was 2026-10-05):
//
//  1. LATEST DAY = the most recent day with any transactions. A day the
//     warehouse has not aggregated yet is absent or zero, and is not "a day
//     with no stablecoin activity". If the query ran less than 24 h after
//     that day ended, the day is flagged PROVISIONAL (it may still be filling in) —
//     flagged, never hidden or guessed at.
//
//  2. CHANGE is measured against the AVERAGE of the up-to-7 complete days
//     before the latest day, not against the previous day alone (a single day
//     is noisy: weekends dip). No change is reported without at least one
//     prior day.
//
// sender_count / recipient_count are DISTINCT per (chain, day, token) row;
// summed across rows they count an address once per chain and token it used.
// They are reported as such ("sender count, summed"), never as unique wallets.
// ---------------------------------------------------------------------------

export interface DailyRow {
  day: string;
  tx_count: number;
  transfer_count: number;
  volume_usd: number;
  sender_count: number;
  recipient_count: number;
}
export interface ChainRow {
  chain: string;
  volume_usd_latest_day: number;
  volume_usd_prior_7d_avg: number;
  tx_count_latest_day?: number | null;
}

export interface Day {
  day: string;
  txCount: number;
  transferCount: number;
  volumeUsd: number;
  senderCount: number;
  recipientCount: number;
  avgTransferUsd: number | null;
}
export interface StablecoinActivity {
  days: Day[]; // oldest first; days with no transactions dropped
  latest: Day | null;
  latestProvisional: boolean;
  prior7dAvg: { volumeUsd: number; txCount: number; transferCount: number; days: number } | null;
  change: { volumeUsd: number | null; txCount: number | null; avgTransferUsd: number | null };
  windowTotals: { volumeUsd: number; txCount: number; days: number };
}
export interface ChainActivity {
  chain: string;
  volumeUsd: number;
  prior7dAvgUsd: number;
  change: number | null;
  txCount: number | null;
  share: number;
}

const DAY_MS = 86_400_000;
const rel = (cur: number, base: number | null | undefined): number | null => (base && base > 0 ? (cur - base) / base : null);

export function summarizeActivity(rows: DailyRow[], queriedAt: string | null): StablecoinActivity {
  const byDay = new Map<string, Day>();
  for (const r of rows) {
    const day = r.day.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const d = byDay.get(day) ?? { day, txCount: 0, transferCount: 0, volumeUsd: 0, senderCount: 0, recipientCount: 0, avgTransferUsd: null };
    // A saved query may return per-chain rows; summing makes the contract hold either way.
    d.txCount += r.tx_count;
    d.transferCount += r.transfer_count;
    d.volumeUsd += r.volume_usd;
    d.senderCount += r.sender_count;
    d.recipientCount += r.recipient_count;
    byDay.set(day, d);
  }
  const days = [...byDay.values()]
    .filter((d) => d.txCount > 0)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => ({ ...d, avgTransferUsd: d.transferCount > 0 ? d.volumeUsd / d.transferCount : null }));

  const latest = days.at(-1) ?? null;
  const prior = latest ? days.filter((d) => d.day < latest.day).slice(-7) : [];
  const avg = (f: (d: Day) => number) => prior.reduce((a, d) => a + f(d), 0) / prior.length;
  const prior7dAvg = prior.length ? { volumeUsd: avg((d) => d.volumeUsd), txCount: avg((d) => d.txCount), transferCount: avg((d) => d.transferCount), days: prior.length } : null;
  const priorAvgTransfer = prior7dAvg && prior7dAvg.transferCount > 0 ? prior7dAvg.volumeUsd / prior7dAvg.transferCount : null;

  const ran = queriedAt ? Date.parse(queriedAt) : NaN;
  const latestProvisional = Boolean(latest && Number.isFinite(ran) && ran - Date.parse(`${latest.day}T00:00:00Z`) < 2 * DAY_MS);

  const week = days.slice(-7);
  return {
    days,
    latest,
    latestProvisional,
    prior7dAvg,
    change: {
      volumeUsd: latest ? rel(latest.volumeUsd, prior7dAvg?.volumeUsd) : null,
      txCount: latest ? rel(latest.txCount, prior7dAvg?.txCount) : null,
      avgTransferUsd: latest && latest.avgTransferUsd !== null ? rel(latest.avgTransferUsd, priorAvgTransfer) : null,
    },
    windowTotals: { volumeUsd: week.reduce((a, d) => a + d.volumeUsd, 0), txCount: week.reduce((a, d) => a + d.txCount, 0), days: week.length },
  };
}

export function summarizeChains(rows: ChainRow[]): ChainActivity[] {
  const total = rows.reduce((a, r) => a + r.volume_usd_latest_day, 0);
  return rows
    .filter((r) => r.volume_usd_latest_day > 0 || r.volume_usd_prior_7d_avg > 0)
    .map((r) => ({
      chain: r.chain,
      volumeUsd: r.volume_usd_latest_day,
      prior7dAvgUsd: r.volume_usd_prior_7d_avg,
      change: rel(r.volume_usd_latest_day, r.volume_usd_prior_7d_avg),
      txCount: r.tx_count_latest_day ?? null,
      share: total > 0 ? r.volume_usd_latest_day / total : 0,
    }))
    .sort((a, b) => b.volumeUsd - a.volumeUsd);
}
