import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { compactMoney } from "@/lib/market";
import type { BarsResponse, Candle, MarketDetail } from "@/lib/types";
import { ErrorPanel, SkeletonPage, openSite, send, usd } from "./shared";

// ---------------------------------------------------------------------------
// In-popup asset detail. Opening a stock used to punch the user out to a new
// browser tab, which loses the popup entirely — a wallet should be able to
// answer "how is STX doing" without navigating away.
//
// Candles are REAL OHLC from /api/markets/bars (Alpaca for equities, CoinGecko
// for crypto). Unlike the portfolio card, these are absolute prices, so nothing
// is normalized or rescaled here — what you see is the provider's series.
// ---------------------------------------------------------------------------

const TIMEFRAMES = ["1D", "1W", "1M", "3M", "1Y"] as const;
type Tf = (typeof TIMEFRAMES)[number];

export default function AssetDetail({
  symbol,
  baseUrl,
  onBack,
  onSelect,
}: {
  symbol: string;
  baseUrl: string;
  onBack: () => void;
  onSelect: (symbol: string) => void;
}) {
  const [detail, setDetail] = useState<MarketDetail | null>(null);
  const [bars, setBars] = useState<Candle[] | null>(null);
  const [tf, setTf] = useState<Tf>("1M");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"candle" | "line">("candle");

  const load = useCallback(() => {
    setError(null);
    send<MarketDetail>({ type: "GET_MARKET_DETAIL", symbol }).then((r) =>
      r.ok ? setDetail(r.data) : setError(r.error)
    );
  }, [symbol]);

  useEffect(load, [load]);

  // Bars reload per timeframe; null while in flight so the chart shows its own
  // skeleton instead of briefly drawing the previous asset's history.
  useEffect(() => {
    let alive = true;
    setBars(null);
    send<BarsResponse>({ type: "GET_BARS", symbol, tf }).then((r) => {
      if (!alive) return;
      setBars(r.ok && Array.isArray(r.data.candles) ? r.data.candles : []);
    });
    return () => {
      alive = false;
    };
  }, [symbol, tf]);

  if (error && !detail) return <ErrorPanel message={error} onRetry={load} />;
  if (!detail) return <SkeletonPage rows={5} label={`Loading ${symbol}…`} />;

  const { asset, quote, stats, position, related } = detail;
  const up = quote.changePct >= 0;

  return (
    <div style={{ padding: "0 14px" }}>
      <button
        className="btn-ghost"
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", marginBottom: 10, fontSize: "0.76rem" }}
        onClick={onBack}
      >
        <Icon name="chevronRight" size={13} style={{ transform: "rotate(180deg)" }} />
        Markets
      </button>

      <div className="fade-up" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div className="asset-logo" style={{ background: "transparent", width: 36, height: 36 }}>
          {baseUrl ? <img src={`${baseUrl}${asset.logo}`} alt="" width={34} height={34} style={{ borderRadius: "50%" }} /> : asset.symbol.slice(0, 2)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "1rem", letterSpacing: "-0.3px" }}>{asset.symbol}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {asset.name}
            {asset.industry ? ` · ${asset.industry}` : ""}
          </div>
        </div>
      </div>

      <div className="glass-panel fade-up" style={{ marginBottom: 12, paddingBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="balance-amount" style={{ fontSize: "1.5rem" }}>${usd(quote.price)}</div>
            <div className={up ? "gain" : "loss"} style={{ fontSize: "0.74rem", fontWeight: 700 }}>
              {up ? "+" : ""}
              {Number.isFinite(quote.changePct) ? quote.changePct.toFixed(2) : "0.00"}%
              <span style={{ color: "var(--fp-text-muted)", fontWeight: 500 }}> · {quote.live ? "live" : "cached"}</span>
            </div>
          </div>
          <button
            className="icon-btn"
            style={{ width: 24, height: 24 }}
            aria-label={mode === "candle" ? "Switch to line chart" : "Switch to candlestick chart"}
            aria-pressed={mode === "candle"}
            onClick={() => setMode(mode === "candle" ? "line" : "candle")}
          >
            <Icon name={mode === "candle" ? "activity" : "invest"} size={12} />
          </button>
        </div>

        {bars === null ? (
          <div className="skeleton" style={{ height: 86, borderRadius: 10, margin: "10px 0 6px" }} />
        ) : bars.length < 2 ? (
          <div style={{ height: 86, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.72rem", color: "var(--fp-text-muted)" }}>
            No price history for this timeframe
          </div>
        ) : (
          <PriceChart candles={bars} mode={mode} />
        )}

        <div className="seg" role="tablist" aria-label="Chart timeframe" style={{ width: "100%", marginTop: 4 }}>
          {TIMEFRAMES.map((t) => (
            <button key={t} role="tab" aria-selected={t === tf} className={t === tf ? "active" : ""} style={{ flex: 1 }} onClick={() => setTf(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {position && (
        <div className="glass-panel fade-up" style={{ marginBottom: 12, padding: 12 }}>
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-secondary)", marginBottom: 2 }}>Your position</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontWeight: 700 }}>{position.shares} shares</span>
            <span style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 600 }}>${usd(position.marketValue)}</span>
          </div>
        </div>
      )}

      <h3 className="section-title">Key stats</h3>
      <div className="glass-panel fade-up" style={{ padding: 12, marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
        <Stat label="52w high" value={stats.high52w} money />
        <Stat label="52w low" value={stats.low52w} money />
        <Stat label="Market cap" value={stats.marketCap} compact />
        <Stat label="Volume" value={stats.volume} compact />
        {asset.kind === "crypto" ? (
          <>
            <Stat label="All-time high" value={stats.athPrice} money />
            <Stat label="Supply" value={stats.circulatingSupply} compact />
          </>
        ) : (
          <>
            <Stat label="P/E ratio" value={stats.peRatio} />
            <Stat label="EPS" value={stats.eps} money />
          </>
        )}
      </div>

      {detail.digest && (
        <>
          <h3 className="section-title">Overview</h3>
          <p style={{ fontSize: "0.74rem", lineHeight: 1.55, color: "var(--fp-text-secondary)", margin: "0 0 12px" }}>{detail.digest}</p>
        </>
      )}

      {related.length > 0 && (
        <>
          <h3 className="section-title">Related</h3>
          {related.slice(0, 4).map((r) => (
            <button
              key={r.symbol}
              className="asset-row"
              style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
              onClick={() => onSelect(r.symbol)}
            >
              <div className="asset-logo" style={{ background: "transparent" }}>
                {baseUrl ? <img src={`${baseUrl}${r.logo}`} alt="" width={28} height={28} style={{ borderRadius: "50%" }} /> : r.symbol.slice(0, 2)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.84rem" }}>{r.symbol}</div>
                <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)" }}>{r.name}</div>
              </div>
              <div className={r.changePct >= 0 ? "gain" : "loss"} style={{ fontSize: "0.72rem", fontWeight: 600 }}>
                {r.changePct >= 0 ? "+" : ""}
                {Number.isFinite(r.changePct) ? r.changePct.toFixed(2) : "0.00"}%
              </div>
            </button>
          ))}
        </>
      )}

      <button className="btn-ghost" style={{ width: "100%", margin: "12px 0 4px" }} onClick={() => openSite(`/markets/${asset.symbol}`)}>
        Open full research on furlpay.com
      </button>
    </div>
  );
}

/** One stat cell. Renders "—" for absent values rather than a misleading 0 —
 *  crypto has no P/E, equities have no circulating supply. */
function Stat({ label, value, money, compact }: { label: string; value: number | null; money?: boolean; compact?: boolean }) {
  const has = value != null && Number.isFinite(value);
  const text = !has ? "—" : compact ? compactMoney(value) : money ? `$${usd(value)}` : String(Number(value).toFixed(2));
  return (
    <div>
      <div style={{ fontSize: "0.64rem", color: "var(--fp-text-muted)" }}>{label}</div>
      <div style={{ fontSize: "0.8rem", fontWeight: 600, fontFamily: "var(--fp-font-mono)" }}>{text}</div>
    </div>
  );
}

/**
 * Real-OHLC price chart. Candles carry absolute prices from the provider, so
 * the y-axis is the true price range — no normalization, no net-worth scaling
 * (that rescaling is what produced the portfolio card's bogus highs).
 */
function PriceChart({ candles, mode }: { candles: Candle[]; mode: "candle" | "line" }) {
  const W = 300;
  const H = 86;
  const PAD = 4;
  const [sel, setSel] = useState<number | null>(null);

  // Cap the drawn candles: a 1Y daily series is ~380 bars in a 300px box, which
  // renders as sub-pixel mush. Keep the most recent window instead.
  const shown = useMemo(() => (candles.length > 60 ? candles.slice(-60) : candles), [candles]);

  const lo = Math.min(...shown.map((c) => c.low));
  const hi = Math.max(...shown.map((c) => c.high));
  const span = hi - lo || 1;
  const slot = (W - PAD * 2) / shown.length;
  const bodyW = Math.max(1.5, Math.min(8, slot * 0.6));
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const cx = (i: number) => PAD + slot * (i + 0.5);

  const first = shown[0];
  const last = shown[shown.length - 1];
  const rising = last.close >= first.open;
  const active = sel !== null ? shown[Math.min(sel, shown.length - 1)] : null;

  return (
    <div className="chart-wrap" style={{ margin: "10px 0 6px" }}>
      {active && (
        <div className="chart-tip" style={{ left: `${(cx(sel!) / W) * 100}%` }}>
          <span className="tip-time">{new Date(active.time * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          ${usd(active.close)}
        </div>
      )}
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", cursor: "crosshair" }}
        role="img"
        aria-label={`Price chart, ${shown.length} periods`}
        onPointerLeave={() => setSel(null)}
      >
        {mode === "line" ? (
          <>
            <defs>
              <linearGradient id="fp-detail-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={rising ? "#00E599" : "#FF453A"} stopOpacity="0.22" />
                <stop offset="100%" stopColor={rising ? "#00E599" : "#FF453A"} stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon
              points={`${PAD},${H - PAD} ${shown.map((c, i) => `${cx(i).toFixed(1)},${y(c.close).toFixed(1)}`).join(" ")} ${W - PAD},${H - PAD}`}
              fill="url(#fp-detail-fill)"
            />
            <polyline
              points={shown.map((c, i) => `${cx(i).toFixed(1)},${y(c.close).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={rising ? "var(--fp-gain)" : "var(--fp-loss)"}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </>
        ) : (
          shown.map((c, i) => {
            const green = c.close >= c.open;
            const color = green ? "var(--fp-gain, #00E599)" : "var(--fp-loss, #FF453A)";
            const top = y(Math.max(c.open, c.close));
            const bottom = y(Math.min(c.open, c.close));
            return (
              <g key={i} onPointerEnter={() => setSel(i)} onPointerDown={() => setSel(i)}>
                <rect x={cx(i) - slot / 2} y={0} width={slot} height={H} fill="transparent" />
                <line x1={cx(i)} y1={y(c.high)} x2={cx(i)} y2={y(c.low)} stroke={color} strokeWidth="1" opacity={0.8} />
                <rect
                  x={cx(i) - bodyW / 2}
                  y={top}
                  width={bodyW}
                  height={Math.max(1, bottom - top)}
                  fill={color}
                  opacity={sel === null || sel === i ? 1 : 0.45}
                />
              </g>
            );
          })
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", color: "var(--fp-text-muted)", fontFamily: "var(--fp-font-mono)", marginTop: 3 }}>
        <span>
          L <span style={{ color: "var(--fp-loss)" }}>${usd(lo)}</span>
        </span>
        <span>
          H <span style={{ color: "var(--fp-gain)" }}>${usd(hi)}</span>
        </span>
      </div>
    </div>
  );
}
