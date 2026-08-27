// ---------------------------------------------------------------------------
// The daily market brief: assembly.
//
// This is the layer that turns several independent upstreams into one object a
// renderer can print without making a single decision of its own.
//
// THE DESIGN CONSTRAINT THAT SHAPES EVERYTHING HERE is that this runs
// unattended, once a day, and posts to a public channel. Nobody proofreads the
// output. So the failure mode to design against is not "the job crashed" —
// that is loud and someone notices. It is "the job posted, and one section was
// quietly wrong". Three rules follow:
//
//   SECTIONS DEGRADE INDEPENDENTLY. Yahoo's screener and Yahoo's chart endpoint
//   are different services that fail at different times. One being down blanks
//   its own section and is NAMED in `degraded`; it never blanks the others and
//   never silently renders as zeros.
//
//   NOTHING IS INFERRED ACROSS A GAP. If the S&P quote is missing, the brief
//   does not compute the index level from the futures, or carry yesterday's
//   forward, or omit the row as though the market did not open. It reports the
//   row as unavailable.
//
//   AN EMPTY BRIEF IS NOT POSTED. `postable` is false when every section failed.
//   A post reading "Daily Market Brief" with nothing under it is worse than no
//   post, because it looks like the market did nothing.
//
// ON BREADTH. The advancers/decliners line is NOT the market's advance/decline
// count — no keyless source gives that. It is the size of Yahoo's own
// day_gainers and day_losers screens, which have published criteria (price >=
// $5, volume > 15k, move greater than 3% / 2.5%). `breadth.definition` carries
// those criteria into the post so the number cannot be read as something it is
// not.
//
// ON THE FETCH BUDGET. Every symbol here costs one keyless request to a shared,
// undocumented, IP-rate-limited endpoint, and that budget is shared with every
// visitor to /markets. Sparklines are therefore fetched ONLY for the rows that
// display one (indices and crypto); the watchlist and macro rows are quotes
// alone. The provider cache absorbs a re-run within the TTL.
// ---------------------------------------------------------------------------

import { bars as yahooBars, quote as yahooQuote, type YahooQuote } from "../providers/yahoo";
import { fetchScreen, SCREEN_DEFINITIONS, type ScreenResult, type ScreenerQuote } from "./screener";
import { rankBullish, type RankedBoard, type ScoredQuote } from "./score";
import { analyze, narrate, MACRO_SYMBOLS, type MacroSnapshot, type Signal } from "./analysis";

/** Indices the brief opens with. */
export const INDEX_SYMBOLS = [
  { symbol: "^GSPC", label: "S&P 500", short: "S&P 500" },
  { symbol: "^IXIC", label: "Nasdaq Composite", short: "NASDAQ" },
  { symbol: "^DJI", label: "Dow Jones", short: "DOW" },
] as const;

/** Crypto the brief carries. */
export const CRYPTO_SYMBOLS = [
  { symbol: "BTC-USD", label: "Bitcoin", short: "BTC" },
  { symbol: "ETH-USD", label: "Ethereum", short: "ETH" },
  { symbol: "SOL-USD", label: "Solana", short: "SOL" },
] as const;

/**
 * The default watchlist.
 *
 * Overridable with FURLPAY_BRIEF_TICKERS (comma-separated). Capped, because
 * each symbol is a request against a shared rate limit.
 */
export const DEFAULT_WATCHLIST = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "AVGO"];
export const MAX_WATCHLIST = 12;

/** How many rows each board shows. */
export const BOARD_SIZE = 5;

/** Sparkline resolution — the number of buckets drawn, not bars fetched. */
export const SPARK_WIDTH = 8;

export interface LevelRow {
  label: string;
  /** Compact form for a narrow table column. */
  short: string;
  /** How the change should be rendered. A "yield" row quotes a number that is
   *  already a percentage, so its move is shown in basis points — a percent
   *  change of a percent is the kind of number a reader silently misreads. */
  unit: "level" | "yield";
  symbol: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  /** Intraday closes for a sparkline. Empty when no series was fetched or the
   *  provider returned none — never zero-filled. */
  series: number[];
  /** Exchange timestamp, epoch ms. Null when the provider stated none — the
   *  renderer then declines to claim the row is current. */
  asOf: number | null;
}

export interface MoverRow {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number | null;
}

export interface BreadthLine {
  advancers: number | null;
  decliners: number | null;
  /** Exactly what was counted. Printed, not just stored. */
  definition: string;
}

export interface MarketBrief {
  /** When this brief was assembled. */
  generatedAt: number;
  /** Trading date in US Eastern terms, which is what "today" means for a US
   *  equity brief regardless of where the server runs. */
  sessionDate: string;
  /** Yahoo's own market-state string, when it gave one: REGULAR, POST, CLOSED,
   *  PRE. Drives the post's headline so a brief written mid-session does not
   *  call itself a close. */
  marketState: string | null;
  indices: LevelRow[];
  crypto: LevelRow[];
  watchlist: LevelRow[];
  macro: MacroSnapshot;
  gainers: MoverRow[];
  losers: MoverRow[];
  bullish: ScoredQuote[];
  breadth: BreadthLine;
  /** Findings from the analysis engine, strongest first. Every one carries the
   *  measurement that produced it — see analysis.ts. */
  signals: Signal[];
  /** The composed paragraph. Sentences are the signals' own text, verbatim. */
  narrative: string;
  /** Ranking diagnostics: how many rows were considered and why they did not
   *  make the bullish board. Not rendered into the post; returned by the route
   *  so an operator can see why a board is short. */
  ranking: Pick<RankedBoard, "considered" | "rejected">;
  /** Named upstreams that did not answer. Rendered into the post footer so a
   *  thin brief is visibly thin-because-a-source-failed, not thin-because-the-
   *  market-was-quiet. */
  degraded: string[];
  /** False when nothing usable was fetched. The caller must not post. */
  postable: boolean;
}

/** US Eastern calendar date — the trading date a US brief is about. */
export function sessionDateOf(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Parse the watchlist override.
 *
 * Symbols are uppercased and filtered to a conservative character set. This is
 * an operator-supplied env var, not user input, but it is interpolated into a
 * URL — so it is validated rather than trusted.
 */
export function parseWatchlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return DEFAULT_WATCHLIST;
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim().toUpperCase();
    if (!s) continue;
    if (!/^[A-Z0-9.^=-]{1,12}$/.test(s)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= MAX_WATCHLIST) break;
  }
  return out.length ? out : DEFAULT_WATCHLIST;
}

function levelFrom(
  label: string,
  short: string,
  symbol: string,
  q: YahooQuote | null,
  series: number[] = [],
  unit: "level" | "yield" = "level"
): LevelRow | null {
  if (!q || !Number.isFinite(q.price) || q.price <= 0) return null;
  return {
    label,
    short,
    unit,
    symbol,
    price: q.price,
    change: Number.isFinite(q.change as number) ? (q.change as number) : null,
    changePercent: Number.isFinite(q.changePct as number) ? (q.changePct as number) : null,
    series,
    // yahoo.ts reports the exchange timestamp in epoch SECONDS.
    asOf: q.marketTime === null ? null : q.marketTime * 1000,
  };
}

function moverFrom(q: ScreenerQuote): MoverRow | null {
  const price = q.regularMarketPrice;
  const pct = q.regularMarketChangePercent;
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  return {
    symbol: q.symbol,
    name: q.shortName || q.displayName || q.longName || q.symbol,
    price,
    changePercent: pct,
    volume:
      typeof q.regularMarketVolume === "number" && Number.isFinite(q.regularMarketVolume)
        ? q.regularMarketVolume
        : null,
  };
}

export interface BuildOptions {
  boardSize?: number;
  watchlist?: string[];
  /** Injected in tests. Production passes nothing and the real fetchers run. */
  fetchers?: {
    screen?: typeof fetchScreen;
    quote?: typeof yahooQuote;
    bars?: typeof yahooBars;
  };
  now?: Date;
}

/**
 * Build the brief.
 *
 * Every upstream call is settled independently, so one slow or broken provider
 * costs its own section and nothing else. Nothing here throws.
 */
export async function buildBrief(options: BuildOptions = {}): Promise<MarketBrief> {
  const boardSize = options.boardSize ?? BOARD_SIZE;
  const now = options.now ?? new Date();
  const screen = options.fetchers?.screen ?? fetchScreen;
  const getQuote = options.fetchers?.quote ?? yahooQuote;
  const getBars = options.fetchers?.bars ?? yahooBars;
  const watchSymbols = options.watchlist ?? parseWatchlist(process.env.FURLPAY_BRIEF_TICKERS);
  const degraded: string[] = [];

  const safeQuote = async (symbol: string): Promise<YahooQuote | null> => {
    try {
      return await getQuote(symbol);
    } catch {
      return null;
    }
  };
  const safeScreen = async (id: Parameters<typeof fetchScreen>[0], count: number) => {
    try {
      return await screen(id, count);
    } catch {
      return null;
    }
  };
  /** Intraday closes for a sparkline. Failure costs the sparkline, not the row. */
  const safeSeries = async (symbol: string): Promise<number[]> => {
    try {
      const b = await getBars(symbol, "1D");
      return b?.map((x) => x.c).filter((c) => Number.isFinite(c)) ?? [];
    } catch {
      return [];
    }
  };

  // Wider than the board: floors and dedupe will remove rows, and a board built
  // from exactly `boardSize` candidates comes out short the moment one of them
  // is a sub-$5 name.
  const candidateCount = Math.max(25, boardSize * 8);

  const sparkSymbols = [...INDEX_SYMBOLS, ...CRYPTO_SYMBOLS];

  const [gainersScreen, losersScreen, activesScreen, quotes, seriesList, macroQuotes, watchQuotes] =
    await Promise.all([
      safeScreen("day_gainers", candidateCount),
      safeScreen("day_losers", boardSize * 4),
      safeScreen("most_actives", candidateCount),
      Promise.all(sparkSymbols.map((s) => safeQuote(s.symbol))),
      Promise.all(sparkSymbols.map((s) => safeSeries(s.symbol))),
      Promise.all(MACRO_SYMBOLS.map((m) => safeQuote(m.symbol))),
      Promise.all(watchSymbols.map((s) => safeQuote(s))),
    ]);

  // ---- Indices and crypto ------------------------------------------------
  const indices: LevelRow[] = [];
  const crypto: LevelRow[] = [];
  INDEX_SYMBOLS.forEach((i, n) => {
    const row = levelFrom(i.label, i.short, i.symbol, quotes[n] ?? null, seriesList[n] ?? []);
    if (row) indices.push(row);
    else degraded.push(`${i.label} (${i.symbol}) quote unavailable`);
  });
  CRYPTO_SYMBOLS.forEach((c, n) => {
    const at = INDEX_SYMBOLS.length + n;
    const row = levelFrom(c.label, c.short, c.symbol, quotes[at] ?? null, seriesList[at] ?? []);
    if (row) crypto.push(row);
    else degraded.push(`${c.label} (${c.symbol}) quote unavailable`);
  });

  // ---- Macro -------------------------------------------------------------
  const macro: MacroSnapshot = {};
  MACRO_SYMBOLS.forEach((m, n) => {
    const row = levelFrom(m.label, m.short, m.symbol, macroQuotes[n] ?? null, [], m.unit);
    if (row) macro[m.key] = row;
    else degraded.push(`${m.label} (${m.symbol}) unavailable`);
  });

  // ---- Watchlist ---------------------------------------------------------
  const watchlist: LevelRow[] = [];
  watchSymbols.forEach((s, n) => {
    const q = watchQuotes[n] ?? null;
    const row = levelFrom(q?.name ?? s, s, s, q);
    if (row) watchlist.push(row);
  });
  if (watchSymbols.length > 0 && watchlist.length === 0) {
    degraded.push("watchlist quotes unavailable");
  }

  // ---- Movers ------------------------------------------------------------
  const gainerQuotes = gainersScreen?.quotes ?? [];
  const gainers = gainerQuotes
    .map(moverFrom)
    .filter((r): r is MoverRow => r !== null)
    .slice(0, boardSize);
  const losers = (losersScreen?.quotes ?? [])
    .map(moverFrom)
    .filter((r): r is MoverRow => r !== null)
    .slice(0, boardSize);

  if (!gainersScreen) degraded.push("day_gainers screen unavailable");
  if (!losersScreen) degraded.push("day_losers screen unavailable");
  if (!activesScreen) degraded.push("most_actives screen unavailable");

  // ---- Bullish board -----------------------------------------------------
  // Drawn from gainers AND most-actives together. Gainers alone finds the day's
  // biggest percentage moves; most-actives alone finds where the volume is. The
  // score is looking for names that are in both, and it cannot find them if it
  // only ever sees one list.
  const candidates: ScreenerQuote[] = [...gainerQuotes, ...(activesScreen?.quotes ?? [])];
  const ranked = rankBullish(candidates, boardSize);

  // ---- Breadth -----------------------------------------------------------
  const breadth: BreadthLine = {
    advancers: gainersScreen?.total ?? null,
    decliners: losersScreen?.total ?? null,
    definition: `${SCREEN_DEFINITIONS.day_gainers}; ${SCREEN_DEFINITIONS.day_losers}`,
  };

  // Yahoo stamps a market state on screener rows. Taken from whichever screen
  // answered rather than assumed from the clock, which would be wrong on every
  // market holiday.
  const marketState =
    gainersScreen?.quotes.find((q) => q.marketState)?.marketState ??
    activesScreen?.quotes.find((q) => q.marketState)?.marketState ??
    null;

  // ---- Analysis ----------------------------------------------------------
  const signals = analyze({
    indices,
    macro,
    bullish: ranked.rows,
    gainerQuotes,
    advancers: breadth.advancers,
    decliners: breadth.decliners,
    now: now.getTime(),
  });

  const postable =
    indices.length > 0 || crypto.length > 0 || gainers.length > 0 || ranked.rows.length > 0;

  return {
    generatedAt: now.getTime(),
    sessionDate: sessionDateOf(now),
    marketState,
    indices,
    crypto,
    watchlist,
    macro,
    gainers,
    losers,
    bullish: ranked.rows,
    breadth,
    signals,
    narrative: narrate(signals),
    ranking: { considered: ranked.considered, rejected: ranked.rejected },
    degraded,
    postable,
  };
}

/** Re-exported so the route can name what it depends on without reaching past
 *  this module. */
export type { ScreenResult, ScreenerQuote, ScoredQuote, MacroSnapshot, Signal };
export { SPARK_WIDTH as SPARKLINE_WIDTH };
