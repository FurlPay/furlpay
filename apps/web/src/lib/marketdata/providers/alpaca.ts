// ---------------------------------------------------------------------------
// The Alpaca market-data adapter: entitlement detection, snapshots, streaming.
//
// ENTITLEMENT IS DETECTED, NOT ASSUMED. `detectEntitlement()` asks the API
// which feed the configured keys can actually read, because the answer decides
// what the product may claim. Measured on 2026-08-22 with this deployment's
// keys:
//
//     feed=iex → 200
//     feed=sip → 403 "subscription does not permit querying recent SIP data"
//
// So: IEX. One venue, measured that day at 1.97%-3.50% of consolidated volume
// depending on the symbol. Prices are real; volume is not market volume. The
// detection result is carried through to the ranking engine, which refuses a
// volume board rather than producing a plausible wrong one.
//
// STREAMING IS REAL ON THIS TIER. Alpaca's IEX WebSocket is available on the
// free plan — one concurrent connection, and a 30-channel cap for trades and
// quotes. That cap is the binding constraint on this deployment, not latency:
// we cannot stream 409 symbols, so `MAX_STREAM_SYMBOLS` is honest about it and
// the rest stay on snapshot polling.
//
// WHAT THIS FILE WILL NOT DO: run in a serverless function. A WebSocket held
// for hours has nowhere to live on Vercel (see docs). The client is written so
// a long-lived worker can use it; nothing in the request path constructs one.
// ---------------------------------------------------------------------------

import type { FeedSource, MarketEvent, MarketStatus } from "../types";

const DATA_HOST = "https://data.alpaca.markets";
/** Free-tier streaming is the IEX stream; SIP has its own host path. */
export const STREAM_URL = {
  iex: "wss://stream.data.alpaca.markets/v2/iex",
  sip: "wss://stream.data.alpaca.markets/v2/sip",
} as const;

/**
 * Free-plan channel cap for trades and quotes.
 *
 * Alpaca documents 30 channels at a time on the Basic plan. Exceeding it does
 * not degrade gracefully — the subscribe is rejected — so the caller must
 * choose which symbols matter rather than discovering the limit at runtime.
 */
export const MAX_STREAM_SYMBOLS = 30;

export interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
}

export function credentialsFromEnv(): AlpacaCredentials | null {
  const keyId = process.env.ALPACA_API_KEY_ID?.trim();
  const secretKey = process.env.ALPACA_API_SECRET_KEY?.trim();
  if (!keyId || !secretKey) return null;
  return { keyId, secretKey };
}

function headers(c: AlpacaCredentials): Record<string, string> {
  return { "APCA-API-KEY-ID": c.keyId, "APCA-API-SECRET-KEY": c.secretKey, Accept: "application/json" };
}

export interface Entitlement {
  /** The best feed these credentials can actually read. */
  feed: FeedSource;
  /** True only for the consolidated tape. Gates volume-based rankings. */
  consolidated: boolean;
  /** Whether streaming is available at all. */
  streaming: boolean;
  /** Channel cap for trades/quotes on this tier. */
  maxStreamSymbols: number;
  detail: string;
}

/**
 * Ask the API what these keys can read.
 *
 * SIP first: if it answers, everything downstream can be consolidated. A 403
 * is the documented Basic-plan response and is not an error condition — it is
 * the answer to the question.
 */
export async function detectEntitlement(c: AlpacaCredentials): Promise<Entitlement | null> {
  const probe = async (feed: "sip" | "iex"): Promise<number> => {
    try {
      const res = await fetch(`${DATA_HOST}/v2/stocks/snapshots?symbols=AAPL&feed=${feed}`, {
        headers: headers(c),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      return res.status;
    } catch {
      return 0;
    }
  };

  if ((await probe("sip")) === 200) {
    return {
      feed: "sip",
      consolidated: true,
      streaming: true,
      // The paid tiers lift the channel cap entirely.
      maxStreamSymbols: Number.MAX_SAFE_INTEGER,
      detail: "Consolidated CTA + UTP feed. Volume is market volume.",
    };
  }

  if ((await probe("iex")) === 200) {
    return {
      feed: "iex",
      consolidated: false,
      streaming: true,
      maxStreamSymbols: MAX_STREAM_SYMBOLS,
      detail:
        "IEX feed only (Basic plan). Prices are real IEX prints; volume is a single venue's " +
        "share of the market — measured at 1.97%-3.50% of consolidated on 2026-08-22, and the " +
        "share varies by symbol, so it cannot be scaled. Volume rankings stay disabled.",
    };
  }

  // Credentials present but neither feed answers: expired, revoked, or wrong.
  // Null rather than a guess, so the caller falls back visibly.
  return null;
}

// ---------------------------------------------------------------------------
// Snapshots — hydration and recovery
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  symbol: string;
  previousClose: number | null;
  lastPrice: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  exchangeTimestamp: number | null;
}

interface AlpacaSnapshot {
  latestTrade?: { p?: number; t?: string; s?: number };
  dailyBar?: { c?: number; h?: number; l?: number; v?: number; t?: string };
  prevDailyBar?: { c?: number };
}

function ts(v: string | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Batch snapshots — what the stream cannot supply.
 *
 * The previous close in particular: it is the denominator of every percent
 * change and no stream sends it. A symbol without one cannot rank at all, so
 * hydration is a precondition for the movers engine, not an optimisation.
 */
export async function fetchSnapshots(
  c: AlpacaCredentials,
  symbols: string[],
  feed: "iex" | "sip"
): Promise<SnapshotRow[]> {
  const out: SnapshotRow[] = [];
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    try {
      const res = await fetch(
        `${DATA_HOST}/v2/stocks/snapshots?symbols=${encodeURIComponent(chunk.join(","))}&feed=${feed}`,
        { headers: headers(c), signal: AbortSignal.timeout(10_000), cache: "no-store" }
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, AlpacaSnapshot>;
      for (const [symbol, snap] of Object.entries(data)) {
        out.push({
          symbol,
          previousClose: positive(snap.prevDailyBar?.c),
          lastPrice: positive(snap.latestTrade?.p) ?? positive(snap.dailyBar?.c),
          volume: snap.dailyBar?.v ?? null,
          high: positive(snap.dailyBar?.h),
          low: positive(snap.dailyBar?.l),
          exchangeTimestamp: ts(snap.latestTrade?.t) ?? ts(snap.dailyBar?.t),
        });
      }
    } catch {
      // One bad chunk leaves those symbols unhydrated; they stay ineligible
      // rather than ranking on a missing previous close.
    }
  }
  return out;
}

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Stream message normalisation
// ---------------------------------------------------------------------------

interface AlpacaStreamMessage {
  T: string; // message type: t=trade, q=quote, s=status, subscription, error, success
  S?: string; // symbol
  p?: number; // trade price
  s?: number; // trade size / bid size depending on type
  bp?: number;
  ap?: number;
  bs?: number;
  as?: number;
  t?: string; // RFC-3339 timestamp
  i?: number; // trade id
  c?: string[]; // conditions
  sc?: string; // status code
  sm?: string; // status message
  msg?: string;
  code?: number;
}

const STATUS_MAP: Record<string, MarketStatus> = {
  H: "halted",
  T: "regular",
  Q: "auction",
  P: "auction",
  C: "closed",
};

/**
 * Normalise one Alpaca stream message.
 *
 * Returns null for anything that is not market data — control frames, errors,
 * subscription acknowledgements. The caller handles those separately rather
 * than having them silently become events.
 */
export function normalizeStreamMessage(
  raw: unknown,
  feed: FeedSource,
  receivedAt = Date.now()
): MarketEvent | null {
  const m = raw as AlpacaStreamMessage;
  if (!m?.T || !m.S) return null;

  switch (m.T) {
    case "t":
      if (typeof m.p !== "number" || typeof m.s !== "number") return null;
      return {
        type: "trade",
        symbol: m.S,
        price: m.p,
        size: m.s,
        // Alpaca's trade id is unique per symbol per day. Namespaced by symbol
        // so two symbols cannot collide in a shared dedupe ring.
        tradeId: m.i != null ? `${m.S}:${m.i}` : undefined,
        conditions: m.c,
        exchangeTimestamp: ts(m.t),
        receivedAt,
        source: feed,
      };
    case "q":
      return {
        type: "quote",
        symbol: m.S,
        bid: typeof m.bp === "number" ? m.bp : null,
        ask: typeof m.ap === "number" ? m.ap : null,
        bidSize: typeof m.bs === "number" ? m.bs : null,
        askSize: typeof m.as === "number" ? m.as : null,
        exchangeTimestamp: ts(m.t),
        receivedAt,
        source: feed,
      };
    case "s": {
      const status = m.sc ? STATUS_MAP[m.sc] : undefined;
      if (!status) return null;
      return {
        type: "status",
        symbol: m.S,
        status,
        reason: m.sm,
        exchangeTimestamp: ts(m.t),
        receivedAt,
        source: feed,
      };
    }
    default:
      return null;
  }
}

/** The auth frame Alpaca expects immediately after connect. */
export function authFrame(c: AlpacaCredentials): string {
  return JSON.stringify({ action: "auth", key: c.keyId, secret: c.secretKey });
}

/**
 * The subscribe frame.
 *
 * Throws above the channel cap rather than sending a request the server will
 * reject: a rejected subscribe leaves the socket connected and silent, which
 * looks exactly like a market with no activity.
 */
export function subscribeFrame(symbols: string[], cap = MAX_STREAM_SYMBOLS): string {
  if (symbols.length > cap) {
    throw new Error(
      `Cannot subscribe to ${symbols.length} symbols: this entitlement caps trades/quotes at ${cap} ` +
        "channels. Choose the symbols that matter and poll the rest."
    );
  }
  return JSON.stringify({ action: "subscribe", trades: symbols, quotes: symbols, statuses: symbols });
}

/**
 * Reconnect backoff with full jitter.
 *
 * Jitter is not decoration: without it every client of a provider that
 * restarts reconnects on the same schedule and re-creates the load that took
 * it down. Capped so a long outage does not push retries into the hours.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
  return Math.round(random() * base);
}
