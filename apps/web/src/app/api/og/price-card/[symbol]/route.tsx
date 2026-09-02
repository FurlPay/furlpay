import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { CARD_ASSETS, getPriceCardData, type CardSymbol } from "@/lib/priceCards/data";
import {
  COLORS, DASH, changeColor, formatCompactUsd, formatLevel, formatPct, formatUsd, sparklinePath,
} from "@/lib/priceCards/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/og/price-card/[symbol] — the chart card image inside the embed.
//
// ── WHY AN IMAGE AT ALL ────────────────────────────────────────────────────
//
// Discord's native embed can do the header, the price and the six statistics:
// three inline fields per row is exactly the layout the design calls for. What
// it cannot do is a chart, a per-metric panel with its own background, or any
// control over type scale. So the card splits along that line — the embed
// renders what embeds render well, and this image renders the rest.
//
// Rendered with next/og, which is Satori plus a WASM rasteriser and ships with
// Next. No node-canvas, no headless browser, no native module that would have
// to build on the deploy target.
//
// ── SATORI CONSTRAINTS THAT SHAPE THIS FILE ────────────────────────────────
//
// Every element needs an explicit `display: flex`; there is no block layout and
// a bare div with two children silently stacks them wrong. There is no CSS
// grid, no `gap` shorthand in some versions, and no external stylesheet. The
// chart is an inline SVG because Satori rasterises SVG faithfully and doing it
// in divs would mean a bar chart pretending to be a line.
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ symbol: string }> }
) {
  // Public, unauthenticated, and expensive: each miss fetches market data and
  // rasterises a PNG. The middleware baseline only limits mutating methods, so
  // without this a GET can be scraped without bound.
  const limited = await rateLimitOr429(req, "og.priceCard", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { symbol } = await props.params;
  const key = decodeURIComponent(symbol).toUpperCase() as CardSymbol;
  if (!(key in CARD_ASSETS)) {
    return new Response("Unknown symbol", { status: 404 });
  }

  const data = (await getPriceCardData([key])).get(key);
  if (!data) {
    // No price means no card. Better a 503 the caller can skip than a card
    // reading $0.00, which is a claim about the market.
    return new Response("No market data", { status: 503 });
  }

  const W = 760;
  const H = 420;
  const CHART_W = 700;
  const CHART_H = 190;

  const spark = sparklinePath(data.sparkline, CHART_W, CHART_H, 6);
  const negative = (data.changePct24h ?? 0) < 0;
  const lineColor = negative ? COLORS.negative : COLORS.positive;
  const chg = data.changePct24h;

  // Points for an index, dollars for anything you can buy one of.
  const price = (n: number | null) => (data.unit === "points" ? formatLevel(n) : formatUsd(n));

  const metrics: { label: string; value: string; color: string }[] = [
    { label: "1h", value: formatPct(data.changePct1h), color: changeColor(data.changePct1h) },
    { label: "7d", value: formatPct(data.changePct7d), color: changeColor(data.changePct7d) },
    { label: "Volume 24h", value: formatCompactUsd(data.volume24h), color: COLORS.text },
    { label: "Market cap", value: formatCompactUsd(data.marketCap), color: COLORS.text },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: W, height: H, display: "flex", flexDirection: "column",
          background: COLORS.chartBg, padding: 22,
          fontFamily: "sans-serif", color: COLORS.text,
        }}
      >
        {/* Header: name and pair on the left, price and change on the right. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{
                width: 10, height: 10, borderRadius: 5,
                background: data.accent, marginRight: 9, display: "flex",
              }} />
              <span style={{ fontSize: 25, fontWeight: 700, letterSpacing: 0.6 }}>
                {data.name.toUpperCase()}
              </span>
            </div>
            <span style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 5, marginLeft: 19 }}>
              {data.pair}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 42, fontWeight: 700, lineHeight: 1 }}>
              {price(data.price)}
            </span>
            <div style={{ display: "flex", alignItems: "center", marginTop: 7 }}>
              {/* The direction marker is DRAWN, not typed. Satori's default
                  font has no glyph for the triangles the design uses, so a
                  literal "▼" rasterises as a tofu box. */}
              {chg !== null && (
                <svg width="9" height="9" viewBox="0 0 10 10" style={{ marginRight: 6 }}>
                  <polygon
                    points={chg < 0 ? "0,2 10,2 5,9" : "0,8 10,8 5,1"}
                    fill={changeColor(chg)}
                  />
                </svg>
              )}
              <span style={{ fontSize: 15, fontWeight: 600, color: changeColor(chg) }}>
                {chg === null ? DASH : `${Math.abs(chg).toFixed(2)}%`}
              </span>
              <span style={{ fontSize: 13, color: COLORS.textMuted, marginLeft: 8 }}>24h</span>
            </div>
          </div>
        </div>

        {/* Chart panel. */}
        <div style={{
          display: "flex", marginTop: 16, borderRadius: 10,
          background: COLORS.bg, border: `1px solid ${COLORS.border}`,
          padding: 8, position: "relative",
        }}>
          {spark ? (
            <svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
              <defs>
                <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.34" />
                  <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {/* Very faint horizontal rules. Bright grid lines would compete
                  with the price line, which is the only thing worth reading. */}
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1="0" y1={CHART_H * f} x2={CHART_W} y2={CHART_H * f}
                  stroke={COLORS.border} strokeWidth="1" />
              ))}
              <path d={spark.area} fill="url(#fill)" />
              <path d={spark.line} fill="none" stroke={lineColor} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={spark.lastX} cy={spark.lastY} r="4" fill={lineColor} />
              <circle cx={spark.lastX} cy={spark.lastY} r="7.5" fill={lineColor} fillOpacity="0.22" />
            </svg>
          ) : (
            <div style={{
              display: "flex", width: CHART_W, height: CHART_H,
              alignItems: "center", justifyContent: "center",
              color: COLORS.textMuted, fontSize: 14,
            }}>
              No price history available
            </div>
          )}

          {/* Range labels, positioned over the panel rather than on an axis:
              the reference has no axis furniture at all. */}
          {spark && (
            <div style={{
              display: "flex", position: "absolute", top: 16, left: 18,
              background: "rgba(24,26,31,0.82)", borderRadius: 5, padding: "3px 7px",
            }}>
              <span style={{ fontSize: 11, color: COLORS.textSecondary }}>
                {data.sparklineLabel} high {price(spark.max)}
              </span>
            </div>
          )}
          {spark && (
            <div style={{
              display: "flex", position: "absolute", bottom: 14, left: 18,
              background: "rgba(24,26,31,0.82)", borderRadius: 5, padding: "3px 7px",
            }}>
              <span style={{ fontSize: 11, color: COLORS.textSecondary }}>
                {data.sparklineLabel} low {price(spark.min)}
              </span>
            </div>
          )}
        </div>

        {/* Metric strip: tiny label, larger value beneath. */}
        <div style={{ display: "flex", marginTop: 14, justifyContent: "space-between" }}>
          {metrics.map((m) => (
            <div key={m.label} style={{
              display: "flex", flexDirection: "column", width: 168,
              background: COLORS.panel, border: `1px solid ${COLORS.border}`,
              borderRadius: 8, padding: "8px 11px",
            }}>
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>{m.label}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: m.color, marginTop: 3 }}>
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        // Matches the data cache: a card regenerated within the minute is the
        // same card, and Discord re-fetches attachments on its own schedule.
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    }
  );
}
