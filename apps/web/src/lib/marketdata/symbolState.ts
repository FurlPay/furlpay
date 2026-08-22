// ---------------------------------------------------------------------------
// Per-symbol state, and the guards that keep it correct under a real feed.
//
// A market feed is not a well-behaved stream. It duplicates on reconnect,
// reorders across venues, drops messages, and reports trades late that
// executed earlier. None of that raises an error — it silently corrupts state,
// and the corruption looks exactly like market movement. Every guard below
// exists because the ungarded version produces a plausible wrong number.
//
// THE FOUR GUARDS:
//
//   DEDUPE      A reconnect replays. Applying a trade twice double-counts its
//               volume. Keyed on the venue's own trade id where present,
//               because two prints of the same size at the same price in the
//               same millisecond are two real trades and nothing else
//               distinguishes them.
//
//   ORDERING    A late print describes an earlier moment. It may not move the
//               last price backwards in time — but it MUST still count toward
//               volume, because it was a real execution. Those two facts pull
//               in opposite directions and are handled separately.
//
//   SEQUENCE    A gap means messages were lost. The state is then incomplete
//               and says so (`sequenceGap`), rather than continuing as though
//               it were whole. Volume in particular is under-counted after a
//               gap and can never be recovered from the stream alone.
//
//   CONDITIONS  Not every print sets the last price. An average-price trade or
//               a late report is a real trade at a price nobody could deal at
//               now. See types.ts.
//
// MEMORY-FIRST. This is the hot path — thousands of symbols, many events per
// second each. It is a plain object mutated in place, with no allocation per
// event and no database write. Persistence is a separate, slower concern.
// ---------------------------------------------------------------------------

import {
  countsTowardVolume,
  freshnessOf,
  updatesLastPrice,
  type FeedSource,
  type Freshness,
  type FreshnessPolicy,
  type MarketEvent,
  type MarketStatus,
  DEFAULT_FRESHNESS,
} from "./types";

export interface SymbolState {
  symbol: string;

  /** Yesterday's official close. The denominator of every percent change, and
   *  the one field a stream does not supply — it is hydrated from a snapshot
   *  before the stream can say anything meaningful. */
  previousClose: number | null;

  lastPrice: number | null;
  lastTradeSize: number | null;

  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;

  /** Session high/low as OBSERVED on our feed. Named to make the limitation
   *  visible: on a single venue this is not the day's true range. */
  observedHigh: number | null;
  observedLow: number | null;

  /** Cumulative size of qualifying trades seen on this feed. */
  volume: number;
  /** Cumulative price × size. Better than volume for ranking activity, because
   *  it is not distorted by low-priced high-share-count names. */
  dollarVolume: number;
  /** Which feed the volume came from — so a ranking cannot forget that a
   *  single-venue count is not market volume. */
  volumeSource: FeedSource | null;

  status: MarketStatus;

  /** Exchange time of the newest event applied. Freshness is judged on this. */
  lastExchangeTimestamp: number | null;
  lastTradeTimestamp: number | null;
  lastQuoteTimestamp: number | null;
  /** Local receive time of the newest event, for latency telemetry only. */
  lastReceivedAt: number | null;

  sequence: number | null;
  /** True once a gap is detected. Never cleared by the stream — only a fresh
   *  snapshot can restore confidence, because the missed volume is gone. */
  sequenceGap: boolean;

  source: FeedSource | null;

  // --- counters, for observability ---
  tradesApplied: number;
  duplicatesDropped: number;
  outOfOrderPrices: number;
}

export function createSymbolState(symbol: string): SymbolState {
  return {
    symbol,
    previousClose: null,
    lastPrice: null,
    lastTradeSize: null,
    bid: null,
    ask: null,
    bidSize: null,
    askSize: null,
    observedHigh: null,
    observedLow: null,
    volume: 0,
    dollarVolume: 0,
    volumeSource: null,
    status: "closed",
    lastExchangeTimestamp: null,
    lastTradeTimestamp: null,
    lastQuoteTimestamp: null,
    lastReceivedAt: null,
    sequence: null,
    sequenceGap: false,
    source: null,
    tradesApplied: 0,
    duplicatesDropped: 0,
    outOfOrderPrices: 0,
  };
}

export type ApplyResult =
  | "applied"
  | "duplicate"
  | "out_of_order_price" // counted toward volume, did not move last price
  | "sequence_gap" // applied, but the state is now known-incomplete
  | "ignored";

/**
 * A bounded ring of recently-seen trade identities.
 *
 * Bounded on purpose: an unbounded Set over a full trading day is an
 * out-of-memory waiting to happen at market open. A few hundred entries per
 * symbol covers any realistic reconnect replay window, and an identity that
 * falls out of the ring is one no reconnect will resend.
 */
class RecentIds {
  private readonly ids: (string | number)[] = [];
  private readonly seen = new Set<string | number>();
  constructor(private readonly capacity: number) {}

  has(id: string | number): boolean {
    return this.seen.has(id);
  }

  add(id: string | number): void {
    this.ids.push(id);
    this.seen.add(id);
    if (this.ids.length > this.capacity) {
      const evicted = this.ids.shift();
      if (evicted !== undefined) this.seen.delete(evicted);
    }
  }
}

const DEDUPE_WINDOW = 512;

/**
 * The engine: symbol states plus the per-symbol dedupe rings.
 *
 * Deliberately a class holding plain maps rather than anything reactive. The
 * hot path must not allocate, and nothing here should trigger a render.
 */
export class MarketDataEngine {
  private readonly states = new Map<string, SymbolState>();
  private readonly recent = new Map<string, RecentIds>();

  constructor(private readonly freshness: FreshnessPolicy = DEFAULT_FRESHNESS) {}

  get size(): number {
    return this.states.size;
  }

  state(symbol: string): SymbolState | undefined {
    return this.states.get(symbol);
  }

  all(): SymbolState[] {
    return [...this.states.values()];
  }

  private ensure(symbol: string): SymbolState {
    let s = this.states.get(symbol);
    if (!s) {
      s = createSymbolState(symbol);
      this.states.set(symbol, s);
    }
    return s;
  }

  /**
   * Seed from a REST snapshot.
   *
   * Supplies what a stream cannot: the previous close, and the consolidated
   * session figures if the caller has them. Called on startup and after a
   * reconnect, because a gap makes the streamed volume permanently short.
   */
  hydrate(
    symbol: string,
    snapshot: {
      previousClose?: number | null;
      lastPrice?: number | null;
      volume?: number | null;
      dollarVolume?: number | null;
      high?: number | null;
      low?: number | null;
      status?: MarketStatus;
      exchangeTimestamp?: number | null;
      source: FeedSource;
    }
  ): SymbolState {
    const s = this.ensure(symbol);
    if (snapshot.previousClose != null && snapshot.previousClose > 0) {
      s.previousClose = snapshot.previousClose;
    }
    if (snapshot.lastPrice != null && snapshot.lastPrice > 0) s.lastPrice = snapshot.lastPrice;
    if (snapshot.high != null) s.observedHigh = snapshot.high;
    if (snapshot.low != null) s.observedLow = snapshot.low;
    if (snapshot.status) s.status = snapshot.status;
    if (snapshot.exchangeTimestamp != null) {
      s.lastExchangeTimestamp = snapshot.exchangeTimestamp;
    }
    // A snapshot RESETS the counters rather than adding to them. It is an
    // authoritative running total, so accumulating on top would double-count
    // everything the stream had already applied.
    if (snapshot.volume != null && snapshot.volume >= 0) {
      s.volume = snapshot.volume;
      s.volumeSource = snapshot.source;
      // A fresh authoritative total is the only thing that can clear a gap:
      // the missed volume is now accounted for.
      s.sequenceGap = false;
    }
    if (snapshot.dollarVolume != null && snapshot.dollarVolume >= 0) {
      s.dollarVolume = snapshot.dollarVolume;
    }
    s.source = snapshot.source;
    return s;
  }

  /** Apply one event. Never throws; the hot path may not have a try/catch. */
  apply(event: MarketEvent): ApplyResult {
    const s = this.ensure(event.symbol);

    // ---- Sequence -----------------------------------------------------
    let gapped = false;
    if (event.sequence != null) {
      if (s.sequence != null) {
        if (event.sequence <= s.sequence) {
          // Already seen, or older. Sequence is authoritative when present.
          s.duplicatesDropped++;
          return "duplicate";
        }
        if (event.sequence > s.sequence + 1) {
          // Messages were lost. Volume from here is short, and no amount of
          // further streaming recovers it.
          s.sequenceGap = true;
          gapped = true;
        }
      }
      s.sequence = event.sequence;
    }

    switch (event.type) {
      case "trade":
        return this.applyTrade(s, event, gapped);
      case "quote":
        return this.applyQuote(s, event, gapped);
      case "status":
        s.status = event.status;
        s.lastExchangeTimestamp = maxTs(s.lastExchangeTimestamp, event.exchangeTimestamp);
        s.lastReceivedAt = event.receivedAt;
        s.source = event.source;
        return gapped ? "sequence_gap" : "applied";
    }
  }

  private applyTrade(
    s: SymbolState,
    e: Extract<MarketEvent, { type: "trade" }>,
    gapped: boolean
  ): ApplyResult {
    if (!(e.price > 0) || !(e.size > 0)) return "ignored";

    // ---- Dedupe -------------------------------------------------------
    if (e.tradeId != null) {
      let ring = this.recent.get(s.symbol);
      if (!ring) {
        ring = new RecentIds(DEDUPE_WINDOW);
        this.recent.set(s.symbol, ring);
      }
      if (ring.has(e.tradeId)) {
        s.duplicatesDropped++;
        return "duplicate";
      }
      ring.add(e.tradeId);
    }

    // ---- Volume -------------------------------------------------------
    //
    // Counted even when the trade is late or does not set the last price: it
    // was a real execution and the shares really changed hands. This is the
    // asymmetry that a single `if (isNewer)` guard gets wrong.
    if (countsTowardVolume(e.conditions)) {
      s.volume += e.size;
      s.dollarVolume += e.price * e.size;
      s.volumeSource = e.source;
    }

    s.tradesApplied++;
    s.lastReceivedAt = e.receivedAt;
    s.source = e.source;

    // ---- Last price ---------------------------------------------------
    if (!updatesLastPrice(e.conditions)) {
      return gapped ? "sequence_gap" : "applied";
    }

    const isNewer =
      e.exchangeTimestamp == null ||
      s.lastTradeTimestamp == null ||
      e.exchangeTimestamp >= s.lastTradeTimestamp;

    if (!isNewer) {
      // Describes an earlier moment. Its volume counted above; its price does
      // not move the tape backwards.
      s.outOfOrderPrices++;
      return "out_of_order_price";
    }

    s.lastPrice = e.price;
    s.lastTradeSize = e.size;
    s.lastTradeTimestamp = e.exchangeTimestamp ?? s.lastTradeTimestamp;
    s.lastExchangeTimestamp = maxTs(s.lastExchangeTimestamp, e.exchangeTimestamp);

    // Session range, from qualifying prints only.
    if (s.observedHigh == null || e.price > s.observedHigh) s.observedHigh = e.price;
    if (s.observedLow == null || e.price < s.observedLow) s.observedLow = e.price;

    return gapped ? "sequence_gap" : "applied";
  }

  private applyQuote(
    s: SymbolState,
    e: Extract<MarketEvent, { type: "quote" }>,
    gapped: boolean
  ): ApplyResult {
    // A quote older than the newest quote we hold describes a book that has
    // already changed. Unlike a trade it carries nothing cumulative, so there
    // is nothing worth keeping from it.
    if (
      e.exchangeTimestamp != null &&
      s.lastQuoteTimestamp != null &&
      e.exchangeTimestamp < s.lastQuoteTimestamp
    ) {
      return "out_of_order_price";
    }

    // A crossed or locked book (bid >= ask) is transient and usually a
    // cross-venue artefact. Recorded, but it must not be used to derive a
    // price — see `midOf`.
    s.bid = e.bid;
    s.ask = e.ask;
    s.bidSize = e.bidSize;
    s.askSize = e.askSize;
    s.lastQuoteTimestamp = e.exchangeTimestamp ?? s.lastQuoteTimestamp;
    s.lastExchangeTimestamp = maxTs(s.lastExchangeTimestamp, e.exchangeTimestamp);
    s.lastReceivedAt = e.receivedAt;
    s.source = e.source;

    return gapped ? "sequence_gap" : "applied";
  }

  freshnessOf(symbol: string, now: number): Freshness {
    const s = this.states.get(symbol);
    if (!s) return "unknown";
    return freshnessOf(s.lastExchangeTimestamp, now, this.freshness);
  }

  /** Drop everything. Used on a provider switch, where mixing feeds would
   *  produce a state neither provider would recognise. */
  reset(): void {
    this.states.clear();
    this.recent.clear();
  }
}

function maxTs(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/** Percent change against the previous close. Null unless both are real. */
export function changePercentOf(s: SymbolState): number | null {
  if (s.lastPrice == null || s.previousClose == null) return null;
  if (!(s.previousClose > 0) || !(s.lastPrice > 0)) return null;
  return ((s.lastPrice - s.previousClose) / s.previousClose) * 100;
}

/** Absolute change against the previous close. */
export function changeOf(s: SymbolState): number | null {
  if (s.lastPrice == null || s.previousClose == null) return null;
  return s.lastPrice - s.previousClose;
}

/**
 * The mid, and only from an uncrossed two-sided book.
 *
 * A one-sided book has no mid, and a crossed one (bid >= ask) has a mid that
 * is an artefact rather than a price. Both return null instead of a number
 * that would look perfectly ordinary downstream.
 */
export function midOf(s: SymbolState): number | null {
  if (s.bid == null || s.ask == null) return null;
  if (!(s.bid > 0) || !(s.ask > 0)) return null;
  if (s.bid >= s.ask) return null;
  return (s.bid + s.ask) / 2;
}
