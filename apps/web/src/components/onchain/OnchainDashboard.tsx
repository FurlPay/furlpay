"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  Download,
  FileText,
  Globe2,
  LayoutDashboard,
  Link2,
  Menu,
  Network,
  Plane,
  Plug,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wallet,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { AccountMenu } from "@/components/support/SupportChrome";
import { PRODUCT_LABELS } from "@/lib/analytics/products";
import type { OnchainDashboard as Data, Kpi, TokenKey } from "@/lib/onchain/dashboard";
import world from "@/components/analytics/worldDots.json";
import { fmtChange, fmtCount, fmtUsd, relTime } from "@/components/analytics/format";
import { useOnchain, type OnchainRange } from "./useOnchain";

// ---------------------------------------------------------------------------
// /onchain — Onchain Intelligence. Layout follows the reference design; every
// number comes from /api/onchain, and every card names its source. A card
// whose source is not connected says so in place of a chart: nothing on this
// page is a placeholder value.
// ---------------------------------------------------------------------------

const NEON = "#00E599";
const TOKEN_COLORS: Record<TokenKey, string> = { USDC: "#3B82F6", USDT: "#22C55E", BTC: "#F7931A", ETH: "#8B5CF6", SOL: "#EC4899", OTHER: "#6B7280" };
const PALETTE = ["#3B82F6", "#10B981", "#8B5CF6", "#06B6D4", "#F59E0B", "#6B7280"];
const RAIL_ICON: Record<string, LucideIcon> = { x402: Bot, mpp: Bot, lifi: ArrowLeftRight, cctp: Link2, transfers: Wallet };
const RAIL_COLOR: Record<string, string> = { x402: "#EC4899", mpp: "#F59E0B", lifi: "#06B6D4", cctp: "#3B82F6", transfers: "#10B981" };
const CHAIN_LOGOS = new Set(["arbitrum", "avalanche", "ethereum", "gnosis", "optimism", "polygon", "solana"]);
const RANGE_LABEL: Record<OnchainRange, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };
const CHAINS = ["all", "ethereum", "base", "arbitrum", "solana", "polygon", "optimism", "avalanche"];
const WORLD = world as unknown as { width: number; height: number; dots: [number, number][]; centroids: Record<string, [number, number]> };

const SHORT_RAIL: Record<string, string> = { transfers: "Transfers", x402: "x402", lifi: "Swaps", cctp: "CCTP", mpp: "MPP" };
const railLabel = (r: string) => PRODUCT_LABELS[r as keyof typeof PRODUCT_LABELS] ?? r;
const chainLabel = (c: string) => (c === "all" ? "All Chains" : c === "bsc" ? "BNB Chain" : c.charAt(0).toUpperCase() + c.slice(1));
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

const NAV: { label: string; href: string; Icon: LucideIcon }[] = [
  { label: "Overview", href: "#overview", Icon: LayoutDashboard },
  { label: "Payments", href: "#payments", Icon: CircleDollarSign },
  { label: "Wallets", href: "/dashboard", Icon: Wallet },
  { label: "Cards", href: "/cards", Icon: CreditCard },
  { label: "Travel", href: "/travel", Icon: Plane },
  { label: "Users", href: "/analytics/users", Icon: Users },
  { label: "Compliance", href: "#risk", Icon: ShieldCheck },
  { label: "Risk", href: "/ops", Icon: ShieldAlert },
  { label: "Counterparties", href: "#counterparties", Icon: Network },
  { label: "Chain Analytics", href: "#chains", Icon: BarChart3 },
  { label: "Stablecoin Market", href: "#market", Icon: Globe2 },
  { label: "Reports", href: "/reports", Icon: FileText },
];

export default function OnchainDashboard() {
  const [range, setRange] = useState<OnchainRange>("30d");
  const [chain, setChain] = useState("all");
  const [drawer, setDrawer] = useState(false);
  const { data, state, error, updatedAt } = useOnchain(range, chain);

  return (
    <div className="min-h-screen bg-[#050807] text-white">
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-[188px] shrink-0 overflow-y-auto border-r border-white/[0.06] bg-[#060A08] xl:block">
          <Sidebar alliumConfigured={data?.alliumConfigured ?? false} />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button aria-label="Close navigation" className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[240px] overflow-y-auto border-r border-white/[0.08] bg-[#060A08]">
              <button aria-label="Close navigation" onClick={() => setDrawer(false)} className="absolute right-3 top-4 rounded-md p-1.5 text-white/60 hover:text-white">
                <X className="h-5 w-5" />
              </button>
              <Sidebar alliumConfigured={data?.alliumConfigured ?? false} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-40 flex h-[52px] items-center gap-3 border-b border-white/[0.06] bg-[#050807]/95 px-4 backdrop-blur sm:px-5">
            <button onClick={() => setDrawer(true)} aria-label="Open navigation" className="rounded-md p-1.5 text-white/70 hover:text-white xl:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <form
              role="search"
              action="/analytics/realtime"
              className="hidden h-[34px] max-w-[452px] flex-1 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.02] px-3 md:flex"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-white/50" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input name="q" className="min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-white/45 focus:outline-none" placeholder="Search transactions, addresses, entities, merchants..." aria-label="Search" />
              <kbd className="rounded border border-white/10 px-1.5 text-[10.5px] text-white/50">⌘ K</kbd>
            </form>
            <div className="ml-auto flex items-center gap-2.5">
              <Select label="Time range" value={range} onChange={(v) => setRange(v as OnchainRange)} options={(Object.keys(RANGE_LABEL) as OnchainRange[]).map((k) => [k, RANGE_LABEL[k]])} />
              <Select label="Chain" value={chain} onChange={setChain} options={CHAINS.map((c) => [c, chainLabel(c)])} className="hidden sm:block" />
              <Link href="/ops" aria-label="Ops alerts" className="relative rounded-lg p-2 text-white/80 hover:bg-white/[0.05]">
                <Bell className="h-[18px] w-[18px]" />
                {data?.risk.status === "ok" && data.risk.data.critical.value > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#FF4D6D]" />}
              </Link>
              <AccountMenu />
            </div>
          </header>

          <main id="overview" className="mx-auto max-w-[1360px] px-4 pb-10 pt-5 sm:px-5">
            <TitleRow data={data} state={state} updatedAt={updatedAt} />
            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-[#FF4D6D]/30 bg-[#FF4D6D]/[0.06] px-3 py-2 text-[13px] text-[#FFB3C1]">
                {error}
                {data ? " — showing the last good data." : ""}
              </p>
            )}
            {!data ? (
              <div className="mt-6 grid gap-4 md:grid-cols-5">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="h-[104px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.02]" />
                ))}
              </div>
            ) : (
              <Body data={data} range={range} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ── Chrome ──────────────────────────────────────────────────────────────────

function Sidebar({ alliumConfigured, onNavigate }: { alliumConfigured: boolean; onNavigate?: () => void }) {
  const item = "flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13px] text-[#D3D7D5] transition-colors hover:bg-white/[0.04] hover:text-white";
  return (
    <nav className="flex min-h-full flex-col px-2.5 pb-4 pt-4" aria-label="Onchain sections">
      <Link href="/onchain" className="mb-5 flex items-center gap-2 px-2" onClick={onNavigate}>
        <FurlPayMark size={26} />
        <span className="text-[20px] font-semibold tracking-tight">FurlPay</span>
      </Link>
      <Link href="/analytics" className="mb-3 flex items-center gap-2.5 rounded-lg border border-[#00E599]/25 bg-[#00E599]/[0.08] px-3 py-2 text-[13px] font-medium" onClick={onNavigate}>
        <BarChart3 className="h-4 w-4 text-[#00E599]" /> Analytics <ChevronDown className="ml-auto h-3.5 w-3.5 text-white/60" />
      </Link>
      <ul className="space-y-0.5">
        {NAV.map(({ label, href, Icon }, i) => (
          <li key={label}>
            <Link href={href} onClick={onNavigate} className={i === 0 ? `${item} bg-white/[0.06] font-medium text-white` : item}>
              <Icon className="h-4 w-4 shrink-0" /> {label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="my-4 border-t border-white/[0.06]" />
      <ul className="space-y-0.5">
        <li>
          <Link href="/docs" onClick={onNavigate} className={item}>
            <Webhook className="h-4 w-4" /> API & Webhooks
          </Link>
        </li>
        <li>
          <Link href="/integrations" onClick={onNavigate} className={item}>
            <Plug className="h-4 w-4" /> Integrations
          </Link>
        </li>
      </ul>
      <div className="mt-auto pt-8">
        <div className="mb-4 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5 text-[12px] text-white/70">
          {alliumConfigured ? (
            <span className="flex items-center gap-1.5">
              Data by <AlliumMark className="h-3.5 w-3.5" /> <span className="font-semibold text-white">Allium</span>
            </span>
          ) : (
            <span>
              Allium: <span className="text-white/90">not connected</span>
              <span className="mt-0.5 block text-[11px] text-white/45">Set ALLIUM_API_KEY to enable</span>
            </span>
          )}
        </div>
        <Link href="/docs" onClick={onNavigate} className={item}>
          <BookOpen className="h-4 w-4" /> Docs
        </Link>
      </div>
    </nav>
  );
}

/** A plain ring glyph, not Allium's trademarked logo. */
function AlliumMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function Select({ label, value, onChange, options, className = "" }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; className?: string }) {
  return (
    <label className={`relative ${className}`}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[32px] appearance-none rounded-lg border border-white/[0.12] bg-[#0A0F0D] pl-3 pr-8 text-[12.5px] text-white focus:border-[#00E599]/60 focus:outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/60" />
    </label>
  );
}

function TitleRow({ data, state, updatedAt }: { data: Data | null; state: string; updatedAt: number | null }) {
  const badge =
    state === "live"
      ? { text: "Live Data", cls: "border-[#00E599]/40 text-[#00E599]", dot: "bg-[#00E599]" }
      : state === "degraded"
        ? { text: "Live · some sources unavailable", cls: "border-[#F5B83D]/40 text-[#F5B83D]", dot: "bg-[#F5B83D]" }
        : state === "offline"
          ? { text: updatedAt ? `Offline · ${relTime(updatedAt)}` : "Offline", cls: "border-[#FF4D6D]/40 text-[#FF8FA3]", dot: "bg-[#FF4D6D]" }
          : { text: "Connecting…", cls: "border-white/20 text-white/70", dot: "bg-white/50" };
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold tracking-tight">Onchain Intelligence</h1>
        <p className="mt-0.5 text-[14px] text-white/75">
          {data?.alliumConfigured
            ? "Real-time blockchain data, analytics and insights from the FurlPay ledger, powered by Allium."
            : "Real-time analytics from the FurlPay ledger and public stablecoin market data."}
        </p>
      </div>
      <div className="flex items-center gap-4 lg:ml-auto">
        {data?.alliumConfigured && (
          <div className="hidden items-center gap-3 sm:flex" aria-label="FurlPay and Allium">
            <FurlPayMark size={26} />
            <span className="text-[22px] font-semibold">FurlPay</span>
            <span className="text-white/60">×</span>
            <AlliumMark className="h-6 w-6" />
            <span className="text-[22px] font-semibold">Allium</span>
          </div>
        )}
        <span className={`flex items-center gap-2 rounded-lg border bg-white/[0.02] px-3.5 py-2 text-[12.5px] font-medium ${badge.cls}`} aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${badge.dot} ${state === "live" ? "animate-pulse" : ""}`} />
          {badge.text}
        </span>
      </div>
    </div>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

function Card({ title, id, action, source, children, className = "" }: { title: string; id?: string; action?: ReactNode; source?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`flex min-w-0 scroll-mt-16 flex-col rounded-xl border border-white/[0.07] bg-[#0A0E0C] p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[15.5px] font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{action}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {source && <p className="mt-3 truncate text-[10.5px] text-white/35" title={source}>Source: {source}</p>}
    </section>
  );
}

function Unavailable({ reason, children }: { reason: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.1] px-4 py-6 text-center">
      <p className="text-[13px] font-medium text-white/80">Not available</p>
      <p className="max-w-[320px] text-[12px] text-white/50">{reason}</p>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="flex flex-1 items-center justify-center py-6 text-center text-[12.5px] text-white/50">{text}</p>;
}

function Change({ ratio, invert = false }: { ratio: number | null; invert?: boolean }) {
  if (ratio === null || !Number.isFinite(ratio)) return <span className="text-[12.5px] text-white/40">no prior period</span>;
  const good = invert ? ratio <= 0 : ratio >= 0;
  return (
    <span className={`text-[13px] font-medium ${good ? "text-[#00E599]" : "text-[#FF4D6D]"}`}>
      {ratio >= 0 ? "↑" : "↓"} {fmtChange(Math.abs(ratio)).replace("+", "")}
    </span>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const w = 110, h = 40, max = Math.max(...values), min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / (max - min || 1)) * (h - 6)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-[84px] shrink-0" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function KpiCard({ label, kpi, format, color }: { label: string; kpi: Kpi | null; format: (n: number) => string; color: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-[#0A0E0C] px-5 py-4">
      <p className="truncate text-[13px] text-white/80">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="mt-1 truncate text-[25px] font-semibold tracking-tight">{kpi ? format(kpi.value) : "—"}</p>
          <div className="mt-0.5">{kpi ? <Change ratio={kpi.change} /> : <span className="text-[12px] text-white/40">source unavailable</span>}</div>
        </div>
        {kpi && <Spark values={kpi.series} color={color} />}
      </div>
    </div>
  );
}

// ── Body ────────────────────────────────────────────────────────────────────

function Body({ data, range }: { data: Data; range: OnchainRange }) {
  const L = data.ledger.status === "ok" ? data.ledger.data : null;
  const usdC = (n: number) => fmtUsd(n, { compact: true });
  return (
    <>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Total Payment Volume" kpi={L?.kpis.volume ?? null} format={usdC} color={NEON} />
        <KpiCard label="Total Transactions" kpi={L?.kpis.transactions ?? null} format={(n) => fmtCount(n, { compact: true })} color="#3B82F6" />
        <KpiCard label="Unique Paying Users" kpi={L?.kpis.users ?? null} format={(n) => fmtCount(n)} color="#8B5CF6" />
        <KpiCard label="Active Recipients" kpi={L?.kpis.recipients ?? null} format={(n) => fmtCount(n)} color="#F5B83D" />
        <KpiCard label="Fees Earned" kpi={L?.kpis.fees ?? null} format={usdC} color={NEON} />
      </div>
      {data.ledger.status === "unavailable" && (
        <p className="mt-3 text-[12.5px] text-[#F5B83D]">FurlPay ledger unavailable: {data.ledger.reason}</p>
      )}
      {data.ledger.status === "ok" && data.ledger.note && <p className="mt-3 text-[12.5px] text-[#F5B83D]">{data.ledger.note}</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.12fr_0.86fr_1.05fr]">
        <PaymentVolume data={data} range={range} />
        <ChainDonut data={data} />
        <StablecoinFlows data={data} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.98fr_1.05fr]">
        <Categories data={data} />
        <Counterparties data={data} />
        <Activity data={data} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr_1.05fr]">
        <Risk data={data} />
        <Flow data={data} />
        <MarketInsights data={data} />
      </div>
      <p className="mt-5 text-[11.5px] text-white/40">
        Generated {new Date(data.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC · {chainLabel(data.chain)} · {RANGE_LABEL[range]}. Settled transactions only; changes compare with the equally long period before.
      </p>
    </>
  );
}

function PaymentVolume({ data, range }: { data: Data; range: OnchainRange }) {
  const L = data.ledger.status === "ok" ? data.ledger.data : null;
  const rows = L?.volumeByBucket ?? [];
  const totals = rows.map((r) => Object.values(r.tokens).reduce((a, b) => a + b, 0));
  const max = Math.max(0, ...totals);
  const exportCsv = () => {
    const head = ["bucket_start_utc", ...Object.keys(TOKEN_COLORS)].join(",");
    const body = rows.map((r) => [r.bucket, ...Object.keys(TOKEN_COLORS).map((k) => r.tokens[k as TokenKey].toFixed(2))].join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`${head}\n${body}\n`], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `furlpay-payment-volume-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
  return (
    <Card
      id="payments"
      title="Payment Volume"
      source={data.ledger.source}
      action={
        L && (
          <button onClick={exportCsv} className="flex items-center gap-1.5 rounded-lg border border-white/[0.12] px-2.5 py-1 text-[12px] text-white/85 hover:bg-white/[0.05]">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        )
      }
    >
      {!L ? (
        <Unavailable reason={data.ledger.status === "unavailable" ? data.ledger.reason : ""} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[25px] font-semibold">{fmtUsd(L.kpis.volume.value, { compact: true })}</p>
              <p className="text-[12.5px] text-white/60">
                <Change ratio={L.kpis.volume.change} /> vs last period
              </p>
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-white/75">
              {(Object.keys(TOKEN_COLORS) as TokenKey[]).map((t) => (
                <li key={t} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: TOKEN_COLORS[t] }} /> {t}
                </li>
              ))}
            </ul>
          </div>
          {max === 0 ? (
            <Empty text="No settled payments in this period." />
          ) : (
            <div className="mt-3 flex flex-1 gap-2">
              <div className="flex flex-col justify-between pb-5 text-right text-[10.5px] text-white/45">
                {[1, 0.66, 0.33, 0].map((f) => (
                  <span key={f}>{fmtUsd(max * f, { compact: true })}</span>
                ))}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-[118px] items-end gap-[2px] border-b border-white/[0.08]">
                  {rows.map((r, i) => (
                    <div key={r.bucket} className="flex h-full min-w-0 flex-1 flex-col-reverse" title={`${r.bucket.slice(0, 10)}: ${fmtUsd(totals[i])}`}>
                      {(Object.keys(TOKEN_COLORS) as TokenKey[]).map((t) =>
                        r.tokens[t] > 0 ? <div key={t} style={{ height: `${(r.tokens[t] / max) * 100}%`, background: TOKEN_COLORS[t] }} className="w-full first:rounded-b-[1px] last:rounded-t-[2px]" /> : null
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex text-[10.5px] text-white/45">
                  {rows.map((r, i) => (
                    <span key={r.bucket} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                      {i % labelEvery === 0
                        ? data.range.bucket === "hour"
                          ? new Date(r.bucket).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" })
                          : new Date(r.bucket).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
                        : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Donut({ items, size = 168, children }: { items: { value: number; color: string }[]; size?: number; children?: ReactNode }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const r = 40, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="13" />
        {total > 0 &&
          items.map((it, i) => {
            const len = (it.value / total) * c;
            const el = <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={it.color} strokeWidth="13" strokeDasharray={`${Math.max(0, len - 0.8)} ${c}`} strokeDashoffset={-acc} />;
            acc += len;
            return el;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

function ChainDonut({ data }: { data: Data }) {
  const L = data.ledger.status === "ok" ? data.ledger.data : null;
  const top = (L?.chains ?? []).slice(0, 5);
  const rest = (L?.chains ?? []).slice(5).reduce((a, c) => a + c.volume, 0);
  const items = [...top.map((c, i) => ({ label: chainLabel(c.chain), value: c.volume, color: PALETTE[i] })), ...(rest > 0 ? [{ label: "Others", value: rest, color: PALETTE[5] }] : [])];
  const total = items.reduce((a, b) => a + b.value, 0);
  return (
    <Card id="chains" title="Transactions by Chain" source={data.ledger.source} action={<span className="rounded-lg border border-white/[0.12] px-2.5 py-1 text-[12px] text-white/70">Volume</span>}>
      {!L ? (
        <Unavailable reason={data.ledger.status === "unavailable" ? data.ledger.reason : ""} />
      ) : total === 0 ? (
        <Empty text="No settled volume to break down by chain yet." />
      ) : (
        <div className="flex flex-1 flex-col items-center gap-4 sm:flex-row">
          <Donut items={items}>
            <span className="text-[19px] font-semibold">{fmtUsd(total, { compact: true })}</span>
            <span className="text-[11.5px] text-white/60">Total Volume</span>
          </Donut>
          <ul className="w-full space-y-2.5 text-[12.5px]">
            {items.map((it) => (
              <li key={it.label} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
                <span className="text-white/85">{it.label}</span>
                <span className="ml-auto tabular-nums text-white/70">{pct(it.value / total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function StablecoinFlows({ data }: { data: Data }) {
  const corr = data.corridors;
  const lines = corr.status === "ok" ? corr.data : [];
  const max = Math.max(1, ...lines.map((l) => l.volumeUsd));
  return (
    <Card title="Stablecoin Flows (Global)" source={corr.source}>
      <div className="grid flex-1 gap-3 sm:grid-cols-[1.35fr_1fr]">
        <svg viewBox={`0 0 ${WORLD.width} ${WORLD.height}`} className="w-full self-center" role="img" aria-label="World map of stablecoin corridors">
          {WORLD.dots.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={0.85} fill={lines.length ? "#17694F" : "#24453A"} />
          ))}
          {lines.map((l) => {
            const a = WORLD.centroids[l.from];
            const b = WORLD.centroids[l.to];
            if (!a || !b) return null;
            const mx = (a[0] + b[0]) / 2, my = Math.min(a[1], b[1]) - Math.abs(a[0] - b[0]) * 0.25;
            return (
              <g key={`${l.from}-${l.to}`}>
                <path d={`M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}`} fill="none" stroke={NEON} strokeOpacity={0.35 + 0.6 * (l.volumeUsd / max)} strokeWidth={0.6 + 1.4 * (l.volumeUsd / max)} />
                <circle cx={a[0]} cy={a[1]} r={1.6} fill={NEON} />
                <circle cx={b[0]} cy={b[1]} r={1.6} fill={NEON} />
              </g>
            );
          })}
        </svg>
        <div className="min-w-0">
          <p className="mb-2 text-[11.5px] text-white/60">Top Corridors</p>
          {corr.status === "unavailable" ? (
            <p className="text-[12px] leading-relaxed text-white/50">{corr.reason}</p>
          ) : lines.length === 0 ? (
            <p className="text-[12px] text-white/50">The Allium corridor query returned no rows.</p>
          ) : (
            <ul className="space-y-2.5 text-[12.5px]">
              {lines.map((l) => (
                <li key={`${l.from}-${l.to}`} className="flex items-center gap-2">
                  <span className="text-white/85">
                    {l.from} → {l.to}
                  </span>
                  <span className="ml-auto tabular-nums">{fmtUsd(l.volumeUsd, { compact: true })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function Categories({ data }: { data: Data }) {
  const L = data.ledger.status === "ok" ? data.ledger.data : null;
  return (
    <Card title="Top Payment Categories" source={data.ledger.source} action={<span className="rounded-lg border border-white/[0.12] px-2.5 py-1 text-[12px] text-white/70">Volume</span>}>
      {!L ? (
        <Unavailable reason={data.ledger.status === "unavailable" ? data.ledger.reason : ""} />
      ) : L.rails.length === 0 ? (
        <Empty text="No settled payments in this period." />
      ) : (
        <ul className="space-y-3.5">
          {L.rails.slice(0, 6).map((r) => {
            const Icon = RAIL_ICON[r.rail] ?? CircleDollarSign;
            const color = RAIL_COLOR[r.rail] ?? "#6B7280";
            return (
              <li key={r.rail} className="grid grid-cols-[22px_minmax(0,1.35fr)_minmax(48px,1fr)_46px] items-center gap-3 text-[13px]">
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md" style={{ background: `${color}22`, color }}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate text-white/90" title={`${fmtCount(r.count)} transactions`}>{railLabel(r.rail)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
                  <span className="block h-full rounded-full" style={{ width: `${r.share * 100}%`, background: color }} />
                </span>
                <span className="text-right tabular-nums text-white/85">{pct(r.share)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Counterparties({ data }: { data: Data }) {
  const L = data.ledger.status === "ok" ? data.ledger.data : null;
  return (
    <Card id="counterparties" title="Counterparties & Entities" source={`${data.ledger.source}; entity labels need Allium`}>
      {!L ? (
        <Unavailable reason={data.ledger.status === "unavailable" ? data.ledger.reason : ""} />
      ) : L.counterparties.length === 0 ? (
        <Empty text="No settled payments to a recipient address in this period." />
      ) : (
        <ul className="divide-y divide-white/[0.05] text-[12.5px]">
          {L.counterparties.map((c) => (
            <li key={c.address} className="grid grid-cols-[22px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 py-2">
              <ChainIcon chain={c.chain} />
              <span className="truncate font-mono text-white/90">{c.address}</span>
              <span className="text-white/55">Unlabeled</span>
              <span className="tabular-nums">{fmtUsd(c.volume, { compact: true })}</span>
              <span className="tabular-nums text-white/55">{fmtCount(c.count)} txs</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ChainIcon({ chain }: { chain: string | null }) {
  if (chain && CHAIN_LOGOS.has(chain)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/logos/chains/${chain}.svg`} alt={chainLabel(chain)} width={20} height={20} className="h-5 w-5 rounded-full" />;
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] text-[9px] font-semibold uppercase text-white/70" title={chain ?? "unknown chain"}>
      {(chain ?? "?").slice(0, 2)}
    </span>
  );
}

function Activity({ data }: { data: Data }) {
  const L = data.ledger.status === "ok" ? data.ledger.data : null;
  return (
    <Card title="Real-time Activity" source={data.ledger.source}>
      {!L ? (
        <Unavailable reason={data.ledger.status === "unavailable" ? data.ledger.reason : ""} />
      ) : L.activity.length === 0 ? (
        <Empty text="No ledger events in this period." />
      ) : (
        <ul className="divide-y divide-white/[0.05] text-[12.5px]">
          {L.activity.map((a, i) => {
            const Icon = RAIL_ICON[a.rail] ?? CircleDollarSign;
            const color = RAIL_COLOR[a.rail] ?? "#6B7280";
            return (
              <li key={`${a.at}-${i}`} className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-3 py-2">
                <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md" style={{ background: `${color}22`, color }}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate font-mono text-white/90">{a.hash ?? "no tx hash"}</span>
                <span className="truncate text-white/60">
                  {railLabel(a.rail)}
                  {a.state !== "settled" ? ` · ${a.state}` : ""}
                </span>
                <span className="tabular-nums">{a.amountUsd === null ? "—" : `${fmtUsd(a.amountUsd)}${a.token ? ` ${a.token.toUpperCase()}` : ""}`}</span>
                <span className="text-right text-white/50">{relTime(a.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Risk({ data }: { data: Data }) {
  const R = data.risk.status === "ok" ? data.risk.data : null;
  const lowShare = R && R.total > 0 ? R.bySeverity.low / R.total : null;
  const gauge = lowShare === null ? 0 : lowShare;
  const arc = Math.PI * 44;
  return (
    <Card id="risk" title="Risk & Compliance" source={data.risk.source}>
      {!R ? (
        <Unavailable reason={data.risk.status === "unavailable" ? data.risk.reason : ""} />
      ) : (
        <>
          <div className="flex items-center gap-5">
            <div className="relative h-[86px] w-[150px] shrink-0">
              <svg viewBox="0 0 100 56" className="h-full w-full" aria-hidden="true">
                <path d="M6,50 A44,44 0 0 1 94,50" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" strokeLinecap="round" />
                {R.total > 0 && <path d="M6,50 A44,44 0 0 1 94,50" fill="none" stroke={NEON} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${gauge * arc} ${arc}`} />}
              </svg>
              <div className="absolute inset-x-0 bottom-0 text-center">
                <p className="text-[21px] font-semibold">{lowShare === null ? "—" : pct(lowShare)}</p>
                <p className="text-[11px] text-white/60">{R.total === 0 ? "no events" : "Low severity"}</p>
              </div>
            </div>
            <ul className="w-full space-y-2 text-[12.5px]">
              {(
                [
                  ["Low / info", R.bySeverity.low, "#00E599"],
                  ["Medium", R.bySeverity.medium, "#F5B83D"],
                  ["High / critical", R.bySeverity.high, "#FF4D6D"],
                ] as const
              ).map(([l, v, c]) => (
                <li key={l} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                  <span className="text-white/80">{l}</span>
                  <span className="ml-auto tabular-nums">{fmtCount(v)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {(
              [
                ["Flagged Events", R.flagged],
                ["Sanctions Hits", R.sanctions],
                ["Critical Alerts", R.critical],
              ] as const
            ).map(([l, k]) => (
              <div key={l} className="rounded-lg border border-white/[0.07] bg-white/[0.015] px-3 py-2.5">
                <p className="text-[19px] font-semibold">{fmtCount(k.value)}</p>
                <p className="text-[11px] text-white/60">{l}</p>
                <Change ratio={k.change} invert />
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-white/40">Security events (replay, bad signature, limits, screening) recorded in this period.</p>
        </>
      )}
    </Card>
  );
}

function Flow({ data }: { data: Data }) {
  const L = data.ledger.status === "ok" ? data.ledger.data : null;
  const src = L?.flow.sources ?? [];
  const dst = L?.flow.destinations ?? [];
  const total = src.reduce((a, b) => a + b.value, 0);
  const layout = (xs: { value: number }[]) => {
    const t = xs.reduce((a, b) => a + b.value, 0) || 1;
    const gap = 6, h = 150 - gap * Math.max(0, xs.length - 1);
    let y = 5;
    return xs.map((x) => {
      const hh = Math.max(4, (x.value / t) * h);
      const r = { y, h: hh };
      y += hh + gap;
      return r;
    });
  };
  const ls = layout(src), ld = layout(dst);
  return (
    <Card title="Transaction Flow" source={`${data.ledger.source}: rail → destination chain`}>
      {!L ? (
        <Unavailable reason={data.ledger.status === "unavailable" ? data.ledger.reason : ""} />
      ) : total === 0 ? (
        <Empty text="No settled volume to trace in this period." />
      ) : (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(120px,1.3fr)_minmax(0,1fr)] items-stretch gap-2 text-[12px]">
          <div>
            <p className="mb-1 text-[11px] text-white/55">Sources</p>
            <div className="relative h-[160px]">
              {src.map((s, i) => (
                <div key={s.label} className="absolute inset-x-0 flex items-center justify-between gap-1" style={{ top: ls[i].y + ls[i].h / 2 - 8 }}>
                  <span className="truncate text-white/85">{SHORT_RAIL[s.label] ?? railLabel(s.label)}</span>
                  <span className="tabular-nums text-white/70">{fmtUsd(s.value, { compact: true })}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative mt-5 h-[160px]">
          <svg viewBox="0 0 200 160" preserveAspectRatio="none" className="h-[160px] w-full" aria-hidden="true">
            {src.map((s, i) => (
              <path key={`s${i}`} d={`M0,${ls[i].y + ls[i].h / 2} C60,${ls[i].y + ls[i].h / 2} 50,80 88,80`} fill="none" stroke={RAIL_COLOR[s.label] ?? PALETTE[i]} strokeOpacity="0.55" strokeWidth={Math.max(2, ls[i].h * 0.8)} />
            ))}
            {dst.map((d, i) => (
              <path key={`d${i}`} d={`M112,80 C150,80 140,${ld[i].y + ld[i].h / 2} 200,${ld[i].y + ld[i].h / 2}`} fill="none" stroke={PALETTE[i]} strokeOpacity="0.55" strokeWidth={Math.max(2, ld[i].h * 0.8)} />
            ))}
          </svg>
            <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-[#00E599]/50 bg-[#07120E]">
              <FurlPayMark size={24} />
            </span>
          </div>
          <div>
            <p className="mb-1 text-right text-[11px] text-white/55">Destinations</p>
            <div className="relative h-[160px]">
              {dst.map((d, i) => (
                <div key={d.label} className="absolute inset-x-0 flex items-center justify-between gap-1" style={{ top: ld[i].y + ld[i].h / 2 - 8 }}>
                  <span className="tabular-nums text-white/70">{fmtUsd(d.value, { compact: true })}</span>
                  <span className="truncate text-white/85">{chainLabel(d.label)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

type Tab = "supply" | "transfers" | "addresses";

function MarketInsights({ data }: { data: Data }) {
  const [tab, setTab] = useState<Tab>("supply");
  const M = data.market.status === "ok" ? data.market.data : null;
  const daily = data.alliumDaily.status === "ok" ? data.alliumDaily.data : [];
  const last = daily.at(-1) ?? null;
  const prev = daily.at(-2) ?? null;
  const r = (a: number | undefined, b: number | undefined) => (a !== undefined && b !== undefined && b > 0 ? (a - b) / b : null);
  const avg = (d: typeof last) => (d && d.transferCount > 0 ? d.transferVolumeUsd / d.transferCount : undefined);

  const series =
    tab === "supply"
      ? (M?.supplySeries ?? null)
      : data.alliumDaily.status === "ok"
        ? daily.map((d) => ({ date: d.day, value: tab === "transfers" ? d.transferVolumeUsd : d.activeAddresses }))
        : null;

  const metric = (label: string, value: string, change: number | null, invert = false) => (
    <div>
      <p className="text-[11.5px] text-white/70">{label}</p>
      <p className="flex items-baseline gap-3">
        <span className="text-[19px] font-semibold">{value}</span>
        {value !== "—" && <Change ratio={change} invert={invert} />}
      </p>
    </div>
  );
  const alliumMissing = data.alliumDaily.status === "unavailable" ? data.alliumDaily.reason : null;

  return (
    <Card id="market" title="Stablecoin Market Insights" source={`${data.market.source} (supply)${data.alliumDaily.status === "ok" ? `; ${data.alliumDaily.source}` : ""}`}>
      <div className="grid flex-1 gap-4 sm:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-2.5">
          {metric("Total Stablecoin Supply (USD-pegged)", M ? fmtUsd(M.totalSupplyUsd, { compact: true }) : "—", M?.supplyChange30d ?? null)}
          {metric("Daily Transfer Volume", last ? fmtUsd(last.transferVolumeUsd, { compact: true }) : "—", r(last?.transferVolumeUsd, prev?.transferVolumeUsd))}
          {metric("Active Addresses", last ? fmtCount(last.activeAddresses, { compact: true }) : "—", r(last?.activeAddresses, prev?.activeAddresses))}
          {metric("Avg Transfer Size", avg(last) !== undefined ? fmtUsd(avg(last)!) : "—", r(avg(last), avg(prev)))}
          {alliumMissing && <p className="text-[11px] leading-snug text-white/45">Transfer metrics: {alliumMissing}</p>}
          {data.market.status === "unavailable" && <p className="text-[11px] text-[#F5B83D]">Supply: {data.market.reason}</p>}
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex gap-1.5 text-[12px]" role="tablist">
            {(["supply", "transfers", "addresses"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md border px-3 py-1 capitalize ${tab === t ? "border-[#00E599]/60 bg-[#00E599]/[0.08] text-[#00E599]" : "border-white/[0.12] text-white/70 hover:text-white"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {series && series.length > 1 ? (
            <AreaChart points={series} money={tab !== "addresses"} />
          ) : (
            <Unavailable reason={tab === "supply" ? (data.market.status === "unavailable" ? data.market.reason : "No supply history returned.") : (alliumMissing ?? "No rows returned yet.")} />
          )}
        </div>
      </div>
    </Card>
  );
}

function AreaChart({ points, money }: { points: { date: string; value: number }[]; money: boolean }) {
  const w = 260, h = 130;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const lo = min - (max - min) * 0.1, hi = max + (max - min) * 0.05 || max + 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - ((p.value - lo) / (hi - lo || 1)) * h] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fmt = (n: number) => (money ? fmtUsd(n, { compact: true }) : fmtCount(n, { compact: true }));
  const ticks = [0, Math.floor((points.length - 1) / 3), Math.floor(((points.length - 1) * 2) / 3), points.length - 1];
  return (
    <div className="flex h-[150px] gap-1.5">
      <div className="flex flex-col justify-between pb-4 text-right text-[10px] text-white/45">
        <span>{fmt(hi)}</span>
        <span>{fmt((hi + lo) / 2)}</span>
        <span>{fmt(lo)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-[130px] w-full" role="img" aria-label="Trend chart">
          <defs>
            <linearGradient id="onchain-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={NEON} stopOpacity="0.35" />
              <stop offset="1" stopColor={NEON} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,${h} ${line} ${w},${h}`} fill="url(#onchain-area)" />
          <polyline points={line} fill="none" stroke={NEON} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="flex justify-between text-[10px] text-white/45">
          {ticks.map((i) => (
            <span key={i}>{new Date(`${points[i].date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
