import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { bySymbol } from "@/lib/markets/catalog";
import { resolveAsset } from "@/lib/markets/resolve";
import { bars as yahooBars, type Timeframe as YahooTf } from "@/lib/markets/providers/yahoo";
import { yahooSymbolFor } from "@/lib/markets/providers";
import { resolveInstrument } from "@/lib/markets/instruments";

// GET /api/markets/bars?symbol=AAPL&tf=1M — real OHLC history for the charts.
//
// Three sources, tried in order, because each covers a different slice of the
// catalog and only the union covers all of it:
//
//   Alpaca      requires API keys and covers US equities plus its own crypto
//               pairs. Preferred when configured — it is the same feed the
//               order path trades against, so the chart and the fill agree.
//   CoinGecko   coins, up to a year back, where it is far denser than Yahoo's
//               thin `-USD` pairs. Tried before Yahoo, and only for crypto.
//   Yahoo       no key, and the only source here that answers for every
//               catalog symbol: share classes (BRK.B -> BRK-B) as well as
//               coins. Last, as the backstop that leaves no symbol without a
//               chart on a deployment with no Alpaca keys.
//
// A 404 means no source had history. The caller must show that as unavailable:
// the client's synthetic series is a plausible-looking invented price history,
// which is the one thing a chart on a trading surface must never be.

type Tf = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

/** This route's timeframe vocabulary in Yahoo's terms.
 *
 * Not a rename — Yahoo rejects range/interval pairs outside its own table
 * rather than degrading, so each of these maps to a pair it actually serves. */
const YAHOO_TF: Record<Tf, YahooTf> = {
  "1D": "1D",
  "1W": "5D",
  "1M": "1M",
  "3M": "3M",
  "1Y": "1Y",
  ALL: "MAX",
};
interface Candle { time: number; open: number; high: number; low: number; close: number }

// `days` is the LOOKBACK window, which is deliberately larger than the window the
// user sees. See the note on `visibleFrom` below for why.
//
// 1D moved from 5 days to 14, and the number is bounded on BOTH sides:
//
//   FLOOR — a converged EMA-200 needs ~600 bars (its seed is still 13.5% of the
//     value at 200 bars). A US session is ~78 five-minute bars, so 600 bars is
//     ~7.7 trading days ≈ 11 calendar days. 14 gives ~780 bars.
//
//   CEILING — `alpacaBars` below does NOT follow `next_page_token`, and Alpaca
//     returns bars ASCENDING from `start`. So a window holding more than
//     `limit=1000` bars comes back as the OLDEST 1000 and silently omits today —
//     the chart would render a week-old session as "1D". 14 days ≈ 780 bars keeps
//     the whole window inside one page.
//
// A larger window is therefore not safer here; it is how the most recent bars get
// dropped. Raising it means teaching alpacaBars to paginate first.
const ALPACA_TF: Record<Tf, { timeframe: string; days: number }> = {
  "1D": { timeframe: "5Min", days: 14 },
  "1W": { timeframe: "1Hour", days: 9 },
  "1M": { timeframe: "1Day", days: 36 },
  "3M": { timeframe: "1Day", days: 100 },
  "1Y": { timeframe: "1Week", days: 380 },
  ALL: { timeframe: "1Month", days: 3650 },
};
/** CoinGecko OHLC windows, in days.
 *
 * ALL is deliberately absent. The public API caps historical queries at 365
 * days and answers `days=max` with error 10012, so asking is a request that
 * cannot succeed — the full-history view is Yahoo's from the start. */
const CG_DAYS: Partial<Record<Tf, string>> = {
  "1D": "1",
  "1W": "7",
  "1M": "30",
  "3M": "90",
  "1Y": "365",
};

// Small in-memory cache: history doesn't need sub-minute freshness.
const cache = new Map<string, { at: number; candles: Candle[]; source: string }>();
const TTL_MS = 120_000;

interface AlpacaBar { t: string; o: number; h: number; l: number; c: number }

async function alpacaBars(url: string, headers: Record<string, string>, key: "bars"): Promise<AlpacaBar[]> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`alpaca ${res.status}`);
  const j = (await res.json()) as { bars?: AlpacaBar[] | Record<string, AlpacaBar[]> };
  const b = j[key];
  if (Array.isArray(b)) return b;
  if (b && typeof b === "object") return Object.values(b)[0] ?? [];
  return [];
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "markets.bars", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const tf = (req.nextUrl.searchParams.get("tf") ?? "1M") as Tf;
  // Same universe resolution as the detail route. Gating this on the curated
  // catalog would leave every uncurated symbol with a page and no chart, which
  // is the shape a reader reads as "this asset has never traded".
  const asset = await resolveAsset(symbol);

  // Not a security. Gold, an FX pair and an index all have real price history
  // and no CUSIP, and `resolveAsset` correctly misses them -- which left
  // /markets/XAUUSD with a page and no chart, the shape a reader reads as "this
  // has never traded". They are served straight from the provider under their
  // own provider symbol, skipping the broker path entirely: Alpaca has no
  // GC=F and never will.
  const instrument = asset ? null : resolveInstrument(symbol);

  // A Binance perpetual is served by none of the three providers below —
  // Alpaca has no HEMIUSDT, CoinGecko prices the coin rather than the contract,
  // and Yahoo has no symbol for it at all. That is why the chart read "No
  // source returned bars for HEMIUSDT".
  //
  // Handed off rather than inlined, because the Binance egress has to run
  // outside a US region (it answers 451 there) while this route serves 13,000
  // symbols that should stay close to their readers. /api/markets/perps/bars is
  // the pinned one; see apps/web/vercel.json.
  //
  // A redirect rather than a server-side proxy on purpose. Proxying would mean
  // this function guessing its own public origin — and the two candidates are
  // both wrong somewhere: VERCEL_URL is the per-deployment hostname, which
  // Deployment Protection answers with 401 to an uncredentialed server fetch,
  // and a hardcoded FURLPAY_ORIGIN sends every preview's chart to production
  // data. Redirecting hands the second request to the caller, which already
  // knows the origin it used, and costs one hop less than proxying did.
  if (instrument?.quoteSource === "binance-perp") {
    const to = new URL("/api/markets/perps/bars", req.url);
    to.searchParams.set("symbol", symbol);
    to.searchParams.set("tf", tf);
    // 307, not 302: the method and body must survive, and this route is
    // reachable through the x402 paywall registry where a GET silently
    // becoming something else would be a correctness bug rather than a nuisance.
    return NextResponse.redirect(to, 307);
  }

  if (instrument && ALPACA_TF[tf]) {
    const cacheKey = `${symbol}:${tf}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return NextResponse.json({ candles: hit.candles, source: hit.source, cached: true });
    }
    const rows = await yahooBars(instrument.providerSymbol, YAHOO_TF[tf]).catch(() => null);
    const candles: Candle[] = (rows ?? []).map((b) => ({
      time: b.t, open: b.o, high: b.h, low: b.l, close: b.c,
    }));
    if (candles.length) cache.set(cacheKey, { at: Date.now(), candles, source: "yahoo" });
    return NextResponse.json({ candles, source: "yahoo", cached: false });
  }

  if (!asset || !ALPACA_TF[tf]) return NextResponse.json({ error: "Unknown symbol/timeframe" }, { status: 404 });

  const cacheKey = `${symbol}:${tf}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) {
    // The window is recomputed rather than cached alongside the candles: the
    // series is identical, so the framing must be too, and a cached response that
    // omitted these fields would make the chart fall back to fitContent() and
    // render 21 days squeezed into a 1D viewport — visibly different from the
    // same request a moment earlier.
    const w = visibleWindow(tf, hit.candles);
    return NextResponse.json({
      candles: hit.candles,
      source: hit.source,
      cached: true,
      visibleFrom: w.visibleFrom,
      visibleTo: w.visibleTo,
    });
  }

  const key = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  const headers = key && secret ? { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret } : null;
  const { timeframe, days } = ALPACA_TF[tf];
  const start = new Date(Date.now() - days * 86_400_000).toISOString();

  let candles: Candle[] = [];
  let source = "";

  try {
    if (asset.kind !== "crypto" && headers) {
      const bars = await alpacaBars(
        `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${timeframe}&start=${start}&limit=1000&adjustment=split&feed=iex`,
        headers,
        "bars"
      );
      candles = bars.map((b) => ({ time: Math.floor(new Date(b.t).getTime() / 1000), open: b.o, high: b.h, low: b.l, close: b.c }));
      // NO LONGER TRUNCATED. This used to filter the 1D series down to the most
      // recent trading day, which is what the chart DISPLAYS — and that starved
      // every indicator of the history it needs.
      //
      // The numbers: a US session is ~78 five-minute bars, and a converged
      // EMA-200 needs ~600 (its seed still contributes 13.5% at 200 bars and
      // 6.3% at 277 — see emaConvergenceBars in lib/markets/indicators.ts). So
      // truncating to 78 made an EMA-200 impossible, and an EMA-50 on 78 bars
      // still carries ~35% of its seed.
      //
      // The full series is returned and `visibleFrom` below marks where the
      // displayed window starts, so the client can hold all 600 bars in the
      // series while showing only today. Panning left reveals the rest.
      source = "alpaca";
    } else if (asset.kind === "crypto" && headers) {
      const pair = `${symbol}/USD`;
      const bars = await alpacaBars(
        `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(pair)}&timeframe=${timeframe}&start=${start}&limit=1000`,
        headers,
        "bars"
      );
      candles = bars.map((b) => ({ time: Math.floor(new Date(b.t).getTime() / 1000), open: b.o, high: b.h, low: b.l, close: b.c }));
      source = "alpaca";
    }
  } catch {
    candles = [];
  }

  // Crypto not on Alpaca (or Alpaca unavailable) → CoinGecko OHLC.
  //
  // Ahead of Yahoo for coins, and only for coins, and only inside the year it
  // covers. Yahoo quotes a `-USD` pair for most tokens but thinly: PEPE's last
  // year there is a handful of weekly points against 92 daily bars here. Past
  // a year the comparison reverses — CoinGecko's public tier refuses the
  // query outright — so the ALL view is Yahoo's.
  const cgDays = CG_DAYS[tf];
  const cgId = bySymbol.get(symbol)?.cg;
  if (candles.length === 0 && asset.kind === "crypto" && cgId && cgDays) {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=${cgDays}`,
        { headers: { "User-Agent": "Mozilla/5.0 (compatible; FurlpayMarkets/1.0)" }, signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const rows = (await res.json()) as [number, number, number, number, number][];
        if (Array.isArray(rows)) {
          candles = rows.map(([ms, o, h, l, c]) => ({ time: Math.floor(ms / 1000), open: o, high: h, low: l, close: c }));
          source = "coingecko";
        }
      }
    } catch {
      /* fall through to 404 */
    }
  }

  // Universal backstop. Yahoo needs no credentials and knows every symbol in
  // this catalog — share classes as `BRK-B`, coins as `BTC-USD` — so it is
  // what keeps a chart real rather than synthetic on a deployment with no
  // Alpaca keys, which is every preview build.
  if (candles.length === 0) {
    const rows = await yahooBars(yahooSymbolFor(symbol, asset.kind), YAHOO_TF[tf]).catch(
      () => null
    );
    if (rows?.length) {
      candles = rows.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c }));
      source = "yahoo";
    }
  }

  if (candles.length < 2) return NextResponse.json({ error: "No history available" }, { status: 404 });

  cache.set(cacheKey, { at: Date.now(), candles, source });
  const { visibleFrom, visibleTo } = visibleWindow(tf, candles);
  return NextResponse.json({ candles, source, visibleFrom, visibleTo });
}

/**
 * Where the DISPLAYED window starts and ends within the returned series.
 *
 * The series carries more history than the chart shows, because indicators need
 * bars the user is not looking at. This tells the client which slice to frame,
 * so the two concerns stay separate: the API decides how much history the MATH
 * needs, the client decides what the EYE sees.
 *
 * Only 1D differs from the full series today. The other timeframes fetch a
 * window whose display range already matches what they request, so their visible
 * window IS the series and returning its bounds keeps the response shape uniform
 * rather than making the client branch on whether the fields are present.
 *
 * Returns nulls rather than guessing when there is nothing to frame, so a client
 * falls back to fitContent() instead of setting an empty range.
 */
function visibleWindow(
  tf: Tf,
  candles: Candle[]
): { visibleFrom: number | null; visibleTo: number | null } {
  if (candles.length === 0) return { visibleFrom: null, visibleTo: null };
  const last = candles[candles.length - 1];

  if (tf !== "1D") {
    return { visibleFrom: candles[0].time, visibleTo: last.time };
  }

  // The most recent trading day, in UTC. This is the slice the old code used to
  // return as the ENTIRE response; now it only frames the viewport.
  //
  // UTC rather than exchange-local on purpose: the bar timestamps are UTC, and
  // converting to America/New_York here would need a timezone database to be
  // right across DST. Grouping by UTC day can split a session for a market whose
  // close crosses midnight UTC — US equities close at 20:00/21:00 UTC, so they
  // are unaffected — and the cost of being wrong is a viewport that frames a
  // partial session, not incorrect math. The full series is present either way.
  const lastDay = new Date(last.time * 1000).toISOString().slice(0, 10);
  const sameDay = candles.filter(
    (c) => new Date(c.time * 1000).toISOString().slice(0, 10) === lastDay
  );
  if (sameDay.length === 0) return { visibleFrom: candles[0].time, visibleTo: last.time };
  return { visibleFrom: sameDay[0].time, visibleTo: sameDay[sameDay.length - 1].time };
}
