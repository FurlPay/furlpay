// ---------------------------------------------------------------------------
// Canonical market-data events.
//
// THE FACT THAT SHAPES THIS ENTIRE SUBSYSTEM, measured against our own keys on
// 2026-08-22 rather than assumed:
//
//     GET /v2/stocks/snapshots?feed=iex  → 200
//     GET /v2/stocks/snapshots?feed=sip  → 403
//                "subscription does not permit querying recent SIP data"
//
// We are on Alpaca's Basic entitlement, which is the IEX feed. IEX is one
// venue, not the consolidated tape. Measured the same day against consolidated
// volume:
//
//     AAPL  1,017,701 / 42,216,056  =  2.41%
//     NVDA  3,206,855 / 91,591,112  =  3.50%
//     TSLA  1,136,445 / 57,808,372  =  1.97%
//     MSFT    437,111 / 21,856,586  =  2.00%
//     SPY   1,272,336 / 38,583,716  =  3.30%
//
// Two consequences, and the second is the one that decides a product question:
//
//   PRICE      An IEX print is a real trade at a real price. Using it for last
//              price and percent change is sound, with the caveat that it can
//              differ from the consolidated last sale.
//
//   VOLUME     IEX volume is NOT market volume. And the share is not constant —
//              it ranges 1.97% to 3.50% across five symbols on one day — so it
//              cannot be scaled by a factor either. Ranking "Most Active" by it
//              answers "which stock traded most ON IEX", which is a different
//              question wearing the same label. `volumeSource` below exists so
//              that no ranking can quietly forget which one it is holding.
//
// Nothing here upgrades a delayed or partial feed into a consolidated one. The
// abstraction exists so a SIP entitlement can be dropped in without the
// ranking engine changing, not to disguise the absence of one.
// ---------------------------------------------------------------------------

/** Which feed a value came from. Carried on the value, never inferred later. */
export type FeedSource = "iex" | "sip" | "yahoo" | "seed";

/** How much of the market a source observes. */
export const FEED_COVERAGE: Record<FeedSource, "consolidated" | "single-venue" | "delayed" | "none"> = {
  sip: "consolidated",
  iex: "single-venue",
  yahoo: "delayed",
  seed: "none",
};

export type MarketEvent = TradeEvent | QuoteEvent | StatusEvent;

interface EventBase {
  symbol: string;
  /** When the VENUE produced it. The only timestamp freshness may be judged
   *  on — our receive time says how fast our network is, not how fresh the
   *  data is. Null when the provider does not state one, which makes the
   *  event unusable for a freshness decision. */
  exchangeTimestamp: number | null;
  /** When this process received it. Used for latency telemetry only. */
  receivedAt: number;
  source: FeedSource;
  /** Provider sequence, where one exists. Absent on feeds that do not number
   *  their messages — the ordering guard then falls back to timestamps. */
  sequence?: number;
}

export interface TradeEvent extends EventBase {
  type: "trade";
  price: number;
  size: number;
  /** Venue-assigned execution id, where present. The dedupe key: two prints of
   *  the same size at the same price in the same millisecond are two real
   *  trades, and only this tells them apart. */
  tradeId?: string | number;
  /** Sale conditions. Some conditions do not update last price or do not count
   *  toward volume — see `TRADE_EXCLUDED_CONDITIONS`. */
  conditions?: string[];
}

export interface QuoteEvent extends EventBase {
  type: "quote";
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
}

export type MarketStatus =
  | "pre_market"
  | "regular"
  | "after_hours"
  | "closed"
  | "halted"
  | "auction";

export interface StatusEvent extends EventBase {
  type: "status";
  status: MarketStatus;
  /** Provider's reason code for a halt, passed through unaltered. */
  reason?: string;
}

/**
 * Sale conditions that must NOT update the last price.
 *
 * From the CTA/UTP condition dictionaries: a trade reported late, out of
 * sequence, or executed at a price unrelated to the current market (a
 * derivatively priced trade, a form-T extended-hours print reported into the
 * regular session) is a real trade that is nonetheless the wrong number to
 * headline. Letting one set the last price is how a ticker briefly shows a
 * figure nobody could have traded at.
 *
 * Conservative on purpose: an unrecognised condition does NOT exclude the
 * trade. Excluding on a code we do not understand would silently drop real
 * prints, which is the worse error.
 */
export const PRICE_EXCLUDED_CONDITIONS: ReadonlySet<string> = new Set([
  "B", // average price trade
  "W", // average price trade
  "L", // sold last (late report)
  "Z", // sold (out of sequence)
  "U", // extended hours sold out of sequence
  "T", // form T — extended hours
  "M", // market centre official close
  "Q", // market centre official open
  "4", // derivatively priced
]);

/** Conditions that do not contribute to consolidated volume. */
export const VOLUME_EXCLUDED_CONDITIONS: ReadonlySet<string> = new Set(["B", "W", "M", "Q"]);

export function updatesLastPrice(conditions: string[] | undefined): boolean {
  if (!conditions?.length) return true;
  return !conditions.some((c) => PRICE_EXCLUDED_CONDITIONS.has(c));
}

export function countsTowardVolume(conditions: string[] | undefined): boolean {
  if (!conditions?.length) return true;
  return !conditions.some((c) => VOLUME_EXCLUDED_CONDITIONS.has(c));
}

/**
 * How current a symbol's data is.
 *
 * `unknown` is not a synonym for stale. It means we have no basis to judge —
 * no exchange timestamp — and a ranking must exclude it rather than guess in
 * either direction.
 */
export type Freshness = "live" | "degraded" | "stale" | "unknown";

/** Thresholds, in milliseconds, in one place rather than scattered as literals. */
export interface FreshnessPolicy {
  /** Under this, a symbol is live. */
  liveMs: number;
  /** Between live and this, degraded — shown, but marked. */
  degradedMs: number;
}

/**
 * Defaults.
 *
 * Deliberately generous for a single-venue feed. On IEX a genuinely liquid
 * symbol can go seconds without an IEX print while trading briskly elsewhere,
 * so a one-second staleness cut would mark most of the market stale and be
 * both useless and wrong. These suit what we actually receive; a SIP
 * entitlement would justify tightening them.
 */
export const DEFAULT_FRESHNESS: FreshnessPolicy = {
  liveMs: 15_000,
  degradedMs: 120_000,
};

export function freshnessOf(
  exchangeTimestamp: number | null,
  now: number,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS
): Freshness {
  if (exchangeTimestamp === null) return "unknown";
  const age = now - exchangeTimestamp;
  // A timestamp in the future is a clock problem, not freshness. Treat it as
  // unknown rather than as maximally fresh — the alternative lets a
  // misconfigured clock pin a symbol permanently at the top of a leaderboard.
  if (age < -5_000) return "unknown";
  if (age <= policy.liveMs) return "live";
  if (age <= policy.degradedMs) return "degraded";
  return "stale";
}

/** Why a symbol was excluded from a ranking. Surfaced, never silent. */
export type IneligibleReason =
  | "no_price"
  | "no_previous_close"
  | "non_positive"
  | "stale"
  | "unknown_freshness"
  | "halted"
  | "below_min_price"
  | "below_min_volume"
  | "below_min_dollar_volume";

export interface EligibilityPolicy {
  /** Reject sub-dollar names by default: a $0.02 stock that ticks to $0.03 is
   *  a 50% "gainer" and would own every leaderboard. */
  minPrice: number;
  /** Minimum observed volume on whatever feed supplied it. */
  minVolume: number;
  minDollarVolume: number;
  freshness: FreshnessPolicy;
  /** Whether degraded (not live, not stale) symbols may rank. */
  allowDegraded: boolean;
}

export const DEFAULT_ELIGIBILITY: EligibilityPolicy = {
  minPrice: 1,
  minVolume: 0,
  minDollarVolume: 0,
  freshness: DEFAULT_FRESHNESS,
  allowDegraded: true,
};
