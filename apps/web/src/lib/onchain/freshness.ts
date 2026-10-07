// ---------------------------------------------------------------------------
// One freshness model for every /onchain section. PURE.
//
// A section is labelled by how its UPSTREAM behaves, never by whether the
// page or the SSE connection is open:
//
//   live           event-driven source, healthy: changes reach the page within
//                  seconds of being written (FurlPay ledger, ingested chain
//                  events while the webhook/reconciliation is healthy).
//   updating       polled source inside its refresh cadence (market data every
//                  30 min, treasury balances every 5 min, RWA refresh daily).
//   delayed        source with an inherent publication lag, inside the lag it
//                  is known to have (Allium's daily stablecoin metrics run
//                  ~1-2 days behind; shown as "Delayed", not as live).
//   stale          configured and reachable, but older than its allowance.
//   offline        configured, but the last attempt failed.
//   not_connected  not configured.
// ---------------------------------------------------------------------------

export type Freshness = "live" | "updating" | "delayed" | "stale" | "offline" | "not_connected";

export interface SectionFreshness {
  state: Freshness;
  source: string;
  /** When the data itself is from (block time, snapshot date, fetch time). */
  asOf: string | null;
  /** Human cadence, e.g. "event-driven", "every 30 min", "daily (1-2 day lag)". */
  cadence: string;
  reason?: string;
}

type Kind =
  | { kind: "event"; healthyWithinMs: number } // asOf = last successful ingest/reconcile evidence
  | { kind: "polled"; cadenceMs: number } // asOf = last successful fetch
  | { kind: "lagged"; expectedLagMs: number }; // asOf = newest data point (e.g. latest complete day)

export function classify(input: {
  source: string;
  cadence: string;
  configured: boolean;
  ok: boolean;
  asOf: string | null;
  now: number;
  reason?: string;
} & Kind): SectionFreshness {
  const base = { source: input.source, asOf: input.asOf, cadence: input.cadence };
  if (!input.configured) return { ...base, state: "not_connected", reason: input.reason ?? "Not configured." };
  if (!input.ok) return { ...base, state: "offline", reason: input.reason ?? "Last attempt failed." };
  const at = input.asOf ? Date.parse(input.asOf) : NaN;
  if (!Number.isFinite(at)) return { ...base, state: "stale", reason: input.reason ?? "No data time reported." };
  const age = input.now - at;
  switch (input.kind) {
    case "event":
      return age <= input.healthyWithinMs ? { ...base, state: "live" } : { ...base, state: "stale", reason: `No upstream activity for ${Math.round(age / 3_600_000)}h.` };
    case "polled":
      // Two missed cycles before calling it stale: one late poll is not an outage.
      return age <= 2 * input.cadenceMs ? { ...base, state: "updating" } : { ...base, state: "stale", reason: "Refresh is overdue." };
    case "lagged":
      return age <= input.expectedLagMs ? { ...base, state: "delayed" } : { ...base, state: "stale", reason: "Newest data is older than this source's usual lag." };
  }
}

/** Worst state wins when a section blends sources. */
const RANK: Record<Freshness, number> = { live: 0, updating: 1, delayed: 2, stale: 3, offline: 4, not_connected: 5 };
export function worst(...xs: SectionFreshness[]): SectionFreshness {
  return xs.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
}

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
