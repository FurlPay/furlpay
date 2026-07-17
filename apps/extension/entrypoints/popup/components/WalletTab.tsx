import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encode as qrEncode } from "uqr";
import { Icon, IconName } from "@/components/icons";
import {
  CHAIN_LABELS,
  RANGES,
  RANGE_PERIOD_LABEL,
  Range,
  blendSeries,
  changePct,
  normalizeCloses,
  seriesFor,
  seriesTimes,
  sparklinePoints,
  timeLabel,
  tokenAmount,
  tokenMeta,
} from "@/lib/market";
import type { BarsResponse, Overview, PendingChallenge, RewardsSummary, TokenBalance } from "@/lib/types";
import {
  EmptyState,
  ErrorPanel,
  SkeletonPage,
  greeting,
  send,
  useCountUp,
  useNow,
  usd,
  useStoredFlag,
} from "./shared";

const QUICK_ACTIONS: { icon: IconName; label: string; path?: string; action?: "receive" }[] = [
  { icon: "send", label: "Send", path: "/payouts" },
  { icon: "receive", label: "Receive", action: "receive" },
  { icon: "swap", label: "Swap", path: "/swaps" },
  { icon: "card", label: "Card", path: "/cards" },
  { icon: "travel", label: "Travel", path: "/travel" },
  { icon: "invest", label: "Invest", path: "/investing" },
];

/** Privacy mode (Rabby-style): balances render as bullets, persisted. */
const PRIVACY_KEY = "furlpay-privacy";
const MASK = "••••.••";

export default function WalletTab({ name, onQuickAction }: { name?: string; onQuickAction: (path: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("1D");
  const [query, setQuery] = useState("");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sync, setSync] = useState<{ at: number; ms: number } | null>(null);
  const [pending, setPending] = useState(0);
  const [rewardsPts, setRewardsPts] = useState<number | null>(null);
  const [privacy, setPrivacy] = useStoredFlag(PRIVACY_KEY, false);
  const now = useNow();

  const money = (n: number) => (privacy ? MASK : usd(n));

  const load = useCallback(() => {
    setError(null);
    const t0 = performance.now();
    send<Overview>({ type: "GET_OVERVIEW" }).then((r) => {
      if (r.ok) {
        setOverview(r.data);
        setStale(false);
        setSync({ at: Date.now(), ms: Math.round(performance.now() - t0) });
      } else setError(r.error);
    });
    send<{ challenges: PendingChallenge[] }>({ type: "GET_CHALLENGES" }).then(
      (r) => r.ok && setPending(r.data.challenges.reduce((s, c) => s + c.amountUsd, 0))
    );
    send<RewardsSummary>({ type: "GET_REWARDS" }).then((r) => r.ok && setRewardsPts(r.data.points));
  }, []);

  useEffect(() => {
    // Instant paint from the background's last-known-good snapshot
    // (storage.session, written on every poll) — then refresh live.
    browser.storage.session
      .get("cachedOverview")
      .then((v) => {
        const cached = v.cachedOverview as Overview | undefined;
        if (cached) {
          setOverview((current) => current ?? cached);
          setStale(true);
        }
      })
      .catch(() => {})
      .finally(load);
  }, [load]);

  const portfolioSeries = usePortfolioSeries(overview?.tokenBalances ?? [], range);
  const portfolioChange = portfolioSeries.length ? changePct(portfolioSeries) : 0;
  const animated = useCountUp(overview?.netWorth ?? 0);

  if (error && !overview) return <ErrorPanel message={error} onRetry={load} />;
  if (!overview) return <SkeletonPage label="Loading your portfolio…" />;

  const assets = overview.tokenBalances.filter((b) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const meta = tokenMeta(b.token);
    return meta.symbol.toLowerCase().includes(q) || meta.name.toLowerCase().includes(q);
  });

  const firstName = (name ?? "").split(" ")[0];
  const last = portfolioSeries[portfolioSeries.length - 1] || 1;
  const scale = overview.netWorth / last; // normalized series → dollars
  const absChange = (last - portfolioSeries[0]) * scale;
  const syncAge = sync ? Math.max(0, Math.floor((now - sync.at) / 1000)) : null;

  return (
    <div style={{ padding: "0 14px" }}>
      {/* Greeting */}
      <div className="fade-up" style={{ margin: "2px 2px 10px" }}>
        <div style={{ fontSize: "1.02rem", fontWeight: 800, letterSpacing: "-0.3px" }}>
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </div>
        <div style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)" }}>
          You're {portfolioChange >= 0 ? "up" : "down"}{" "}
          <span className={portfolioChange >= 0 ? "gain" : "loss"} style={{ fontWeight: 700 }}>
            {Math.abs(portfolioChange).toFixed(2)}%
          </span>{" "}
          {RANGE_PERIOD_LABEL[range].toLowerCase()}
        </div>
      </div>

      {/* Portfolio card */}
      <div className="glass-panel fade-up" style={{ marginBottom: 12, paddingBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.74rem", color: "var(--fp-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            Portfolio value
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              aria-label={privacy ? "Show balances" : "Hide balances"}
              aria-pressed={privacy}
              title={privacy ? "Show balances" : "Hide balances"}
              onClick={() => setPrivacy(!privacy)}
            >
              <Icon name={privacy ? "eyeOff" : "eye"} size={12} />
            </button>
          </span>
          <div className="seg" role="tablist" aria-label="Chart range">
            {RANGES.map((r) => (
              <button key={r} role="tab" aria-selected={r === range} className={r === range ? "active" : ""} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="balance-amount" aria-live="polite">${privacy ? MASK : usd(animated)}</div>
        <div style={{ fontSize: "0.72rem", marginTop: 1 }}>
          <span style={{ color: "var(--fp-text-muted)" }}>{RANGE_PERIOD_LABEL[range]} </span>
          <span className={portfolioChange >= 0 ? "gain" : "loss"} style={{ fontWeight: 700 }}>
            {portfolioChange >= 0 ? "+" : "-"}${money(Math.abs(absChange))} ({portfolioChange >= 0 ? "+" : ""}
            {portfolioChange.toFixed(2)}%)
          </span>
        </div>
        <InteractiveChart key={range} series={portfolioSeries} range={range} scale={scale} positive={portfolioChange >= 0} />
        <div className="stat-strip">
          <div>
            <div className="stat-label">Available</div>
            <div className="stat-value">${money(overview.breakdown.crypto + overview.breakdown.fiat)}</div>
          </div>
          <div>
            <div className="stat-label">Pending</div>
            <div className="stat-value" style={{ color: pending > 0 ? "#fbbf24" : "var(--fp-text-secondary)" }}>
              ${money(pending)}
            </div>
          </div>
          <div>
            <div className="stat-label">Rewards</div>
            <div className="stat-value" style={{ color: "var(--fp-accent)" }}>
              {rewardsPts === null ? "—" : `${rewardsPts.toLocaleString("en-US")} pts`}
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="qa-grid fade-up" style={{ marginBottom: 14 }}>
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.label}
            className="qa-btn"
            onClick={() => (a.action === "receive" ? setReceiveOpen(true) : onQuickAction(a.path!))}
          >
            <span className="qa-icon">
              <Icon name={a.icon} size={19} strokeWidth={2.4} />
            </span>
            {a.label}
          </button>
        ))}
      </div>

      {/* Assets */}
      <h3 className="section-title">Assets</h3>
      {overview.tokenBalances.length > 4 && (
        <div className="search-wrap">
          <Icon name="search" size={15} />
          <input
            className="input"
            placeholder="Search assets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search assets"
          />
        </div>
      )}
      {overview.tokenBalances.length === 0 ? (
        <EmptyState
          title="No assets yet"
          actions={[
            { label: "Receive crypto", path: "/dashboard" },
            { label: "Buy crypto", path: "/markets" },
          ]}
        />
      ) : (
        assets.map((b, i) => (
          <AssetRow
            key={`${b.token}:${b.chain}`}
            token={b.token}
            chain={b.chain}
            amount={b.amount}
            usdValue={b.usdValue}
            range={range}
            delay={i * 0.03}
            privacy={privacy}
          />
        ))
      )}

      <div className="sync-line">
        <span className={`status-dot ${stale ? "status-dot--off" : "status-dot--on"}`} style={{ width: 5, height: 5 }} />
        {stale ? "Cached — refreshing…" : "Arbitrum One healthy"}
        {sync && !stale && (
          <>
            <span style={{ opacity: 0.5 }}>·</span> synced {syncAge === 0 ? "just now" : `${syncAge}s ago`}
            <span style={{ opacity: 0.5 }}>·</span> API {sync.ms} ms
          </>
        )}
        <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Refresh" onClick={load}>
          <Icon name="refresh" size={11} />
        </button>
      </div>

      {receiveOpen && <ReceiveSheet address={overview.user.safeAddress} onClose={() => setReceiveOpen(false)} />}
    </div>
  );
}

// --- Receive (in-popup, real address QR) ---------------------------------------
//
// Encodes the bare smart-account address — the compatibility-safe choice per
// wallet-vendor guidance (EIP-681 amount/token params are still unevenly
// supported across scanners, so like MetaMask/Rainbow we share address-only
// and let the sender pick the amount).

function ReceiveSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const qr = useMemo(() => qrEncode(address, { ecc: "M", border: 2 }), [address]);

  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // One <path> for all dark modules — crisp at any size.
  const cell = 4;
  const dim = qr.size * cell;
  const path = qr.data
    .flatMap((row, y) => row.map((on, x) => (on ? `M${x * cell} ${y * cell}h${cell}v${cell}h-${cell}z` : "")))
    .join("");

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Receive crypto">
        <div className="sheet-handle" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>Receive</div>
          <span className="pill pill--accent">
            <img src="/chains/arbitrum.svg" alt="" width={12} height={12} style={{ borderRadius: "50%" }} /> Arbitrum One
          </span>
        </div>

        <div className="qr-box">
          <svg width={168} height={168} viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label="Wallet address QR code">
            <rect width={dim} height={dim} fill="#fff" />
            <path d={path} fill="#0a0a0c" />
          </svg>
        </div>

        <div style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--fp-text-secondary)", marginBottom: 10 }}>
          Your FurlPay smart account
        </div>

        <div className="addr-box">
          <span style={{ flex: 1 }}>{address}</span>
          <button className="icon-btn" style={{ width: 28, height: 28, flexShrink: 0 }} aria-label="Copy address" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
        </div>
        {copied && (
          <div style={{ textAlign: "center", fontSize: "0.68rem", color: "var(--fp-accent)", marginTop: 6, fontWeight: 600 }}>
            Address copied
          </div>
        )}

        <div className="risk risk--review" style={{ margin: "12px 0" }}>
          <Icon name="security" size={15} />
          <div>
            Send only <b>Arbitrum One</b> assets (USDC, ETH, ARB…) to this address. Assets sent on other networks may be
            unrecoverable.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={copy}>
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            className="btn-primary"
            style={{ flex: 1 }}
            onClick={() => browser.tabs.create({ url: `https://arbiscan.io/address/${address}` })}
          >
            View on Arbiscan
          </button>
        </div>
      </div>
    </>
  );
}

/** Fetch real bars for one symbol; fall back to the deterministic synthetic. */
function useAssetSeries(token: string, chain: string, range: Range): number[] {
  const meta = tokenMeta(token);
  const synthetic = useMemo(
    () => seriesFor(`${token}:${chain}`, range, meta.volatility),
    [token, chain, range, meta.volatility]
  );
  const [series, setSeries] = useState(synthetic);
  useEffect(() => {
    setSeries(synthetic);
    let alive = true;
    send<BarsResponse>({ type: "GET_BARS", symbol: meta.symbol, tf: range }).then((r) => {
      if (alive && r.ok && (r.data.candles?.length ?? 0) >= 2) {
        setSeries(normalizeCloses(r.data.candles.map((c) => c.close)));
      }
    });
    return () => {
      alive = false;
    };
  }, [meta.symbol, range, synthetic]);
  return series;
}

/** Portfolio index = per-asset series (real where available) blended by USD weight. */
function usePortfolioSeries(balances: TokenBalance[], range: Range): number[] {
  const synthetic = useMemo(
    () =>
      blendSeries(
        balances.map((b) => ({
          weight: b.usdValue,
          series: seriesFor(`${b.token}:${b.chain}`, range, tokenMeta(b.token).volatility),
        }))
      ),
    [balances, range]
  );
  const [series, setSeries] = useState(synthetic);
  useEffect(() => {
    setSeries(synthetic);
    if (balances.length === 0) return;
    let alive = true;
    Promise.all(
      balances.map((b) =>
        send<BarsResponse>({ type: "GET_BARS", symbol: b.token.toUpperCase(), tf: range }).then((r) => ({
          weight: b.usdValue,
          series:
            r.ok && (r.data.candles?.length ?? 0) >= 2
              ? normalizeCloses(r.data.candles.map((c) => c.close))
              : seriesFor(`${b.token}:${b.chain}`, range, tokenMeta(b.token).volatility),
        }))
      )
    ).then((parts) => {
      if (alive) setSeries(blendSeries(parts));
    });
    return () => {
      alive = false;
    };
  }, [balances, range, synthetic]);
  return series;
}

/**
 * Interactive portfolio chart: hover/touch crosshair with time+value tooltip,
 * session high/low markers, dashed open baseline, and a time axis — the
 * Robinhood/Coinbase interaction pattern, not a decorative sparkline.
 */
function InteractiveChart({ series, range, scale, positive }: { series: number[]; range: Range; scale: number; positive: boolean }) {
  const W = 316;
  const H = 72;
  const PAD = 3;
  const [idx, setIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const times = useMemo(() => seriesTimes(range, series.length), [range, series.length]);
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const color = positive ? "var(--fp-accent)" : "var(--fp-loss)";
  const hiIdx = series.indexOf(max);
  const loIdx = series.indexOf(min);
  const baseline = y(series[0]);

  const fromEvent = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setIdx(Math.round(frac * (series.length - 1)));
  };

  const active = idx !== null ? Math.min(idx, series.length - 1) : null;

  return (
    <div className="chart-wrap" style={{ margin: "8px 0 6px" }}>
      {active !== null && (
        <div className="chart-tip" style={{ left: `${(x(active) / W) * 100}%` }}>
          <span className="tip-time">{timeLabel(times[active], range)}</span>${usd(series[active] * scale)}
        </div>
      )}
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", cursor: "crosshair" }}
        onPointerMove={fromEvent}
        onPointerDown={fromEvent}
        onPointerLeave={() => setIdx(null)}
      >
        <defs>
          <linearGradient id="fp-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={positive ? "#00E599" : "#FF453A"} stopOpacity="0.22" />
            <stop offset="100%" stopColor={positive ? "#00E599" : "#FF453A"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Open baseline */}
        <line x1={PAD} y1={baseline} x2={W - PAD} y2={baseline} stroke="var(--fp-border-glass)" strokeWidth="1" strokeDasharray="3 4" />
        <polygon points={`${PAD},${H - PAD} ${pts} ${W - PAD},${H - PAD}`} fill="url(#fp-chart-fill)" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        {/* Session high / low */}
        <circle cx={x(hiIdx)} cy={y(max)} r="2" fill="var(--fp-gain)" />
        <circle cx={x(loIdx)} cy={y(min)} r="2" fill="var(--fp-loss)" />
        {/* Crosshair */}
        {active !== null && (
          <>
            <line x1={x(active)} y1={PAD} x2={x(active)} y2={H - PAD} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
            <circle cx={x(active)} cy={y(series[active])} r="3.5" fill={color} stroke="var(--fp-bg-primary)" strokeWidth="1.5" />
          </>
        )}
      </svg>
      <div className="chart-axis" aria-hidden="true">
        <span>{timeLabel(times[0], range)}</span>
        <span>{timeLabel(times[Math.floor(times.length / 2)], range)}</span>
        <span>{timeLabel(times[times.length - 1], range)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", color: "var(--fp-text-muted)", fontFamily: "var(--fp-font-mono)", marginTop: 3 }}>
        <span>
          L <span style={{ color: "var(--fp-loss)" }}>${usd(min * scale)}</span>
        </span>
        <span>
          H <span style={{ color: "var(--fp-gain)" }}>${usd(max * scale)}</span>
        </span>
      </div>
    </div>
  );
}

function AssetRow({ token, chain, amount, usdValue, range, delay, privacy }: { token: string; chain: string; amount: number; usdValue: number; range: Range; delay: number; privacy: boolean }) {
  const meta = tokenMeta(token);
  const series = useAssetSeries(token, chain, range);
  const change = changePct(series);
  // Stablecoins hold their peg: flat gray spark + neutral change, so rows
  // don't all wear the same green sawtooth.
  const stable = Math.abs(change) < 0.15;
  const sparkColor = stable ? "var(--fp-text-muted)" : change >= 0 ? "var(--fp-gain)" : "var(--fp-loss)";
  return (
    <div className="asset-row fade-up" style={{ animationDelay: `${delay}s` }}>
      <div className="asset-logo" style={{ background: meta.logo ? undefined : meta.color }}>
        {meta.logo ? <img src={meta.logo} alt="" /> : meta.symbol.slice(0, 2)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>{meta.name}</div>
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>
          {privacy ? "••••" : tokenAmount(amount)} {meta.symbol} · {CHAIN_LABELS[chain] ?? chain}
        </div>
      </div>
      <svg width="52" height="22" viewBox="0 0 52 22" aria-hidden="true">
        {stable ? (
          <line x1="2" y1="11" x2="50" y2="11" stroke={sparkColor} strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
        ) : (
          <polyline
            points={sparklinePoints(series, 52, 22)}
            fill="none"
            stroke={sparkColor}
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.85"
          />
        )}
      </svg>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 600, fontSize: "0.84rem" }}>
          ${privacy ? "••••.••" : usd(usdValue)}
        </div>
        <div className={stable ? "" : change >= 0 ? "gain" : "loss"} style={{ fontSize: "0.7rem", fontWeight: 600, color: stable ? "var(--fp-text-muted)" : undefined }}>
          {stable ? "0.00%" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
        </div>
      </div>
    </div>
  );
}
