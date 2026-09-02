import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { cachedJson, BROWSER_UA } from "@/lib/markets/providers/cache";
import { COLORS, DASH, changeColor, sparklinePath } from "@/lib/priceCards/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/og/market-brief — the chart strip for the daily market brief.
//
// The brief itself is a text post: monospace tables, ASCII sparklines and a
// sentence per finding with its measurement attached. That format is doing real
// work — it is readable on mobile, selectable, and survives being quoted. This
// image does not replace it; it sits above it and shows the shape of the day,
// which a six-character ASCII sparkline can only gesture at.
//
// ── WHY THIS DOES NOT CALL buildBrief() ────────────────────────────────────
//
// `buildBrief()` runs a screener across thousands of symbols to rank movers and
// count breadth. Rendering an image is not a reason to do that: this route
// fetches exactly the six series it draws, cached, which is roughly a hundredth
// of the work. The numbers still come from the same provider and the same
// symbols the brief uses, so the image and the text below it agree.
//
// ── CACHE BUSTING ──────────────────────────────────────────────────────────
//
// Discord caches an embed image by URL and will happily show yesterday's chart
// forever. The brief passes ?d=<sessionDate>, which changes daily and makes
// each day's image a distinct URL.
const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

const INDICES = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^IXIC", label: "NASDAQ" },
  { symbol: "^DJI", label: "DOW" },
] as const;

const CRYPTO = [
  { symbol: "BTC-USD", label: "BTC" },
  { symbol: "ETH-USD", label: "ETH" },
  { symbol: "SOL-USD", label: "SOL" },
] as const;

interface Series {
  label: string;
  price: number | null;
  changePct: number | null;
  closes: number[];
}

/** One intraday series. Five days at 30-minute bars: enough shape to be worth
 *  drawing, short enough that the day's move is still legible. */
async function fetchSeries(symbol: string, label: string): Promise<Series> {
  const got = await cachedJson<Series>(
    `brief:og:v1:${symbol}`,
    300,
    async () => {
      try {
        const res = await fetch(
          `${CHART}/${encodeURIComponent(symbol)}?range=5d&interval=30m`,
          { headers: BROWSER_UA, signal: AbortSignal.timeout(10_000), cache: "no-store" }
        );
        if (!res.ok) return null;
        const j = (await res.json()) as {
          chart?: { result?: { meta?: Record<string, number>; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
        };
        const r = j.chart?.result?.[0];
        const closes = (r?.indicators?.quote?.[0]?.close ?? []).filter(
          (c): c is number => typeof c === "number" && Number.isFinite(c)
        );
        const m = r?.meta ?? {};
        const price = typeof m.regularMarketPrice === "number" ? m.regularMarketPrice : null;
        // chartPreviousClose is the close before the START of the window, and
        // this window is five days — so the daily change comes from the prior
        // session, not from that field. Same trap that put NVIDIA at +24.84%.
        const prev = typeof m.previousClose === "number" ? m.previousClose : null;
        return {
          label,
          price,
          changePct: price !== null && prev !== null && prev > 0 ? (price / prev - 1) * 100 : null,
          closes,
        };
      } catch {
        return null;
      }
    }
  );
  return got ?? { label, price: null, changePct: null, closes: [] };
}

const fmtLevel = (n: number | null): string =>
  n === null ? DASH : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 });

/** The change, with its direction DRAWN rather than typed.
 *
 * Satori's default font has no glyph for the triangles, so a literal "▲"
 * rasterises as a tofu box -- the same defect the price card hit. */
function Change({ n, size = 14 }: { n: number | null; size?: number }) {
  const col = changeColor(n);
  if (n === null) {
    return <span style={{ fontSize: size, fontWeight: 600, color: col }}>{DASH}</span>;
  }
  const t = Math.round(size * 0.62);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <svg width={t} height={t} viewBox="0 0 10 10" style={{ marginRight: Math.round(size * 0.28) }}>
        <polygon points={n < 0 ? "0,2 10,2 5,9" : "0,8 10,8 5,1"} fill={col} />
      </svg>
      <span style={{ fontSize: size, fontWeight: 600, color: col }}>
        {Math.abs(n).toFixed(2)}%
      </span>
    </div>
  );
}

export async function GET(req: NextRequest) {
  // Public and unauthenticated: six upstream series and a rasterise per miss.
  const limited = await rateLimitOr429(req, "og.marketBrief", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const [indices, crypto] = await Promise.all([
    Promise.all(INDICES.map((i) => fetchSeries(i.symbol, i.label))),
    Promise.all(CRYPTO.map((c) => fetchSeries(c.symbol, c.label))),
  ]);

  const W = 900;
  const H = 400;
  const PANEL_W = 276;
  const PANEL_CHART_W = 244;
  const PANEL_CHART_H = 96;

  const Panel = ({ s }: { s: Series }) => {
    const spark = sparklinePath(s.closes, PANEL_CHART_W, PANEL_CHART_H, 4);
    const col = changeColor(s.changePct);
    return (
      <div style={{
        display: "flex", flexDirection: "column", width: PANEL_W,
        background: COLORS.panel, border: `1px solid ${COLORS.border}`,
        borderRadius: 10, padding: 14,
      }}>
        <span style={{ fontSize: 12, color: COLORS.textMuted, letterSpacing: 0.5 }}>
          {s.label}
        </span>
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 4 }}>
          <span style={{ fontSize: 26, fontWeight: 700 }}>{fmtLevel(s.price)}</span>
          <div style={{ display: "flex", marginLeft: 10 }}>
            <Change n={s.changePct} size={14} />
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 10 }}>
          {spark ? (
            <svg width={PANEL_CHART_W} height={PANEL_CHART_H} viewBox={`0 0 ${PANEL_CHART_W} ${PANEL_CHART_H}`}>
              <defs>
                <linearGradient id={`g${s.label.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={col} stopOpacity="0.30" />
                  <stop offset="100%" stopColor={col} stopOpacity="0.02" />
                </linearGradient>
              </defs>
              <path d={spark.area} fill={`url(#g${s.label.replace(/\W/g, "")})`} />
              <path d={spark.line} fill="none" stroke={col} strokeWidth="1.8"
                strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={spark.lastX} cy={spark.lastY} r="3.2" fill={col} />
            </svg>
          ) : (
            <div style={{
              display: "flex", width: PANEL_CHART_W, height: PANEL_CHART_H,
              alignItems: "center", justifyContent: "center",
              fontSize: 12, color: COLORS.textMuted,
            }}>
              no series
            </div>
          )}
        </div>
      </div>
    );
  };

  return new ImageResponse(
    (
      <div style={{
        width: W, height: H, display: "flex", flexDirection: "column",
        background: COLORS.chartBg, padding: 24,
        fontFamily: "sans-serif", color: COLORS.text,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 0.4 }}>
            FurlPay Daily Market Brief
          </span>
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>
            {new Date().toUTCString().slice(0, 16)}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          {indices.map((s) => <Panel key={s.label} s={s} />)}
        </div>

        {/* Crypto strip. Same three the brief carries below. */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          {crypto.map((c) => {
            const spark = sparklinePath(c.closes, 232, 34, 2);
            const col = changeColor(c.changePct);
            return (
              <div key={c.label} style={{
                display: "flex", alignItems: "center", width: PANEL_W,
                background: COLORS.panel, border: `1px solid ${COLORS.border}`,
                borderRadius: 8, padding: "9px 12px",
              }}>
                <div style={{ display: "flex", flexDirection: "column", width: 108 }}>
                  <span style={{ fontSize: 11, color: COLORS.textMuted }}>{c.label}</span>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{fmtLevel(c.price)}</span>
                  <div style={{ display: "flex" }}>
                    <Change n={c.changePct} size={11} />
                  </div>
                </div>
                <div style={{ display: "flex" }}>
                  {spark && (
                    <svg width="120" height="34" viewBox="0 0 120 34">
                      <path
                        d={sparklinePath(c.closes, 120, 34, 2)!.line}
                        fill="none" stroke={col} strokeWidth="1.5"
                        strokeLinejoin="round" strokeLinecap="round"
                      />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", marginTop: "auto" }}>
          <span style={{ fontSize: 10.5, color: COLORS.textMuted }}>
            Yahoo Finance (delayed) · intraday, 5 days at 30-minute bars · not investment advice
          </span>
        </div>
      </div>
    ),
    { width: W, height: H, headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } }
  );
}
