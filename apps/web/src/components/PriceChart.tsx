"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { CandlestickChart, LineChart } from "lucide-react";
import { generateSeries, TIMEFRAMES, type Timeframe } from "@/lib/chartData";

// Dual-mode price chart (TradingView lightweight-charts v5): area ⇄ candlestick
// with a 1D–ALL timeframe selector and crosshair scrubbing that reports the
// hovered value/change to the parent — the pattern INDmoney and Robinhood use.
//
// Pass `symbol` to load REAL OHLC history from /api/markets/bars (Alpaca ->
// Yahoo -> CoinGecko).
//
// The synthetic series exists for the shapes that have no market history to
// fetch: a net-worth line, an empty-state card, a decorative background. It is
// a seeded random walk ending at `endValue` — stable across reloads and
// entirely invented.
//
// `allowSynthetic={false}` forbids that substitution, and every market surface
// must pass it. A random walk drawn under a real ticker is indistinguishable
// from a price history: it has the right shape, the right end point and the
// right volatility, and a reader scrubbing it reads off levels that never
// traded. Where history is genuinely missing, the chart says so.

const UP = "#00E599";
const DOWN = "#FF3B30";

interface Candle { time: number; open: number; high: number; low: number; close: number }
interface SeriesData {
  line: { time: number; value: number }[];
  candles: Candle[];
  first: number;
  last: number;
  changeAbs: number;
}

export default function PriceChart({
  seed,
  endValue,
  symbol,
  height = 240,
  defaultTf = "1M",
  defaultMode = "area",
  prefix = "$",
  allowSynthetic = true,
}: {
  seed: string;
  endValue: number;
  /** Catalog symbol — enables real market history. */
  symbol?: string;
  height?: number;
  defaultTf?: Timeframe;
  defaultMode?: "area" | "candles";
  prefix?: string;
  /** False on market surfaces: render "unavailable" rather than invent a line. */
  allowSynthetic?: boolean;
}) {
  const [tf, setTf] = useState<Timeframe>(defaultTf);
  const [mode, setMode] = useState<"area" | "candles">(defaultMode);
  const [hover, setHover] = useState<number | null>(null);
  const [real, setReal] = useState<SeriesData | null>(null);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area" | "Candlestick"> | null>(null);

  // Real history when a symbol is given; synthetic otherwise / on failure.
  useEffect(() => {
    setReal(null);
    if (!symbol) return;
    let stale = false;
    setLoading(true);
    fetch(`/api/markets/bars?symbol=${encodeURIComponent(symbol)}&tf=${tf}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { candles: Candle[] }) => {
        if (stale || !j.candles?.length) return;
        const candles = j.candles;
        setReal({
          candles,
          line: candles.map((c) => ({ time: c.time, value: c.close })),
          first: candles[0].open || candles[0].close,
          last: candles[candles.length - 1].close,
          changeAbs: candles[candles.length - 1].close - (candles[0].open || candles[0].close),
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [symbol, tf]);

  const synthetic = useMemo(() => generateSeries(seed, tf, endValue), [seed, tf, endValue]);
  // On a market surface the fallback is refused, not silently swapped in. Until
  // real bars arrive `data` is null and the canvas stays empty, which is the
  // honest rendering of "we do not have this history".
  const data: SeriesData | null = real ?? (allowSynthetic ? synthetic : null);
  const unavailable = !data && !loading;
  const up = (data?.changeAbs ?? 0) >= 0;
  const color = up ? UP : DOWN;

  // Header shows the hovered point while scrubbing, else the latest value.
  const shownValue = hover ?? data?.last ?? null;
  const shownChangeAbs = shownValue !== null && data ? shownValue - data.first : null;
  const shownChangePct =
    shownChangeAbs !== null && data && data.first !== 0
      ? (shownChangeAbs / data.first) * 100
      : null;
  const shownUp = (shownChangeAbs ?? 0) >= 0;

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8E8E93",
        fontFamily: "Inter, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "rgba(255,255,255,0.25)", width: 1, style: 3, labelVisible: false },
        horzLine: { color: "rgba(255,255,255,0.25)", width: 1, style: 3, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !seriesRef.current) {
        setHover(null);
        return;
      }
      const d = param.seriesData.get(seriesRef.current) as
        | { value?: number; close?: number }
        | undefined;
      const v = d?.value ?? d?.close;
      setHover(typeof v === "number" ? v : null);
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  // (Re)build the series when the mode or data changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }
    if (!data) return;
    if (mode === "candles") {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderVisible: false,
        wickUpColor: UP,
        wickDownColor: DOWN,
      });
      s.setData(data.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
      seriesRef.current = s;
    } else {
      const s = chart.addSeries(AreaSeries, {
        lineColor: color,
        topColor: `${color}44`,
        bottomColor: "rgba(0,0,0,0)",
        lineWidth: 2,
        priceLineVisible: false,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: color,
        crosshairMarkerBackgroundColor: color,
      });
      s.setData(data.line.map((p) => ({ ...p, time: p.time as UTCTimestamp })));
      seriesRef.current = s;
    }
    chart.timeScale().fitContent();
  }, [mode, data, color]);

  return (
    <div>
      {/* Value + change header (updates on scrub) */}
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <p className="text-[28px] font-extrabold leading-none tracking-tighter">
            {shownValue === null
              ? "—"
              : prefix +
                shownValue.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
          </p>
          {shownChangeAbs !== null && shownChangePct !== null ? (
            <p className={`mt-1 text-[13px] font-semibold ${shownUp ? "text-gain" : "text-loss"}`}>
              {shownUp ? "▲" : "▼"} {prefix}
              {Math.abs(shownChangeAbs).toLocaleString("en-US", { maximumFractionDigits: 2 })} (
              {shownUp ? "+" : ""}
              {shownChangePct.toFixed(2)}%) · {tf}
            </p>
          ) : (
            <p className="mt-1 text-[13px] font-semibold text-textMuted">
              {loading ? "Loading…" : "No history"} · {tf}
            </p>
          )}
        </div>
        <button
          onClick={() => setMode((m) => (m === "area" ? "candles" : "area"))}
          aria-label={mode === "area" ? "Switch to candlestick" : "Switch to line"}
          className="tap flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-textSecondary transition-colors hover:text-white"
        >
          {mode === "area" ? <CandlestickChart className="h-5 w-5" /> : <LineChart className="h-5 w-5" />}
        </button>
      </div>

      {/* Chart canvas. The container is always mounted — lightweight-charts
          binds to it on first render — and the unavailable notice sits over it
          rather than replacing it. */}
      <div className="relative w-full" style={{ height }}>
        <div ref={containerRef} className="h-full w-full" />
        {unavailable && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-white/[0.02] text-center">
            <p className="text-[13px] font-semibold text-textSecondary">
              Price history unavailable
            </p>
            <p className="max-w-[240px] text-[11px] leading-relaxed text-textMuted">
              No source returned bars for {symbol ?? "this asset"} over {tf}.
            </p>
          </div>
        )}
      </div>

      {/* Timeframe selector */}
      <div className="mt-3 flex items-center justify-between rounded-full border border-white/[0.06] bg-white/[0.03] p-1">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={`flex-1 rounded-full py-1.5 text-[12px] font-semibold transition-colors ${
              tf === t ? "bg-white/[0.08] text-white" : "text-textSecondary hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
