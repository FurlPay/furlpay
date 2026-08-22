// ---------------------------------------------------------------------------
// Price oracle — the price a TRANSACTION is allowed to execute against.
//
// DELIBERATELY NOT lib/markets/quotes.ts. That module answers "what should we
// show a reader", and it is right to be generous: it falls back to seed prices
// so a provider outage degrades a chart rather than blanking a page. Those are
// exactly the wrong semantics for money. A display price may be stale; an
// execution price may not, and the fallback that saves a page is the fallback
// that fills an order at last week's number.
//
// So this module refuses rather than degrades. Every answer is either a price
// with a stated age and source, or a refusal with a reason. There is no third
// outcome and no default.
//
// THE THREE CHECKS, and each one has a real failure behind it:
//
//   FRESHNESS   A quote with no timestamp is UNUSABLE, not "probably current".
//               A provider that stops updating usually keeps serving its last
//               value with an old timestamp — checking the timestamp is the
//               only thing that catches it, and treating a missing one as fresh
//               defeats the check entirely.
//
//   DEVIATION   Two sources that disagree by more than a threshold mean at
//               least one is wrong, and nothing here can tell which. The safe
//               response is to refuse, not to average them — an average of a
//               right price and a wrong one is a wrong price.
//
//   BOUNDS      A sanity range per asset class. This is the check that catches
//               a decimal-shifted feed and a unit mix-up, which are the errors
//               that produce a price wrong by a factor of a thousand while
//               looking perfectly well-formed.
// ---------------------------------------------------------------------------

export type PriceSource = "brokerage" | "coingecko" | "yahoo" | "chainlink" | "pyth";

export interface OraclePrice {
  symbol: string;
  price: number;
  source: PriceSource;
  /** When the VENUE produced this price, not when we fetched it. */
  observedAt: string;
  /** Age in seconds at the moment of evaluation. */
  ageSeconds: number;
  /** Sources that agreed, when more than one was consulted. */
  corroboratedBy: PriceSource[];
}

export type OracleRefusal =
  | { reason: "no_source"; detail: string }
  | { reason: "stale"; detail: string; ageSeconds: number }
  | { reason: "no_timestamp"; detail: string }
  | { reason: "out_of_bounds"; detail: string; price: number }
  | { reason: "deviation"; detail: string; prices: { source: PriceSource; price: number }[] }
  | { reason: "circuit_open"; detail: string };

export type OracleResult = { ok: true; price: OraclePrice } | { ok: false; refusal: OracleRefusal };

export interface OracleCandidate {
  source: PriceSource;
  price: number | null;
  /** ISO timestamp from the venue. Null means the source did not state one —
   *  which is a refusal, never an assumption of freshness. */
  observedAt: string | null;
}

/**
 * Maximum age, per use.
 *
 * A settlement is irreversible and gets the tightest bound. A pre-trade quote
 * is shown to a human who will take seconds to read it. A portfolio mark is a
 * valuation, not an execution, and a minute-old price misvalues a position by
 * an amount nobody trades on.
 */
export const MAX_AGE_SECONDS = {
  settlement: 30,
  quote: 60,
  valuation: 300,
} as const;

export type OracleUse = keyof typeof MAX_AGE_SECONDS;

/**
 * Sanity bounds by asset class.
 *
 * Mirrors the existing `solUsdPrice()` clamp (AGENTS.md rule 8). The bounds are
 * deliberately WIDE — they are not a view on valuation, and a legitimate move
 * must never trip them. They exist to catch a feed that has shifted a decimal
 * or changed units, which produces a number wrong by orders of magnitude.
 */
export const PRICE_BOUNDS: Record<string, { min: number; max: number }> = {
  equity: { min: 0.0001, max: 1_000_000 },
  crypto: { min: 0.00000001, max: 10_000_000 },
  stablecoin: { min: 0.5, max: 2 },
};

/** Fractional disagreement tolerated between two sources. 1% is far above
 *  normal cross-venue spread and far below a decimal error. */
export const MAX_DEVIATION = 0.01;

function ageOf(observedAt: string, now: number): number | null {
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 1000);
}

/**
 * Resolve a price from candidate sources.
 *
 * Candidates are supplied by the caller rather than fetched here, so this
 * module stays pure and fully testable — the interesting logic is the
 * rejection rules, and a test should not need a network to exercise them.
 */
export function resolvePrice(
  symbol: string,
  candidates: OracleCandidate[],
  opts: { use: OracleUse; assetClass: keyof typeof PRICE_BOUNDS; now?: number }
): OracleResult {
  const now = opts.now ?? Date.now();
  const maxAge = MAX_AGE_SECONDS[opts.use];
  const bounds = PRICE_BOUNDS[opts.assetClass];

  const usable: { source: PriceSource; price: number; ageSeconds: number; observedAt: string }[] = [];
  const rejections: OracleRefusal[] = [];

  for (const c of candidates) {
    if (c.price == null || !Number.isFinite(c.price) || c.price <= 0) continue;

    if (!c.observedAt) {
      // The check that people are tempted to skip. A source that goes silent
      // keeps returning its last value; without a timestamp there is no way to
      // notice, so "no timestamp" must be a refusal rather than a shrug.
      rejections.push({
        reason: "no_timestamp",
        detail: `${c.source} returned a price with no observation time; it cannot be shown to be current.`,
      });
      continue;
    }

    const ageSeconds = ageOf(c.observedAt, now);
    if (ageSeconds == null) {
      rejections.push({ reason: "no_timestamp", detail: `${c.source} returned an unparseable timestamp.` });
      continue;
    }
    if (ageSeconds > maxAge) {
      rejections.push({
        reason: "stale",
        detail: `${c.source} is ${Math.round(ageSeconds)}s old; ${opts.use} requires under ${maxAge}s.`,
        ageSeconds,
      });
      continue;
    }
    if (c.price < bounds.min || c.price > bounds.max) {
      rejections.push({
        reason: "out_of_bounds",
        detail: `${c.source} reported ${c.price} for ${symbol}, outside the ${opts.assetClass} sanity range.`,
        price: c.price,
      });
      continue;
    }

    usable.push({ source: c.source, price: c.price, ageSeconds, observedAt: c.observedAt });
  }

  if (usable.length === 0) {
    // Report the most specific refusal available rather than a generic one —
    // "stale" and "out of bounds" call for very different responses.
    return {
      ok: false,
      refusal: rejections[0] ?? {
        reason: "no_source",
        detail: `No usable price source for ${symbol}.`,
      },
    };
  }

  // Deviation. Only meaningful with corroboration; a lone source cannot
  // disagree with anything, and demanding two would make the oracle unusable
  // wherever only one exists.
  if (usable.length > 1) {
    const prices = usable.map((u) => u.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min > 0 && (max - min) / min > MAX_DEVIATION) {
      return {
        ok: false,
        refusal: {
          reason: "deviation",
          detail:
            `Sources disagree by ${(((max - min) / min) * 100).toFixed(2)}% on ${symbol}, ` +
            `above the ${(MAX_DEVIATION * 100).toFixed(0)}% tolerance. At least one is wrong and this cannot tell which.`,
          prices: usable.map((u) => ({ source: u.source, price: u.price })),
        },
      };
    }
  }

  // Freshest wins. Not an average: averaging two sources produces a number no
  // venue ever quoted, and the whole point is to execute against an observed
  // price.
  const best = usable.reduce((a, b) => (a.ageSeconds <= b.ageSeconds ? a : b));

  return {
    ok: true,
    price: {
      symbol,
      price: best.price,
      source: best.source,
      observedAt: best.observedAt,
      ageSeconds: best.ageSeconds,
      corroboratedBy: usable.filter((u) => u.source !== best.source).map((u) => u.source),
    },
  };
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

const breakers = new Map<string, BreakerState>();

/** Consecutive refusals before a symbol's circuit opens. */
const FAILURE_THRESHOLD = 5;
/** How long it stays open before one probe is allowed through. */
const COOLDOWN_MS = 60_000;

/**
 * Is this symbol's circuit open?
 *
 * The breaker exists so a persistently bad feed produces ONE refusal per
 * cooldown instead of hammering an upstream that is already unwell — and so
 * the failure is visible as a single loud state rather than a stream of noise
 * an operator learns to scroll past.
 */
export function circuitOpen(symbol: string, now = Date.now()): boolean {
  const state = breakers.get(symbol);
  if (!state?.openedAt) return false;
  if (now - state.openedAt > COOLDOWN_MS) {
    // Half-open: let one attempt through. A success resets, a failure re-opens.
    state.openedAt = null;
    state.failures = FAILURE_THRESHOLD - 1;
    return false;
  }
  return true;
}

export function recordOracleFailure(symbol: string, now = Date.now()): void {
  const state = breakers.get(symbol) ?? { failures: 0, openedAt: null };
  state.failures++;
  if (state.failures >= FAILURE_THRESHOLD) state.openedAt = now;
  breakers.set(symbol, state);
}

export function recordOracleSuccess(symbol: string): void {
  breakers.delete(symbol);
}

/** Test seam. */
export function __resetBreakers(): void {
  breakers.clear();
}

/**
 * The guarded entry point.
 *
 * Wraps `resolvePrice` in the breaker so a bad symbol stops being retried, and
 * keeps the breaker's bookkeeping in one place rather than at every call site.
 */
export function priceFor(
  symbol: string,
  candidates: OracleCandidate[],
  opts: { use: OracleUse; assetClass: keyof typeof PRICE_BOUNDS; now?: number }
): OracleResult {
  const now = opts.now ?? Date.now();
  if (circuitOpen(symbol, now)) {
    return {
      ok: false,
      refusal: {
        reason: "circuit_open",
        detail: `Price resolution for ${symbol} is suspended after repeated failures. It will be retried shortly.`,
      },
    };
  }

  const result = resolvePrice(symbol, candidates, opts);
  if (result.ok) recordOracleSuccess(symbol);
  else recordOracleFailure(symbol, now);
  return result;
}
