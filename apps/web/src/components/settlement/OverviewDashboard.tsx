"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  FileSpreadsheet,
  FileText,
  Landmark,
  Link2,
  MoreHorizontal,
  Search,
  Send,
  Split,
  Wallet,
  X,
} from "lucide-react";
import type { Activity, WorkspaceSnapshot } from "@/lib/settlement/model";
import type { Range } from "@/lib/settlement/overview";
import { api, AssetLogo, Badge, ChainLogo, chainName, Notice } from "./os/primitives";
import type { OnboardingView } from "./onboarding/types";

export type Approval = {
  id: string;
  approverRole: string;
  requestedAt?: string;
  deadline: string | null;
  payment: { amount: string; asset: string; network: string; rail?: string; recipientDestination: string | null; reason: string; phase: string };
};
export type RailRow = { rail: string; name: string; status: "HEALTHY" | "DEGRADED" | "INCIDENT" | "PAUSED" | "NOT_CONFIGURED" | "UNKNOWN"; chains?: string[] };

const usd = (n: number, dp = 2) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const compact = (n: number) => `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
const pctChange = (r: number | null) => (r === null ? null : `${r >= 0 ? "↑" : "↓"} ${Math.abs(r * 100).toFixed(1)}%`);
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const ago = (iso?: string) => {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const TYPE: Record<string, string> = { transfer: "Transfer", ramp: "Ramp", swap: "Conversion", card: "Card", bill: "Bill", invest: "Investment", yield: "Yield", refund: "Refund" };
const STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "muted" }> = {
  settled: { label: "Settled", tone: "green" },
  pending: { label: "Pending", tone: "amber" },
  escrow: { label: "In escrow", tone: "amber" },
  declined: { label: "Failed", tone: "red" },
};
const dir = (t: Activity) => (t.type === "swap" ? "INTERNAL" : t.direction === "in" ? "IN" : "OUT");
/** Approval amounts arrive in atomic units; only assets with a known scale are formatted. */
const ATOMIC_DECIMALS: Record<string, number> = { USDC: 6, USDT: 6, EURC: 6, PYUSD: 6 };
function atomic(amount: string, asset: string) {
  const d = ATOMIC_DECIMALS[asset.toUpperCase()];
  if (d === undefined || !/^\d+$/.test(amount)) return `${amount} ${asset} (atomic)`;
  const n = Number(amount) / 10 ** d;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${asset}`;
}
const RAIL_STATE: Record<RailRow["status"], { label: string; tone: string }> = {
  HEALTHY: { label: "Operational", tone: "var(--os-accent)" },
  DEGRADED: { label: "Degraded", tone: "var(--os-amber)" },
  INCIDENT: { label: "Unavailable", tone: "var(--os-red)" },
  PAUSED: { label: "Paused", tone: "var(--os-amber)" },
  NOT_CONFIGURED: { label: "Not configured", tone: "var(--os-faint)" },
  UNKNOWN: { label: "Unknown", tone: "var(--os-muted)" },
};
const RANGE_LABEL: Record<Range, string> = { "24h": "the last 24 hours", "7d": "the last 7 days", "30d": "the last 30 days", "90d": "the last 90 days" };

export default function OverviewDashboard({
  snapshot,
  onboarding,
  approvals,
  rails,
}: {
  snapshot: WorkspaceSnapshot | null;
  onboarding: OnboardingView | null;
  approvals: { items: Approval[] | null; error: string };
  rails: { items: RailRow[] | null; error: string };
  onToast: (m: string) => void;
}) {
  const router = useRouter();
  const [range, setRange] = useState<Range>("24h");
  const [selected, setSelected] = useState<Activity | null>(null);
  const [drawer, setDrawer] = useState<Activity | null>(null);
  const s = snapshot;
  const o = s?.overview;
  const act = o?.activity[range];
  const t24 = o?.activity["24h"];
  const latest = s?.transactions[0] ?? null;
  const shown = selected ?? latest;

  const quick = [
    { label: "Receive USDC", icon: ArrowDownToLine, href: "/settlement/payments/receive" },
    { label: "Payment Link", icon: Link2, href: "/settlement/payments/links?new=1" },
    { label: "New Invoice", icon: FileText, href: "/settlement/payments/invoices?new=1" },
    { label: "Send Payout", icon: Send, href: "/settlement/payouts/send?new=1" },
    { label: "Batch Payout", icon: FileSpreadsheet, href: "/settlement/payouts/batch" },
    { label: "Convert", icon: ArrowLeftRight, href: "/settlement/treasury/convert" },
    { label: "Virtual Account", icon: Landmark, href: "/settlement/virtual-accounts" },
  ];

  return (
    <div className="os-ov">
      <div className="os-ov-main">
        <header className="os-page-head">
          <div>
            <h1 className="os-title" style={{ marginTop: 0 }}>Settlement Overview</h1>
            <p className="os-subtitle">Global liquidity, settlement activity and treasury operations.</p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link className="os-btn" href="/settlement/payments/receive">
              <ArrowDownToLine size={17} /> Receive USDC
            </Link>
            <Link className="os-btn os-btn-primary" href="/settlement/payouts/send?new=1">
              <Send size={17} /> Send Payout
            </Link>
          </div>
        </header>

        {/* KPIs */}
        <div className="os-kpis">
          <Kpi label="Total Treasury" icon={<Database size={16} />} value={o ? usd(o.treasury.total) : null}>
            {o && o.treasury.assets.length > 0 ? (
              <ul className="os-kpi-breakdown">
                {o.treasury.assets.slice(0, 3).map((a) => (
                  <li key={a.asset}>
                    <AssetLogo asset={a.asset} size={16} />
                    <span className="mono">
                      {a.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {a.asset}
                    </span>
                  </li>
                ))}
              </ul>
            ) : o ? (
              <small className="os-kpi-sub">No balances on this account yet</small>
            ) : null}
          </Kpi>
          <Kpi label="Available Liquidity" icon={<Wallet size={16} />} value={o ? usd(o.treasury.stablecoinUsd) : null}>
            {o && <small className="os-kpi-sub"><i className="os-dot-inline" /> Stablecoin balances · settle on-chain</small>}
          </Kpi>
          <Kpi label="In Transit" icon={<Clock3 size={16} />} tone="amber" value={o ? usd(o.inTransit.usd) : null}>
            {o && (
              <small className="os-kpi-sub">
                <i className="os-dot-inline" style={{ background: "var(--os-amber)" }} /> {o.inTransit.count} transaction{o.inTransit.count === 1 ? "" : "s"} pending
              </small>
            )}
          </Kpi>
          <Kpi label="24H Settlement Volume" icon={<BarChart3 size={16} />} value={t24 ? usd(t24.settledUsd) : null} spark={t24?.series.map((b) => b.usd)}>
            {t24 && <small className="os-kpi-sub"><i className="os-dot-inline" /> {t24.settledCount} transaction{t24.settledCount === 1 ? "" : "s"}</small>}
          </Kpi>
        </div>

        <nav className="os-quick" aria-label="Quick actions">
          {quick.map((q) => (
            <Link key={q.label} href={q.href} className="os-btn">
              <q.icon size={17} /> {q.label}
            </Link>
          ))}
        </nav>

        <div className="os-ov-grid">
          {/* Settlement activity */}
          <section className="os-card os-pad">
            <div className="os-section-head">
              <div>
                <h2>Settlement Activity</h2>
                <p>Settled volume over {RANGE_LABEL[range]}.</p>
              </div>
              <div className="os-seg" role="tablist" aria-label="Range">
                {(["24h", "7d", "30d", "90d"] as Range[]).map((r) => (
                  <button key={r} role="tab" type="button" aria-selected={range === r} onClick={() => setRange(r)}>
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {!act ? (
              <div className="os-skeleton" style={{ height: 220 }} />
            ) : act.settledCount === 0 ? (
              <div className="os-empty" style={{ height: 220 }}>
                <BarChart3 size={22} />
                <strong>No settled transactions in {RANGE_LABEL[range]}</strong>
                <small>Settled volume appears here as payments complete.</small>
              </div>
            ) : (
              <div style={{ height: 220 }} aria-label={`Settled volume chart for ${RANGE_LABEL[range]}`} role="img">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={act.series} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="os-area" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0" stopColor="#00c888" stopOpacity={0.32} />
                        <stop offset="1" stopColor="#00c888" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="t" tickLine={false} axisLine={false} minTickGap={30} tick={{ fill: "#93a09a", fontSize: 11 }} tickFormatter={(v: string) => (range === "24h" ? new Date(v).toLocaleTimeString([], { hour: "numeric" }) : new Date(v).toLocaleDateString([], { month: "short", day: "numeric" }))} />
                    <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: "#93a09a", fontSize: 11 }} tickFormatter={(v: number) => compact(v)} />
                    <Tooltip
                      cursor={{ stroke: "rgba(255,255,255,0.15)" }}
                      contentStyle={{ background: "#121a16", border: "1px solid #24302a", borderRadius: 10, fontSize: 12 }}
                      labelFormatter={(v) => new Date(String(v)).toLocaleString()}
                      formatter={(v) => [usd(Number(v)), "Settled"]}
                    />
                    <Area type="monotone" dataKey="usd" stroke="#00c888" strokeWidth={2} fill="url(#os-area)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="os-stats">
              <div>
                <small>Total settled</small>
                <strong className="mono">{act ? usd(act.settledUsd, 0) : "—"}</strong>
                {act && pctChange(act.settledChange) && <em data-up={act.settledChange! >= 0}>{pctChange(act.settledChange)}</em>}
              </div>
              <div>
                <small>Success rate</small>
                <strong className="mono">{act?.successRate == null ? "—" : `${(act.successRate * 100).toFixed(2)}%`}</strong>
                {act?.successRateChange != null && <em data-up={act.successRateChange >= 0}>{`${act.successRateChange >= 0 ? "↑" : "↓"} ${Math.abs(act.successRateChange * 100).toFixed(2)}pp`}</em>}
              </div>
              <div>
                <small>Average finality</small>
                <strong className="mono">—</strong>
                <em data-muted="true">Not recorded by the ledger</em>
              </div>
            </div>
          </section>

          {/* Action required + system health */}
          <section className="os-card os-pad">
            <div className="os-section-head">
              <h2>Action Required</h2>
              <Link className="os-link" href="/settlement/payouts/approvals">
                View all{approvals.items ? ` (${approvals.items.length})` : ""}
              </Link>
            </div>
            {approvals.error ? (
              <p className="os-rail-sub">Approval queue unavailable: {approvals.error}</p>
            ) : !approvals.items ? (
              <div className="os-skeleton" style={{ height: 120 }} />
            ) : approvals.items.length === 0 ? (
              <div className="os-empty" style={{ height: 120 }}>
                <Check size={20} />
                <strong>No payments awaiting approval</strong>
              </div>
            ) : (
              <ul className="os-actions-list">
                {approvals.items.slice(0, 2).map((a) => (
                  <li key={a.id}>
                    <AssetLogo asset={a.payment.asset} size={34} />
                    <span className="os-row-body">
                      <strong className="mono">{atomic(a.payment.amount, a.payment.asset)}</strong>
                      <small>{a.payment.recipientDestination ?? "Recipient not recorded"}</small>
                      <small>
                        {a.payment.asset} · {chainName(a.payment.network)}
                      </small>
                      <small style={{ color: "var(--os-amber)" }}>● {a.payment.reason}</small>
                    </span>
                    <span style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                      <Link className="os-btn os-btn-sm" href="/settlement/payouts/approvals">
                        Review
                      </Link>
                      <small style={{ color: "var(--os-faint)" }}>{ago(a.requestedAt)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="os-section-head" style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--os-border-soft)" }}>
              <h2>System Health</h2>
              {rails.items && <HealthSummary rails={rails.items} />}
            </div>
            {rails.error ? (
              <p className="os-rail-sub">System health unavailable: {rails.error}</p>
            ) : !rails.items ? (
              <div className="os-skeleton" style={{ height: 100 }} />
            ) : (
              <ul className="os-health">
                {rails.items.map((r) => (
                  <li key={r.rail}>
                    <span>{r.name}</span>
                    <span style={{ color: RAIL_STATE[r.status]?.tone }}>
                      <i style={{ background: RAIL_STATE[r.status]?.tone }} /> {RAIL_STATE[r.status]?.label ?? r.status}
                    </span>
                  </li>
                ))}
                <li>
                  <span>Workspace storage</span>
                  <span style={{ color: s?.storage === "available" ? "var(--os-accent)" : "var(--os-amber)" }}>
                    <i style={{ background: s?.storage === "available" ? "var(--os-accent)" : "var(--os-amber)" }} /> {s ? (s.storage === "available" ? "Operational" : "Not configured") : "Unknown"}
                  </span>
                </li>
              </ul>
            )}
          </section>
        </div>

        <RecentTransactions onOpen={(t) => (setSelected(t), setDrawer(t))} />
      </div>

      {/* Right rail */}
      <aside className="os-ov-rail" aria-label="Treasury summary">
        <LiquidityCard snapshot={s} onRail={() => router.push("/settlement/treasury/balances")} />
        <RuleCard onboarding={onboarding} />
        <section className="os-card os-pad">
          <div className="os-section-head">
            <h2>Recent Activity</h2>
            <Link className="os-link" href="/settlement/payments/transactions">
              View all
            </Link>
          </div>
          {!s ? (
            <div className="os-skeleton" style={{ height: 120 }} />
          ) : s.transactions.length === 0 ? (
            <p className="os-rail-sub">No activity yet.</p>
          ) : (
            <ul className="os-feed">
              {s.transactions.slice(0, 4).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => (setSelected(t), setDrawer(t))}>
                    <span className="os-feed-icon">{t.type === "swap" ? <Split size={14} /> : t.direction === "in" ? <ArrowDownToLine size={14} /> : <Send size={14} />}</span>
                    <span className="os-feed-label">{t.status === "pending" ? "Pending" : t.type === "swap" ? "Conversion" : t.direction === "in" ? "Pay-in received" : "Payout sent"}</span>
                    <span className="mono" style={{ color: t.direction === "in" ? "var(--os-accent)" : "var(--os-red)" }}>
                      {t.direction === "in" ? "+" : "−"}
                      {compact(Math.abs(t.amountUsd))}
                    </span>
                    <span className="mono os-feed-time">{new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="os-card os-pad">
          <div className="os-section-head">
            <h2>Transaction Details</h2>
          </div>
          {!shown ? (
            <p className="os-rail-sub">Select a transaction to see its details.</p>
          ) : (
            <button type="button" className="os-txcard" onClick={() => setDrawer(shown)}>
              <AssetLogo asset={shown.asset} size={42} />
              <span>
                <span className="mono" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {shown.id.length > 14 ? `${shown.id.slice(0, 12)}…` : shown.id} <Badge tone={STATUS[shown.status]?.tone ?? "muted"}>{STATUS[shown.status]?.label ?? shown.status}</Badge>
                </span>
                <strong className="mono">
                  {usd(Math.abs(shown.amountUsd))} {shown.asset !== "USD" ? `· ${shown.asset}` : ""}
                </strong>
                <small>{shown.name}</small>
                <small>
                  {TYPE[shown.type] ?? shown.type} · {new Date(shown.timestamp).toLocaleString()}
                </small>
              </span>
            </button>
          )}
        </section>
      </aside>
      {drawer && <TxDrawer tx={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function HealthSummary({ rails }: { rails: RailRow[] }) {
  const configured = rails.filter((r) => r.status !== "NOT_CONFIGURED");
  const healthy = rails.filter((r) => r.status === "HEALTHY").length;
  const text = configured.length === 0 ? "No settlement rails configured" : healthy === configured.length ? "All configured rails operational" : `${healthy} of ${configured.length} configured rails operational`;
  const tone = configured.length === 0 ? "var(--os-faint)" : healthy === configured.length ? "var(--os-accent)" : "var(--os-amber)";
  return (
    <small style={{ color: tone, display: "inline-flex", alignItems: "center", gap: 6 }}>
      <CircleDot size={12} /> {text}
    </small>
  );
}

function Kpi({ label, icon, value, tone, spark, children }: { label: string; icon: React.ReactNode; value: string | null; tone?: "amber"; spark?: number[]; children?: React.ReactNode }) {
  const points = spark && spark.some((v) => v > 0) ? spark : null;
  const max = points ? Math.max(...points) : 0;
  return (
    <section className="os-card os-kpi">
      <div className="os-kpi-head">
        <small>{label}</small>
        <span className="os-icon-tile" style={{ width: 32, height: 32, color: tone === "amber" ? "var(--os-amber)" : undefined }}>
          {icon}
        </span>
      </div>
      {value === null ? <div className="os-skeleton" style={{ height: 30, width: "70%", marginTop: 6 }} /> : <strong className="os-kpi-value mono">{value}</strong>}
      {children}
      {points && (
        <svg className="os-spark" viewBox={`0 0 ${points.length - 1} 30`} preserveAspectRatio="none" aria-hidden="true">
          <polyline fill="none" stroke="#00c888" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={points.map((v, i) => `${i},${30 - (max ? (v / max) * 26 : 0) - 2}`).join(" ")} />
        </svg>
      )}
    </section>
  );
}

const RAIL_COLOR = ["#00c888", "#4f8ff7", "#8b97a3", "#5fd4e0", "#a77bf3", "#e8ba72"];
function LiquidityCard({ snapshot, onRail }: { snapshot: WorkspaceSnapshot | null; onRail: () => void }) {
  const t = snapshot?.overview.treasury;
  const C = 2 * Math.PI * 54;
  let offset = 0;
  return (
    <section className="os-card os-pad">
      <h2>Liquidity by Rail</h2>
      {!t ? (
        <div className="os-skeleton" style={{ height: 200, marginTop: 14 }} />
      ) : t.total <= 0 ? (
        <p className="os-rail-sub">No liquidity data. Balances appear once funds arrive.</p>
      ) : (
        <>
          <div style={{ display: "grid", placeItems: "center", margin: "14px 0" }}>
            <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Liquidity by rail">
              <circle cx="70" cy="70" r="54" fill="none" stroke="#1c2621" strokeWidth="14" />
              {t.rails.map((r, i) => {
                const len = r.share * C;
                const el = <circle key={r.rail} cx="70" cy="70" r="54" fill="none" stroke={RAIL_COLOR[i % RAIL_COLOR.length]} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
                offset += len;
                return el;
              })}
              <text x="70" y="68" textAnchor="middle" fill="var(--os-text)" style={{ font: "600 18px 'JetBrains Mono', monospace" }}>
                {compact(t.total)}
              </text>
              <text x="70" y="86" textAnchor="middle" fill="var(--os-muted)" style={{ font: "500 11px Inter" }}>
                USD value
              </text>
            </svg>
          </div>
          <ul className="os-legend">
            {t.rails.map((r, i) => (
              <li key={r.rail}>
                <button type="button" onClick={onRail}>
                  <i style={{ background: RAIL_COLOR[i % RAIL_COLOR.length] }} />
                  <span>{chainName(r.rail)}</span>
                  <span className="mono">{compact(r.usd)}</span>
                  <span className="mono" style={{ color: "var(--os-muted)" }}>
                    {Math.round(r.share * 100)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function RuleCard({ onboarding }: { onboarding: OnboardingView | null }) {
  const rules = onboarding?.state.settlement?.rules;
  return (
    <section className="os-card os-pad">
      <div className="os-section-head">
        <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Split size={16} color="var(--os-accent)" /> Settlement Rule
        </h2>
        {rules && <Badge tone="muted">Configured · not executing</Badge>}
      </div>
      {!onboarding ? (
        <div className="os-skeleton" style={{ height: 80 }} />
      ) : !rules ? (
        <>
          <p className="os-rail-sub">No settlement configuration yet.</p>
          <Link className="os-btn os-btn-sm" style={{ marginTop: 12 }} href="/settlement/onboarding/settlement">
            Configure settlement
          </Link>
        </>
      ) : (
        <>
          <ul className="os-feed">
            {rules.map((r) => (
              <li key={r.id}>
                <span className="os-feed-row">
                  <span className="mono" style={{ color: "var(--os-accent)" }}>{r.percent}%</span>
                  <span>→ {r.label}</span>
                  <span style={{ color: "var(--os-muted)" }}>{r.assets === "all" ? "All assets" : r.assets.join(", ")}</span>
                </span>
              </li>
            ))}
          </ul>
          <Link className="os-link" style={{ display: "inline-block", marginTop: 10 }} href="/settlement/onboarding/settlement">
            {onboarding.state.activation.status === "ACTIVE" ? "Edit rule" : "View rule"}
          </Link>
        </>
      )}
    </section>
  );
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "payins", label: "Pay-ins" },
  { id: "payouts", label: "Payouts" },
  { id: "settlements", label: "Settlements" },
  { id: "refunds", label: "Refunds" },
] as const;

function RecentTransactions({ onOpen }: { onOpen: (t: Activity) => void }) {
  const [type, setType] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<{ items: Activity[]; nextCursor: string | null; total: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setCursors([null]), [type, term]);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => {
    const ac = new AbortController();
    setError("");
    setPage(null);
    const qs = new URLSearchParams({ limit: "8", type });
    if (term) qs.set("q", term);
    if (cursor) qs.set("cursor", cursor);
    api<{ items: Activity[]; nextCursor: string | null; total: number }>(`/api/settlement/transactions?${qs}`, { signal: ac.signal })
      .then(setPage)
      .catch((e) => !ac.signal.aborted && setError(e.message));
    return () => ac.abort();
  }, [type, term, cursor]);
  const empty = useMemo(() => (type === "refunds" ? "No refunds recorded on this account." : type === "settlements" ? "No internal settlements (conversions) recorded." : term ? `No transactions match “${term}”.` : "No transactions yet."), [type, term]);

  return (
    <section className="os-card os-pad" style={{ marginTop: 18 }}>
      <div className="os-section-head" style={{ flexWrap: "wrap" }}>
        <div>
          <h2>Recent Transactions</h2>
          <p>Every movement on your account ledger.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="os-input-icon" style={{ width: 300, maxWidth: "100%" }}>
            <Search size={15} />
            <input className="os-input" style={{ height: 36 }} placeholder="Search by transaction ID or counterparty…" aria-label="Search transactions" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="os-seg" role="tablist" aria-label="Transaction type">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" type="button" aria-selected={type === f.id} onClick={() => setType(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error ? (
        <Notice tone="error">Transactions unavailable: {error}</Notice>
      ) : (
        <div className="os-txtable-wrap">
          <table className="os-table os-txtable">
            <caption className="os-visually-hidden">Recent transactions</caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Tx ID</th>
                <th scope="col">Direction</th>
                <th scope="col">Type</th>
                <th scope="col" style={{ textAlign: "right" }}>Amount</th>
                <th scope="col">Asset / Network</th>
                <th scope="col">Counterparty</th>
                <th scope="col">Settled</th>
                <th scope="col">
                  <span className="os-visually-hidden">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!page ? (
                Array.from({ length: 4 }, (_, i) => (
                  <tr key={i}>
                    <td colSpan={9}>
                      <div className="os-skeleton" style={{ height: 18 }} />
                    </td>
                  </tr>
                ))
              ) : page.items.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", padding: 28, color: "var(--os-muted)" }}>
                    {empty}
                  </td>
                </tr>
              ) : (
                page.items.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Status">
                      <Badge tone={STATUS[t.status]?.tone ?? "muted"}>{STATUS[t.status]?.label ?? t.status}</Badge>
                    </td>
                    <td data-label="Tx ID">
                      <button type="button" className="os-txid mono" onClick={() => onOpen(t)}>
                        {t.id.length > 14 ? `${t.id.slice(0, 12)}…` : t.id}
                      </button>
                    </td>
                    <td data-label="Direction">
                      <span className="os-dir mono">{dir(t)}</span>
                    </td>
                    <td data-label="Type">{TYPE[t.type] ?? t.type}</td>
                    <td data-label="Amount" className="mono" style={{ textAlign: "right", color: t.direction === "in" ? "var(--os-accent)" : "var(--os-red)" }}>
                      {t.direction === "in" ? "+" : "−"}
                      {usd(Math.abs(t.amountUsd)).replace("−", "")}
                    </td>
                    <td data-label="Asset / Network">
                      {t.asset} · {chainName(t.network)}
                    </td>
                    <td data-label="Counterparty">{t.name}</td>
                    <td data-label="Settled" className="mono" style={{ color: t.status === "settled" ? undefined : "var(--os-amber)" }}>
                      {t.status === "settled" ? time(t.timestamp) : STATUS[t.status]?.label ?? t.status}
                    </td>
                    <td>
                      <button type="button" className="os-icon-btn" style={{ width: 30, height: 30, border: 0, background: "none" }} aria-label={`Open ${t.id}`} onClick={() => onOpen(t)}>
                        <MoreHorizontal size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {page && (
        <div className="os-pager">
          <small>{page.total} transaction{page.total === 1 ? "" : "s"}</small>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="os-btn os-btn-sm" disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
              <ChevronLeft size={15} /> Previous
            </button>
            <button type="button" className="os-btn os-btn-sm" disabled={!page.nextCursor} onClick={() => page.nextCursor && setCursors((c) => [...c, page.nextCursor])}>
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Lifecycle shows only stages the ledger can attest to. */
function TxDrawer({ tx, onClose }: { tx: Activity; onClose: () => void }) {
  const done = tx.status === "settled";
  const failed = tx.status === "declined";
  const stages = [
    { label: "Payment initiated", state: "done", detail: new Date(tx.timestamp).toLocaleString() },
    { label: "Recorded on the FurlPay ledger", state: "done", detail: "Account ledger entry" },
    failed ? { label: "Payment failed", state: "failed", detail: "Declined before settlement" } : { label: "Settlement", state: done ? "done" : "current", detail: done ? "Settled" : tx.status === "escrow" ? "Held in escrow" : "Awaiting settlement" },
  ];
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <button className="os-backdrop" aria-label="Close" onClick={onClose} />
      <div className="os-drawer" role="dialog" aria-modal="true" aria-label="Transaction details">
        <div className="os-drawer-head">
          <h2>Transaction details</h2>
          <button className="os-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <AssetLogo asset={tx.asset} size={44} />
          <span>
            <strong className="mono" style={{ fontSize: 22, display: "block" }}>
              {tx.direction === "in" ? "+" : "−"}
              {usd(Math.abs(tx.amountUsd)).replace("−", "")}
            </strong>
            <Badge tone={STATUS[tx.status]?.tone ?? "muted"}>{STATUS[tx.status]?.label ?? tx.status}</Badge>
          </span>
        </div>
        <dl className="os-dl">
          <div><dt>Transaction ID</dt><dd className="mono">{tx.id}</dd></div>
          <div><dt>Counterparty</dt><dd>{tx.name}</dd></div>
          {tx.detail && <div><dt>Details</dt><dd>{tx.detail}</dd></div>}
          <div><dt>Direction</dt><dd>{dir(tx)}</dd></div>
          <div><dt>Type</dt><dd>{TYPE[tx.type] ?? tx.type}</dd></div>
          <div><dt>Asset</dt><dd>{tx.asset}</dd></div>
          <div><dt>Network</dt><dd style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>{tx.network !== "account" && <ChainLogo chain={tx.network} size={16} />}{chainName(tx.network)}</dd></div>
          <div><dt>Tx hash</dt><dd style={{ color: "var(--os-muted)" }}>Not recorded on this ledger entry</dd></div>
          <div><dt>Fee · Gas</dt><dd style={{ color: "var(--os-muted)" }}>Not recorded</dd></div>
          <div><dt>Block · Confirmations</dt><dd style={{ color: "var(--os-muted)" }}>—</dd></div>
          <div><dt>Settlement allocation</dt><dd style={{ color: "var(--os-muted)" }}>Not applied — no settlement service executes rules</dd></div>
          <div><dt>Reconciliation</dt><dd style={{ color: "var(--os-muted)" }}>Not matched to external records</dd></div>
        </dl>
        <h3 style={{ marginTop: 22, fontSize: 14 }}>Lifecycle</h3>
        <ol className="os-timeline">
          {stages.map((s) => (
            <li key={s.label} data-state={s.state}>
              <span className="os-timeline-mark">{s.state === "done" ? <Check size={12} strokeWidth={3} /> : s.state === "failed" ? <X size={12} strokeWidth={3} /> : null}</span>
              <span>
                <strong>{s.label}</strong>
                <small>{s.detail}</small>
              </span>
            </li>
          ))}
        </ol>
        <p style={{ marginTop: 14, color: "var(--os-faint)", fontSize: 12 }}>
          Compliance clearance, blockchain submission and finality appear here once the ledger records them for this entry. No explorer link is shown because no transaction hash is recorded.
        </p>
      </div>
    </>
  );
}
