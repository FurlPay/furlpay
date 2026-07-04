import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { bySymbol } from "@/lib/markets/catalog";

// GET /api/markets/bars?symbol=AAPL&tf=1M — real OHLC history for the charts.
// Equities + major crypto pairs come from Alpaca Market Data; other crypto
// falls back to CoinGecko OHLC. 404 → the client keeps its synthetic series.

type Tf = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";
interface Candle { time: number; open: number; high: number; low: number; close: number }

const ALPACA_TF: Record<Tf, { timeframe: string; days: number }> = {
  "1D": { timeframe: "5Min", days: 5 },
  "1W": { timeframe: "1Hour", days: 9 },
  "1M": { timeframe: "1Day", days: 36 },
  "3M": { timeframe: "1Day", days: 100 },
  "1Y": { timeframe: "1Week", days: 380 },
  ALL: { timeframe: "1Month", days: 3650 },
};
const CG_DAYS: Record<Tf, string> = { "1D": "1", "1W": "7", "1M": "30", "3M": "90", "1Y": "365", ALL: "max" };

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
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase();
  const tf = (req.nextUrl.searchParams.get("tf") ?? "1M") as Tf;
  const asset = bySymbol.get(symbol);
  if (!asset || !ALPACA_TF[tf]) return NextResponse.json({ error: "Unknown symbol/timeframe" }, { status: 404 });

  const cacheKey = `${symbol}:${tf}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ candles: hit.candles, source: hit.source, cached: true });
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
      // Intraday view: keep only the most recent trading day's bars.
      if (tf === "1D" && candles.length) {
        const lastDay = new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10);
        candles = candles.filter((c) => new Date(c.time * 1000).toISOString().slice(0, 10) === lastDay);
      }
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
  if (candles.length === 0 && asset.kind === "crypto" && asset.cg) {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${asset.cg}/ohlc?vs_currency=usd&days=${CG_DAYS[tf]}`,
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

  if (candles.length < 2) return NextResponse.json({ error: "No history available" }, { status: 404 });

  cache.set(cacheKey, { at: Date.now(), candles, source });
  return NextResponse.json({ candles, source });
}
