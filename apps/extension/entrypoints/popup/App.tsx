import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, IconName, LogoMark, Wordmark } from "@/components/icons";
import {
  CHAIN_LABELS,
  RANGES,
  Range,
  assessChallenge,
  blendSeries,
  changePct,
  mccLabel,
  normalizeCloses,
  seriesFor,
  sparklinePoints,
  tokenMeta,
} from "@/lib/market";
import type {
  BarsResponse,
  BgRequest,
  BgResponse,
  EarnOverview,
  Entitlements,
  Overview,
  PasskeyList,
  PendingChallenge,
  RewardsSummary,
  TokenBalance,
  Transaction,
} from "@/lib/types";

// FurlPay popup — the daily surface of the On-Chain Financial OS.
// Wallet / Activity / Approve / Earn / Settings. All data flows through the
// background worker (session-cookie API); the popup never talks to the network
// directly. Trust patterns follow 2026 wallet practice (Phantom/Rabby/Blockaid):
// pre-approval risk verdicts, outcome simulation ("what happens if you approve
// vs decline"), and skeletons over spinners.

type Tab = "wallet" | "activity" | "approvals" | "earn" | "settings";

async function send<T>(message: BgRequest): Promise<BgResponse<T>> {
  try {
    const r = (await browser.runtime.sendMessage(message)) as BgResponse<T> | undefined;
    return r ?? { ok: false, error: "No response from service worker" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const compactUsd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${usd(n)}`;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Animate a number toward its target (balance roll-up). */
function useCountUp(target: number, ms = 600): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (reducedMotion() || fromRef.current === target) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    fromRef.current = target;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/** Re-render every second (approval countdowns). */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

async function openSite(path: string) {
  const { getBaseUrl } = await import("@/lib/api");
  const base = await getBaseUrl();
  void browser.tabs.create({ url: `${base}${path}` });
}

const relTime = (iso: string | null): string => {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

// --- Root --------------------------------------------------------------------

interface SessionState {
  authenticated: boolean;
  name?: string;
  baseUrl: string;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("wallet");
  const [session, setSession] = useState<SessionState | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);

  const loadSession = useCallback(() => {
    send<SessionState>({ type: "GET_SESSION_STATE" }).then((r) =>
      setSession(r.ok ? r.data : { authenticated: false, baseUrl: "https://furlpay.com" })
    );
  }, []);

  useEffect(() => {
    loadSession();
    send<{ challenges: PendingChallenge[] }>({ type: "GET_CHALLENGES" }).then(
      (r) => r.ok && setPendingCount(r.data.challenges.length)
    );
  }, [loadSession]);

  const tabs: { id: Tab; label: string; icon: IconName; badge?: number }[] = [
    { id: "wallet", label: "Wallet", icon: "wallet" },
    { id: "activity", label: "Activity", icon: "activity" },
    { id: "approvals", label: "Approve", icon: "approve", badge: pendingCount },
    { id: "earn", label: "Earn", icon: "earn" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  const connected = session?.authenticated ?? false;

  return (
    <div style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 560 }}>
      <div className="glow-orb glow-orb--green" />
      <div className="glow-orb glow-orb--purple" />

      <header style={{ padding: "14px 14px 10px", position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 8 }}>
        <LogoMark size={26} />
        <Wordmark />
        <span className="pill" style={{ marginLeft: "auto" }}>
          <span className={`status-dot ${connected ? "status-dot--on" : "status-dot--off"}`} />
          {session === null ? "Connecting" : connected ? "Arbitrum One" : "Not connected"}
        </span>
        {connected && (
          <button className="icon-btn" aria-label="Notifications" onClick={() => setBellOpen((o) => !o)}>
            <Icon name="bell" size={17} />
            {pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
          </button>
        )}
      </header>

      {bellOpen && connected && (
        <NotificationCenter
          onClose={() => setBellOpen(false)}
          onGoApprove={() => {
            setBellOpen(false);
            setTab("approvals");
          }}
        />
      )}

      <div style={{ flex: 1, position: "relative", zIndex: 1, paddingBottom: 4 }}>
        {session === null ? (
          <SkeletonPage />
        ) : !connected ? (
          <SignedOut />
        ) : (
          <>
            {tab === "wallet" && <WalletTab onQuickAction={openSite} />}
            {tab === "activity" && <ActivityTab />}
            {tab === "approvals" && <ApprovalsTab onCount={setPendingCount} />}
            {tab === "earn" && <EarnTab />}
            {tab === "settings" && <SettingsTab session={session} onSignedOut={loadSession} />}
          </>
        )}
      </div>

      <nav aria-label="FurlPay sections" style={{ display: "flex", justifyContent: "space-around", padding: "9px 0 10px", borderTop: "1px solid var(--fp-border-glass)", position: "relative", zIndex: 2, background: "var(--fp-bg-primary)" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-label={t.label}
            aria-current={tab === t.id ? "page" : undefined}
            className="tab-btn"
            style={{ color: tab === t.id ? "var(--fp-accent)" : "var(--fp-text-muted)" }}
          >
            <Icon name={t.icon} />
            <span style={{ fontSize: "0.62rem", fontWeight: tab === t.id ? 700 : 500 }}>{t.label}</span>
            {t.badge ? <span className="nav-badge">{t.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

// --- Signed out ------------------------------------------------------------------

function SignedOut() {
  return (
    <div style={{ padding: "26px 20px", textAlign: "center" }} className="fade-up">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <LogoMark size={54} />
      </div>
      <div style={{ fontSize: "1.15rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 4 }}>
        Welcome back
      </div>
      <p style={{ fontSize: "0.82rem", color: "var(--fp-text-secondary)", margin: "0 0 18px", lineHeight: 1.5 }}>
        Sign in securely with your passkey on FurlPay. The extension picks up your session
        automatically.
      </p>

      <div className="glass-panel" style={{ textAlign: "left", padding: "12px 14px", marginBottom: 18 }}>
        {[
          { icon: "passkey" as const, text: "Passwordless — passkeys only" },
          { icon: "security" as const, text: "No keys or tokens stored in the browser" },
          { icon: "approve" as const, text: "Session synced automatically" },
        ].map((f) => (
          <div key={f.text} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
            <span style={{ color: "var(--fp-accent)", display: "flex" }}>
              <Icon name={f.icon} size={16} />
            </span>
            <span style={{ fontSize: "0.79rem", color: "var(--fp-text-secondary)" }}>{f.text}</span>
          </div>
        ))}
      </div>

      <button className="btn-primary" style={{ width: "100%" }} onClick={() => send({ type: "OPEN_LOGIN" })}>
        Open FurlPay
      </button>
      <button
        className="list-tile"
        style={{ justifyContent: "center", marginTop: 8, color: "var(--fp-text-muted)", fontSize: "0.75rem" }}
        onClick={() => openSite("/contact")}
      >
        Need help?
      </button>
    </div>
  );
}

// --- Wallet ------------------------------------------------------------------

const QUICK_ACTIONS: { icon: IconName; label: string; path: string }[] = [
  { icon: "send", label: "Send", path: "/payouts" },
  { icon: "receive", label: "Receive", path: "/dashboard" },
  { icon: "swap", label: "Swap", path: "/swaps" },
  { icon: "card", label: "Card", path: "/cards" },
  { icon: "travel", label: "Travel", path: "/travel" },
  { icon: "invest", label: "Invest", path: "/investing" },
];

function WalletTab({ onQuickAction }: { onQuickAction: (path: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("1D");
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setError(null);
    send<Overview>({ type: "GET_OVERVIEW" }).then((r) => (r.ok ? setOverview(r.data) : setError(r.error)));
  }, []);
  useEffect(load, [load]);

  const portfolioSeries = usePortfolioSeries(overview?.tokenBalances ?? [], range);
  const portfolioChange = portfolioSeries.length ? changePct(portfolioSeries) : 0;
  const animated = useCountUp(overview?.netWorth ?? 0);

  if (error) return <ErrorPanel message={error} onRetry={load} />;
  if (!overview) return <SkeletonPage />;

  const assets = overview.tokenBalances.filter((b) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const meta = tokenMeta(b.token);
    return meta.symbol.toLowerCase().includes(q) || meta.name.toLowerCase().includes(q);
  });

  return (
    <div style={{ padding: "0 14px" }}>
      {/* Portfolio card */}
      <div className="glass-panel fade-up" style={{ marginBottom: 12, paddingBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.74rem", color: "var(--fp-text-secondary)" }}>Portfolio value</span>
          <div className="seg" role="tablist" aria-label="Chart range">
            {RANGES.map((r) => (
              <button key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div className="balance-amount" aria-live="polite">${usd(animated)}</div>
          <span className={portfolioChange >= 0 ? "gain" : "loss"} style={{ fontSize: "0.78rem", fontWeight: 700 }}>
            {portfolioChange >= 0 ? "↑" : "↓"} {Math.abs(portfolioChange).toFixed(2)}%
          </span>
        </div>
        <PortfolioChart series={portfolioSeries} positive={portfolioChange >= 0} />
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>
          Crypto ${usd(overview.breakdown.crypto)} · Fiat ${usd(overview.breakdown.fiat)} · Stocks ${usd(overview.breakdown.equities)}
        </div>
      </div>

      {/* Quick actions */}
      <div className="qa-grid fade-up" style={{ marginBottom: 14 }}>
        {QUICK_ACTIONS.map((a) => (
          <button key={a.label} className="qa-btn" onClick={() => onQuickAction(a.path)}>
            <span className="qa-icon">
              <Icon name={a.icon} size={17} />
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
        assets.map((b, i) => <AssetRow key={`${b.token}:${b.chain}`} token={b.token} chain={b.chain} amount={b.amount} usdValue={b.usdValue} range={range} delay={i * 0.03} />)
      )}
    </div>
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

function PortfolioChart({ series, positive }: { series: number[]; positive: boolean }) {
  const W = 316;
  const H = 56;
  const pts = sparklinePoints(series, W, H);
  const color = positive ? "var(--fp-accent)" : "var(--fp-loss)";
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", margin: "6px 0 8px" }} aria-hidden="true">
      <defs>
        <linearGradient id="fp-chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={positive ? "#00E599" : "#FF453A"} stopOpacity="0.25" />
          <stop offset="100%" stopColor={positive ? "#00E599" : "#FF453A"} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`2,${H - 2} ${pts} ${W - 2},${H - 2}`} fill="url(#fp-chart-fill)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function AssetRow({ token, chain, amount, usdValue, range, delay }: { token: string; chain: string; amount: number; usdValue: number; range: Range; delay: number }) {
  const meta = tokenMeta(token);
  const series = useAssetSeries(token, chain, range);
  const change = changePct(series);
  return (
    <div className="asset-row fade-up" style={{ animationDelay: `${delay}s` }}>
      <div className="asset-logo" style={{ background: meta.logo ? undefined : meta.color }}>
        {meta.logo ? <img src={meta.logo} alt="" /> : meta.symbol.slice(0, 2)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>{meta.name}</div>
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>
          {amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} {meta.symbol} · {CHAIN_LABELS[chain] ?? chain}
        </div>
      </div>
      <svg width="52" height="22" viewBox="0 0 52 22" aria-hidden="true">
        <polyline
          points={sparklinePoints(series, 52, 22)}
          fill="none"
          stroke={change >= 0 ? "var(--fp-gain)" : "var(--fp-loss)"}
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.85"
        />
      </svg>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 600, fontSize: "0.84rem" }}>≈ ${usd(usdValue)}</div>
        <div className={change >= 0 ? "gain" : "loss"} style={{ fontSize: "0.7rem", fontWeight: 600 }}>
          {change >= 0 ? "+" : ""}
          {change.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

// --- Activity ---------------------------------------------------------------------

const CATEGORY_ICONS: Record<string, IconName> = {
  card: "card",
  travel: "travel",
  x402: "code",
  transfer: "send",
  swap: "swap",
  invest: "invest",
  earn: "earn",
};

function ActivityTab() {
  const [txs, setTxs] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    send<{ transactions: Transaction[] }>({ type: "GET_TRANSACTIONS" }).then((r) =>
      r.ok ? setTxs(r.data.transactions) : setError(r.error)
    );
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorPanel message={error} onRetry={load} />;
  if (!txs) return <SkeletonPage rows={6} />;

  return (
    <div style={{ padding: "0 14px" }}>
      <h3 className="section-title">Recent activity</h3>
      {txs.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          actions={[
            { label: "Receive crypto", path: "/dashboard" },
            { label: "Buy crypto", path: "/markets" },
            { label: "Explore Travel", path: "/travel" },
          ]}
        />
      ) : (
        txs.map((tx, i) => <TxRow key={tx.id} tx={tx} delay={Math.min(i * 0.03, 0.3)} />)
      )}
    </div>
  );
}

function TxRow({ tx, delay }: { tx: Transaction; delay: number }) {
  const declined = tx.status === "declined";
  const icon = CATEGORY_ICONS[tx.category] ?? (tx.direction === "in" ? "receive" : "send");
  return (
    <div className="tx-row fade-up" style={{ animationDelay: `${delay}s` }}>
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 11,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          background: declined ? "rgba(255,69,58,0.1)" : "var(--fp-accent-soft)",
          color: declined ? "var(--fp-loss)" : "var(--fp-accent)",
        }}
      >
        <Icon name={icon} size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.title}</div>
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>{tx.subtitle}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 600, fontSize: "0.84rem", color: declined ? "var(--fp-loss)" : "var(--fp-text-primary)" }}>
          {tx.direction === "in" ? "+" : "-"}${usd(tx.amountUsd)}
        </div>
        <div style={{ fontSize: "0.66rem", color: declined ? "var(--fp-loss)" : "var(--fp-accent)" }}>
          {declined ? "Declined" : tx.status === "settled" ? "Settled" : tx.status}
        </div>
      </div>
    </div>
  );
}

// --- Approvals (3DS2 OOB) — the fear moment, designed first --------------------

function ApprovalsTab({ onCount }: { onCount: (n: number) => void }) {
  const [challenges, setChallenges] = useState<PendingChallenge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(() => {
    send<{ challenges: PendingChallenge[] }>({ type: "GET_CHALLENGES" }).then((r) => {
      if (r.ok) {
        setChallenges(r.data.challenges);
        onCount(r.data.challenges.length);
        setError(null);
      } else setError(r.error);
    });
  }, [onCount]);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <ErrorPanel message={error} onRetry={load} />;
  if (!challenges) return <SkeletonPage rows={2} />;

  const live = challenges.filter((c) => new Date(c.expiresAt).getTime() > now);

  return (
    <div style={{ padding: "0 14px" }}>
      <h3 className="section-title">Waiting for your approval</h3>
      {live.length === 0 && (
        <EmptyState
          title="Nothing waiting for approval"
          subtitle="When a card payment needs you, it appears here and as a notification."
          actions={[{ label: "View cards", path: "/cards" }]}
        />
      )}
      {live.map((c) => (
        <ApprovalCard
          key={c.id}
          challenge={c}
          now={now}
          busy={busy === c.id}
          anyBusy={busy !== null}
          onDecline={async () => {
            setBusy(c.id);
            const r = await send({ type: "DECLINE_CHALLENGE", challengeId: c.id });
            if (!r.ok) setError(r.error);
            setBusy(null);
            load();
          }}
          onApprove={() => send({ type: "OPEN_APPROVE", challengeId: c.id })}
        />
      ))}
      {live.length > 0 && (
        <p style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", fontSize: "0.68rem", color: "var(--fp-text-muted)", marginTop: 2 }}>
          <Icon name="security" size={13} /> Protected by FurlPay — passkeys sign on furlpay.com, spoof-proof by design.
        </p>
      )}
    </div>
  );
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // issuer window used for the countdown bar

function ApprovalCard({
  challenge: c,
  now,
  busy,
  anyBusy,
  onDecline,
  onApprove,
}: {
  challenge: PendingChallenge;
  now: number;
  busy: boolean;
  anyBusy: boolean;
  onDecline: () => void;
  onApprove: () => void;
}) {
  const left = Math.max(0, Math.floor((new Date(c.expiresAt).getTime() - now) / 1000));
  const total = Math.max(1, Math.min(CHALLENGE_TTL_MS, new Date(c.expiresAt).getTime() - new Date(c.createdAt).getTime()) / 1000);
  const urgent = left <= 60;
  const risk = assessChallenge(c);
  const category = mccLabel(c.merchant.mcc);
  const location = [c.merchant.city, c.merchant.country].filter(Boolean).join(", ");

  return (
    <div className="glass-panel fade-up" style={{ marginBottom: 12, padding: 14 }}>
      {/* Merchant + amount */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="asset-logo" style={{ width: 38, height: 38, background: "var(--fp-bg-surface)", color: "var(--fp-accent)", fontSize: "0.95rem" }}>
          {c.merchant.name.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>{c.merchant.name}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>
            {location || "Online purchase"}
            {category ? ` · ${category}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 800, fontSize: "1.05rem" }}>${usd(c.amountUsd)}</div>
          <div style={{ fontSize: "0.66rem", color: "var(--fp-text-muted)" }}>{c.currency.toUpperCase()}</div>
        </div>
      </div>

      {/* Countdown */}
      <div style={{ margin: "10px 0" }}>
        <div className="countdown-track">
          <div className={`countdown-fill${urgent ? " urgent" : ""}`} style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.66rem", color: urgent ? "var(--fp-loss)" : "var(--fp-text-muted)", marginTop: 4 }}>
          <span>
            Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
          <span>Card ····{c.cardId.slice(-4)}</span>
        </div>
      </div>

      {/* FurlPay Protect verdict */}
      <div className={`risk risk--${risk.level}`} style={{ marginBottom: 8 }}>
        <Icon name={risk.level === "safe" ? "approve" : "security"} size={15} />
        <div>
          <div style={{ fontWeight: 700 }}>{risk.label} · FurlPay Protect</div>
          <div style={{ opacity: 0.85 }}>{risk.reason}</div>
        </div>
      </div>

      {/* Outcome simulation */}
      <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        <span style={{ color: "var(--fp-accent)" }}>If approved:</span> ${usd(c.amountUsd)} charged to card ····{c.cardId.slice(-4)}.{" "}
        <span style={{ color: "var(--fp-text-secondary)" }}>If declined:</span> nothing is charged — declining is always free.
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-ghost" style={{ flex: 1 }} disabled={anyBusy} onClick={onDecline}>
          {busy ? "Declining…" : "Decline"}
        </button>
        <button className="btn-primary" style={{ flex: 1.4 }} onClick={onApprove}>
          Approve with biometric
        </button>
      </div>
    </div>
  );
}

// --- Earn ---------------------------------------------------------------------

function EarnTab() {
  const [earn, setEarn] = useState<EarnOverview | null>(null);
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    send<EarnOverview>({ type: "GET_EARN" }).then((r) => (r.ok ? setEarn(r.data) : setError(r.error)));
    send<RewardsSummary>({ type: "GET_REWARDS" }).then((r) => r.ok && setRewards(r.data));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorPanel message={error} onRetry={load} />;
  if (!earn) return <SkeletonPage rows={3} />;

  return (
    <div style={{ padding: "0 14px" }}>
      <div className="glass-panel fade-up" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <span className="qa-icon" style={{ width: 42, height: 42 }}>
          <Icon name="earn" size={20} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)" }}>Idle USDC ready to earn</div>
          <div className="balance-amount" style={{ fontSize: "1.3rem" }}>${usd(earn.idleUsdc)}</div>
        </div>
        <span className="pill pill--accent">up to {earn.bestApy.toFixed(1)}% APY</span>
      </div>

      <h3 className="section-title">Available vaults</h3>
      {earn.vaults.map((v, i) => {
        const assetSym = v.asset?.symbol ?? "USDC";
        const meta = tokenMeta(assetSym);
        return (
          <div key={v.symbol} className="asset-row fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
            <div className="asset-logo" style={{ background: meta.logo ? undefined : meta.color }}>
              {meta.logo ? <img src={meta.logo} alt="" /> : meta.symbol.slice(0, 2)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</div>
              <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>
                {assetSym}
                {typeof v.tvlUsd === "number" ? ` · TVL ${compactUsd(v.tvlUsd)}` : ""}
              </div>
            </div>
            <span className="pill pill--accent" style={{ fontFamily: "var(--fp-font-mono)" }}>{v.netApy.toFixed(1)}%</span>
            <button className="btn-ghost" style={{ padding: "6px 12px", fontSize: "0.74rem" }} onClick={() => openSite("/earn")}>
              Deposit
            </button>
          </div>
        );
      })}

      {rewards && (
        <>
          <h3 className="section-title" style={{ marginTop: 14 }}>Rewards</h3>
          <div className="glass-panel" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: "0.78rem", color: "var(--fp-text-secondary)" }}>{rewards.points} pts</span>
              <span className="pill pill--accent">{rewards.tier}</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${rewards.progressPct}%` }} />
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)", marginTop: 6 }}>
              {rewards.progressPct}% to {rewards.nextTier}
            </div>
          </div>
        </>
      )}

      <p style={{ fontSize: "0.62rem", color: "var(--fp-text-muted)", lineHeight: 1.5, marginTop: 10 }}>{earn.disclosure}</p>
    </div>
  );
}

// --- Settings -------------------------------------------------------------------

function SettingsTab({ session, onSignedOut }: { session: SessionState; onSignedOut: () => void }) {
  const [showPasskeys, setShowPasskeys] = useState(false);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div style={{ padding: "0 14px" }}>
      {/* Profile */}
      <div className="glass-panel fade-up" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: 14 }}>
        <span className="qa-icon" style={{ width: 42, height: 42, borderRadius: "50%" }}>
          <Icon name="user" size={19} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{session.name ?? "FurlPay user"}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>Session on {new URL(session.baseUrl).host}</div>
        </div>
        <button className="btn-ghost" style={{ padding: "6px 12px", fontSize: "0.74rem" }} onClick={() => openSite("/profile")}>
          Edit
        </button>
      </div>

      {/* Plan */}
      <h3 className="section-title">Plan</h3>
      <PlanPanel />

      {/* Security */}
      <h3 className="section-title">Security</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 12 }}>
        <SettingsTile icon="passkey" label="Passkeys" sub="Manage devices that control your account" onClick={() => setShowPasskeys((s) => !s)} chevron={!showPasskeys} />
        {showPasskeys && <PasskeysPanel />}
        <SettingsTile icon="approve" label="Approvals" sub="Biometric 3DS2 — approvals sign on furlpay.com" onClick={() => openSite("/cards/approve")} chevron />
        <SettingsTile icon="security" label="Security center" sub="2FA, sessions, trusted devices" onClick={() => openSite("/profile#security")} chevron />
      </div>

      {/* Preferences */}
      <h3 className="section-title">Preferences</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 12 }}>
        <StoredToggle icon="bell" storageKey="prefSecurityAlerts" label="Security alerts" sub="Notify on pending card approvals" defaultOn />
        <StoredToggle icon="invest" storageKey="prefPriceAlerts" label="Price alerts" sub="Notify on large balance moves" />
        <SettingsTile icon="globe" label="Currency & language" sub="USD · English" onClick={() => openSite("/profile")} chevron />
      </div>

      {/* Developer */}
      <h3 className="section-title">Developer</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 12 }}>
        <SettingsTile icon="code" label="x402 inspector" sub="DevTools → FurlPay x402" onClick={() => setShowDeveloper((s) => !s)} chevron={!showDeveloper} />
        {showDeveloper && <DeveloperPanel />}
      </div>

      {/* Support */}
      <h3 className="section-title">Support & legal</h3>
      <div className="glass-panel" style={{ padding: 6, marginBottom: 14 }}>
        <SettingsTile icon="help" label="Help center" sub="furlpay.com/support" onClick={() => openSite("/contact")} chevron />
        <SettingsTile icon="history" label="About FurlPay" sub={`Extension v${browser.runtime.getManifest().version}`} onClick={() => openSite("/legal/terms")} chevron />
      </div>

      <button
        className="btn-danger"
        style={{ width: "100%", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          await send({ type: "LOGOUT" });
          onSignedOut();
        }}
      >
        <Icon name="logout" size={15} /> {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

// --- Plan / entitlements -------------------------------------------------------
//
// Chrome Web Store has no billing rails, so upgrades run through Stripe
// Checkout on furlpay.com (sandbox mode upgrades instantly in dev). The
// feature map comes from /api/user/entitlements — the same source the site
// uses, so gating never drifts between surfaces.

const FEATURE_LABELS: Record<string, string> = {
  unlimited_x402: "Unlimited x402 payments",
  ai_travel_sidebar: "AI travel agent sidebar",
  fee_scanner: "Merchant fee scanner",
  cashback_tracker: "Cashback tracker",
  x402_inspector: "x402 DevTools inspector",
  api_keys: "API key management",
};

function PlanPanel() {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    send<Entitlements>({ type: "GET_ENTITLEMENTS" }).then((r) =>
      r.ok ? setEnt(r.data) : setError(r.error)
    );
  }, []);
  useEffect(load, [load]);

  if (error)
    return (
      <div className="glass-panel" style={{ marginBottom: 12, padding: 12, fontSize: "0.76rem", color: "var(--fp-text-muted)" }}>
        Plan info unavailable: {error}
      </div>
    );
  if (!ent) return <div className="skeleton" style={{ height: 60, borderRadius: 16, marginBottom: 12 }} />;

  const upgrade = async (plan: "pro" | "developer") => {
    setBusy(plan);
    await send({ type: "UPGRADE_PLAN", plan });
    setBusy(null);
    load();
  };

  return (
    <div className="glass-panel" style={{ marginBottom: 12, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>
          {ent.tier === "Standard" ? "Free plan" : `${ent.tier} plan`}
        </span>
        <span className={ent.tier === "Standard" ? "pill" : "pill pill--accent"}>{ent.plan}</span>
      </div>
      {Object.entries(FEATURE_LABELS).map(([key, label]) => {
        const on = ent.features[key];
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: "0.76rem", color: on ? "var(--fp-text-secondary)" : "var(--fp-text-muted)" }}>
            <span style={{ color: on ? "var(--fp-accent)" : "var(--fp-text-muted)", display: "flex" }}>
              <Icon name={on ? "check" : "security"} size={13} />
            </span>
            {label}
            {!on && <span className="pill" style={{ marginLeft: "auto", fontSize: "0.6rem" }}>{key === "x402_inspector" || key === "api_keys" ? "Developer" : "Pro"}</span>}
          </div>
        );
      })}
      {ent.tier !== "Ultra" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {ent.tier === "Standard" && (
            <button className="btn-primary" style={{ flex: 1, padding: "8px" }} disabled={busy !== null} onClick={() => upgrade("pro")}>
              {busy === "pro" ? "Opening…" : "Upgrade to Pro"}
            </button>
          )}
          <button className="btn-ghost" style={{ flex: 1, padding: "8px" }} disabled={busy !== null} onClick={() => upgrade("developer")}>
            {busy === "developer" ? "Opening…" : "Developer plan"}
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsTile({ icon, label, sub, onClick, chevron }: { icon: IconName; label: string; sub?: string; onClick: () => void; chevron?: boolean }) {
  return (
    <button className="list-tile" onClick={onClick}>
      <span style={{ color: "var(--fp-accent)", display: "flex" }}>
        <Icon name={icon} size={17} />
      </span>
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {sub && <div className="tile-sub">{sub}</div>}
      </span>
      {chevron && (
        <span style={{ color: "var(--fp-text-muted)", display: "flex" }}>
          <Icon name="chevronRight" size={15} />
        </span>
      )}
    </button>
  );
}

/** Toggle persisted in extension storage (local preference only). */
function StoredToggle({ icon, storageKey, label, sub, defaultOn }: { icon: IconName; storageKey: string; label: string; sub?: string; defaultOn?: boolean }) {
  const [on, setOn] = useState<boolean>(defaultOn ?? false);
  useEffect(() => {
    browser.storage.local.get(storageKey).then((v) => {
      if (typeof v[storageKey] === "boolean") setOn(v[storageKey]);
    });
  }, [storageKey]);
  return (
    <div className="list-tile" style={{ cursor: "default" }}>
      <span style={{ color: "var(--fp-accent)", display: "flex" }}>
        <Icon name={icon} size={17} />
      </span>
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {sub && <div className="tile-sub">{sub}</div>}
      </span>
      <button
        className={`toggle${on ? " on" : ""}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => {
          const next = !on;
          setOn(next);
          void browser.storage.local.set({ [storageKey]: next });
        }}
      />
    </div>
  );
}

function DeveloperPanel() {
  const [baseUrl, setBase] = useState("");
  const [saved, setSaved] = useState(false);
  const [x402Count, setX402Count] = useState(0);

  useEffect(() => {
    import("@/lib/api").then(({ getBaseUrl }) => getBaseUrl().then(setBase));
    browser.storage.local.get("x402Log").then(({ x402Log }) => {
      if (Array.isArray(x402Log)) setX402Count(x402Log.length);
    });
  }, []);

  return (
    <div style={{ padding: "4px 12px 10px" }}>
      <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", marginBottom: 8 }}>
        {x402Count} x402 payment-required responses captured. Open DevTools → FurlPay x402 for the inspector.
      </div>
      <label style={{ fontSize: "0.68rem", color: "var(--fp-text-secondary)", display: "block", marginBottom: 4 }}>Backend URL</label>
      <input className="input" value={baseUrl} onChange={(e) => setBase(e.target.value)} spellCheck={false} aria-label="Backend URL" />
      <button
        className="btn-ghost"
        style={{ marginTop: 8, width: "100%", padding: "8px" }}
        onClick={async () => {
          const { setBaseUrl } = await import("@/lib/api");
          await setBaseUrl(baseUrl);
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      >
        {saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}

// --- Passkey wallet manager --------------------------------------------------------
//
// Lists the WebAuthn credentials bound to the user's smart account. Adding a
// passkey deep-links to furlpay.com — registration must run on the rpID origin,
// never from a chrome-extension:// page. Revoking is a plain API call; the
// server refuses to remove the last remaining credential.

function PasskeysPanel() {
  const [list, setList] = useState<PasskeyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    send<PasskeyList>({ type: "GET_PASSKEYS" }).then((r) => {
      if (r.ok) {
        setList(r.data);
        setError(null);
      } else setError(r.error);
    });
  }, []);
  useEffect(load, [load]);

  const addr = list?.safeAddress;

  return (
    <div style={{ padding: "0 12px 10px" }}>
      {addr && (
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", marginBottom: 8 }}>
          Smart account{" "}
          <span style={{ fontFamily: "var(--fp-font-mono)", color: "var(--fp-text-secondary)" }}>
            {addr.slice(0, 6)}…{addr.slice(-4)}
          </span>{" "}
          — controlled by the devices below.
        </div>
      )}
      {error && <div style={{ color: "var(--fp-loss)", fontSize: "0.75rem", marginBottom: 8 }}>{error}</div>}
      {!list && !error && <div className="skeleton" style={{ height: 40, borderRadius: 10, marginBottom: 8 }} />}
      {list?.credentials.length === 0 && (
        <div style={{ fontSize: "0.76rem", color: "var(--fp-text-secondary)", marginBottom: 8 }}>
          No passkeys registered in this sandbox session yet.
        </div>
      )}
      {list?.credentials.map((pk) => (
        <div key={pk.id} className="tx-row" style={{ padding: "8px 0" }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: "0.82rem" }}>{pk.name}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)" }}>
              Added {relTime(pk.createdAt)} · used {relTime(pk.lastUsedAt)}
            </div>
          </div>
          <button
            className="btn-ghost"
            style={{ padding: "4px 10px", fontSize: "0.7rem" }}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(pk.id);
              const r = await send({ type: "REVOKE_PASSKEY", credentialId: pk.id });
              if (!r.ok) setError(r.error);
              setBusy(null);
              load();
            }}
          >
            {busy === pk.id ? "Removing…" : "Remove"}
          </button>
        </div>
      ))}
      <button className="btn-primary" style={{ width: "100%", marginTop: 8, padding: "9px" }} onClick={() => openSite("/profile#security")}>
        Add passkey on this device
      </button>
    </div>
  );
}

// --- Notification center ------------------------------------------------------------

function NotificationCenter({ onClose, onGoApprove }: { onClose: () => void; onGoApprove: () => void }) {
  const [challenges, setChallenges] = useState<PendingChallenge[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);

  useEffect(() => {
    send<{ challenges: PendingChallenge[] }>({ type: "GET_CHALLENGES" }).then((r) => r.ok && setChallenges(r.data.challenges));
    send<{ transactions: Transaction[] }>({ type: "GET_TRANSACTIONS" }).then((r) => r.ok && setTxs(r.data.transactions.slice(0, 3)));
  }, []);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={onClose} />
      <div className="notif-panel fade-up">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px 8px" }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 700 }}>Notifications</span>
          <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Close" onClick={onClose}>
            <Icon name="close" size={13} />
          </button>
        </div>
        {challenges.length > 0 && (
          <button className="list-tile" onClick={onGoApprove}>
            <span style={{ color: "var(--fp-loss)", display: "flex" }}>
              <Icon name="approve" size={16} />
            </span>
            <span style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {challenges.length} pending approval{challenges.length > 1 ? "s" : ""}
              </div>
              <div className="tile-sub">
                {challenges[0].merchant.name} · ${usd(challenges[0].amountUsd)}
              </div>
            </span>
            <span className="nav-badge" style={{ position: "static" }}>{challenges.length}</span>
          </button>
        )}
        {txs.map((tx) => (
          <div key={tx.id} className="list-tile" style={{ cursor: "default" }}>
            <span style={{ color: tx.status === "declined" ? "var(--fp-loss)" : "var(--fp-accent)", display: "flex" }}>
              <Icon name={CATEGORY_ICONS[tx.category] ?? (tx.direction === "in" ? "receive" : "send")} size={16} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.title}</div>
              <div className="tile-sub">{tx.subtitle}</div>
            </span>
            <span style={{ fontFamily: "var(--fp-font-mono)", fontSize: "0.74rem", fontWeight: 600 }}>
              {tx.direction === "in" ? "+" : "-"}${usd(tx.amountUsd)}
            </span>
          </div>
        ))}
        {challenges.length === 0 && txs.length === 0 && (
          <div style={{ padding: 14, textAlign: "center", fontSize: "0.76rem", color: "var(--fp-text-muted)" }}>You're all caught up.</div>
        )}
      </div>
    </>
  );
}

// --- Shared bits ------------------------------------------------------------------

function EmptyState({ title, subtitle, actions }: { title: string; subtitle?: string; actions: { label: string; path: string }[] }) {
  return (
    <div className="glass-panel" style={{ textAlign: "center", padding: 20 }}>
      <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: "0.74rem", color: "var(--fp-text-secondary)", marginBottom: 6 }}>{subtitle}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
        {actions.map((a) => (
          <button key={a.path} className="btn-ghost" style={{ padding: "7px 14px", fontSize: "0.76rem" }} onClick={() => openSite(a.path)}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SkeletonPage({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ padding: "0 14px" }} aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 128, borderRadius: 18, marginBottom: 14 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 46, borderRadius: 12, marginBottom: 8, animationDelay: `${i * 0.08}s` }} />
      ))}
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass-panel" style={{ margin: "0 14px", borderColor: "rgba(255,69,58,0.3)" }}>
      <div style={{ color: "var(--fp-loss)", fontSize: "0.82rem", marginBottom: onRetry ? 10 : 0 }}>{message}</div>
      {onRetry && (
        <button className="btn-ghost" style={{ width: "100%" }} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
