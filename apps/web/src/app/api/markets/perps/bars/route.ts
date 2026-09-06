import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { perpBySymbol } from "@/lib/markets/perps/registry";

export const dynamic = "force-dynamic";

// ── SAME REGION PIN, SAME REASON ───────────────────────────────────────────
//
// Binance answers HTTP 451 to US IPs and this project's default Function region
// is iad1. /api/markets/perps carries the full explanation; this route is the
// second egress point, for candles rather than quotes, and must be pinned
// identically or the chart silently has no history in production while working
// everywhere else.
//
// Both are covered by the one `functions` glob in apps/web/vercel.json:
// "src/app/api/markets/perps/**". Keeping the two Binance callers under a
// single directory is what lets that stay one line instead of a list somebody
// has to remember to extend.

// GET /api/markets/perps/bars?symbol=HEMIUSDT&tf=1M — OHLC candles for a perp.
//
// /api/markets/bars covers the securities catalog from Alpaca, CoinGecko and
// Yahoo, and none of the three carries a Binance perpetual — which is why the
// chart read "No source returned bars for HEMIUSDT". That route now delegates
// here for perp symbols rather than growing a fourth provider inline, because
// this one has to live in a different region than the rest of it.
//
// The registry is the allowlist: an arbitrary symbol cannot be proxied at
// Binance through this endpoint.

type Tf = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";

/**
 * Timeframe to Binance's interval/limit pair.
 *
 * Chosen so each window lands between roughly 100 and 400 candles: fewer looks
 * sparse on a 440px chart, more is wasted bytes the renderer downsamples away.
 */
const TF: Record<Tf, { interval: string; limit: number }> = {
  "1D": { interval: "5m", limit: 288 },
  "1W": { interval: "1h", limit: 168 },
  "1M": { interval: "4h", limit: 180 },
  "3M": { interval: "12h", limit: 180 },
  "1Y": { interval: "1d", limit: 365 },
  ALL: { interval: "1w", limit: 500 },
};

/** A Binance kline row: [openTime, open, high, low, close, volume, …]. */
type Kline = [number, string, string, string, string, string, ...unknown[]];

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "markets.perpBars", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const spec = perpBySymbol(symbol);
  if (!spec) return NextResponse.json({ error: "unknown_symbol" }, { status: 404 });

  const tfParam = (req.nextUrl.searchParams.get("tf") ?? "1M") as Tf;
  const tf = TF[tfParam] ?? TF["1M"];

  let rows: Kline[];
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${spec.symbol}&interval=${tf.interval}&limit=${tf.limit}`,
      { signal: AbortSignal.timeout(10_000), cache: "no-store" }
    );
    if (!res.ok) {
      // 451 here is the region restriction reasserting itself — worth naming,
      // because the alternative is a chart that is empty for no stated reason.
      return NextResponse.json(
        {
          error: "provider_unavailable",
          detail:
            res.status === 451
              ? "Binance refused this region (451). This route must run outside a restricted jurisdiction."
              : `Binance returned HTTP ${res.status}.`,
        },
        { status: 502 }
      );
    }
    rows = (await res.json()) as Kline[];
  } catch {
    return NextResponse.json({ error: "provider_unreachable" }, { status: 502 });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "no_history" }, { status: 404 });
  }

  // A candle with a non-positive price is dropped rather than plotted. One zero
  // in a series rescales the whole axis and makes every other candle unreadable.
  const candles = rows
    .map((r) => {
      const [t, o, h, l, c] = r;
      const open = num(o), high = num(h), low = num(l), close = num(c);
      if (open === null || high === null || low === null || close === null) return null;
      return { time: Math.floor(t / 1000), open, high, low, close };
    })
    .filter((c): c is { time: number; open: number; high: number; low: number; close: number } => c !== null);

  if (candles.length === 0) return NextResponse.json({ error: "no_history" }, { status: 404 });

  return NextResponse.json(
    { symbol: spec.symbol, tf: tfParam, source: "binance-futures", candles },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
  );
}
