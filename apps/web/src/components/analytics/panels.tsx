"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Cpu,
  Info,
  Network,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Sigma,
  UserPlus,
  Users,
  Zap,
  Activity,
} from "lucide-react";
import type { Dashboard, FeedItem, Kpi, Section } from "@/lib/analytics/dashboard";
import { PRODUCT_LABELS } from "@/lib/analytics/products";
import { useAnalytics } from "./AnalyticsFrame";
import { Donut, GrowthChart, Sparkline, StackedBars, seriesColor } from "./charts";
import { bucketLabel, flag, fmtChange, fmtCount, fmtPct, fmtUsd, relTime } from "./format";
import world from "./worldDots.json";

// ---------------------------------------------------------------------------
// Dashboard panels. Every panel renders one of four honest states:
//   loading      first poll in flight (skeleton)
//   unavailable  the source said why it cannot answer (reason shown verbatim)
//   empty        the source answered and there is nothing in the period
//   data
// No panel ever substitutes a sample value.
// ---------------------------------------------------------------------------

export function Card({ title, right, children, className = "", source }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; source?: string }) {
  return (
    <section aria-label={typeof title === "string" ? title : undefined} className={`min-w-0 rounded-2xl border border-white/[0.07] bg-[#0B100E] p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>}
          {right}
        </div>
      )}
      {children}
      {source && <SourceLine source={source} />}
    </section>
  );
}

/** Where a card's numbers come from, for which period, as of when. */
function SourceLine({ source }: { source: string }) {
  const { data, updatedAt } = useAnalytics();
  if (!data) return null;
  const b = data.range.buckets;
  const period = `${bucketLabel(b[0], data.range.bucket)} – ${bucketLabel(b[b.length - 1], data.range.bucket)} UTC`;
  return (
    <p className="mt-3 border-t border-white/[0.05] pt-2 text-[11px] text-textSecondary">
      Source: {source} · {period}
      {updatedAt ? ` · updated ${relTime(updatedAt)}` : ""}
    </p>
  );
}

/** Screen-reader summary of a series chart (the SVG itself is not readable). */
function ChartSummary({ label, values, buckets, bucket, usd = false }: { label: string; values: number[]; buckets: string[]; bucket: "hour" | "day"; usd?: boolean }) {
  if (!values.length) return null;
  const total = values.reduce((a, v) => a + v, 0);
  let peak = 0;
  values.forEach((v, i) => (v > values[peak] ? (peak = i) : null));
  const f = (n: number) => (usd ? fmtUsd(n) : fmtCount(n));
  return (
    <p className="sr-only">
      {label}: total {f(total)} over {values.length} {bucket === "hour" ? "hours" : "days"}; highest {f(values[peak])} at {bucketLabel(buckets[peak], bucket)}.
    </p>
  );
}

function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="w-full animate-pulse rounded-xl bg-white/[0.04]" style={{ height: h }} aria-label="Loading" />;
}

export function Unavailable({ reason, compact = false }: { reason: string; compact?: boolean }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border border-dashed border-white/[0.1] text-[12.5px] text-textSecondary ${compact ? "p-2.5" : "p-4"}`}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-medium text-[#C9CDCB]">No data.</span> {reason}
      </span>
    </div>
  );
}

function Empty({ text = "No analytics data available for this period." }: { text?: string }) {
  return <p className="py-6 text-center text-[13px] text-textSecondary">{text}</p>;
}

function Note({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 text-[11.5px] leading-snug text-textSecondary">{children}</p>;
}

/** Shared loading / error wrapper for a section of the dashboard payload. */
function useSection<T>(pick: (d: Dashboard) => Section<T>) {
  const { data } = useAnalytics();
  return data ? pick(data) : null;
}

function Change({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  const text = fmtChange(value);
  if (!text) return <span className="whitespace-nowrap text-[12px] text-textSecondary">no prior data</span>;
  const up = (value ?? 0) > 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 whitespace-nowrap text-[12.5px] font-medium ${value === 0 ? "text-textSecondary" : good ? "text-neon" : "text-[#E8A0A0]"}`}>
      {value !== 0 && <Icon className="h-3.5 w-3.5" />}
      {text}
    </span>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { v: "24h", l: "Last 24 hours" },
  { v: "7d", l: "Last 7 days" },
  { v: "30d", l: "Last 30 days" },
  { v: "90d", l: "Last 90 days" },
  { v: "custom", l: "Custom" },
] as const;

function Select({ value, onChange, children, label, icon }: { value: string; onChange: (v: string) => void; children: ReactNode; label: string; icon?: ReactNode }) {
  return (
    <label className="relative flex items-center rounded-lg border border-white/[0.1] bg-white/[0.02] text-[13px] focus-within:border-neon/60">
      {icon && <span className="pointer-events-none absolute left-3 text-textSecondary">{icon}</span>}
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none bg-transparent py-2 pr-8 text-white focus:outline-none ${icon ? "pl-9" : "pl-3"}`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-textSecondary" />
    </label>
  );
}

export function LiveBadge() {
  const { state, updatedAt } = useAnalytics();
  const meta = {
    connecting: { dot: "bg-white/40", text: "Connecting" },
    live: { dot: "bg-neon shadow-[0_0_8px_#00E599]", text: "Live" },
    degraded: { dot: "bg-[#E5C07B]", text: "Degraded" },
    offline: { dot: "bg-[#E06C75]", text: "Offline" },
  }[state];
  return (
    <span className="flex items-center gap-2 text-[13px]" role="status" aria-live="polite">
      <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
      <span className="font-medium">{meta.text}</span>
      {updatedAt && <span className="hidden text-[12px] text-textSecondary sm:inline">· updated {relTime(updatedAt)}</span>}
    </span>
  );
}

export function PageHeader({ eyebrow = "FurlPay Analytics", title, highlight, subtitle, hero = false }: { eyebrow?: string; title: string; highlight?: string; subtitle: string; hero?: boolean }) {
  const { query, setQuery, error, reload, state } = useAnalytics();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className={`relative ${hero ? "overflow-hidden pb-6" : "pb-4"}`}>
      {hero && <HeroGlobe />}
      <div className="relative flex flex-col gap-4 xl:flex-row xl:items-start xl:gap-8">
        <div className="min-w-0 shrink-0">
          <p className="text-[13.5px] text-[#C9CDCB]">{eyebrow}</p>
          <h1 className={`mt-1 font-bold leading-[1.05] tracking-tight xl:whitespace-nowrap ${hero ? "text-[34px] sm:text-[46px]" : "text-[28px]"}`}>
            {title} {highlight && <span className="text-neon">{highlight}</span>}
          </h1>
          <p className={`mt-2 text-[#9FDCC4] ${hero ? "text-[15px] sm:text-[17px]" : "text-[14px]"}`}>{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 xl:mt-8 xl:flex-nowrap">
          <Select label="Date range" value={query.range} onChange={(v) => setQuery({ range: v as typeof query.range })} icon={<CalendarDays className="h-4 w-4" />}>
            {RANGE_OPTIONS.map((o) => (
              <option key={o.v} value={o.v} className="bg-[#0B100E]">
                {o.l}
              </option>
            ))}
          </Select>
          {query.range === "custom" && (
            <span className="flex items-center gap-2 text-[13px]">
              <input
                type="date"
                aria-label="From date"
                max={query.to ?? today}
                value={query.from ?? ""}
                onChange={(e) => setQuery({ from: e.target.value })}
                className="rounded-lg border border-white/[0.1] bg-white/[0.02] px-2 py-1.5 text-white [color-scheme:dark]"
              />
              <span className="text-textSecondary">to</span>
              <input
                type="date"
                aria-label="To date"
                min={query.from}
                max={today}
                value={query.to ?? ""}
                onChange={(e) => setQuery({ to: e.target.value })}
                className="rounded-lg border border-white/[0.1] bg-white/[0.02] px-2 py-1.5 text-white [color-scheme:dark]"
              />
            </span>
          )}
          <Select label="Product" value={query.product} onChange={(v) => setQuery({ product: v })}>
            <option value="all" className="bg-[#0B100E]">All products</option>
            {Object.entries(PRODUCT_LABELS).map(([k, l]) => (
              <option key={k} value={k} className="bg-[#0B100E]">
                {l}
              </option>
            ))}
          </Select>
          <LiveBadge />
        </div>
      </div>
      {error && (
        <div className="relative mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#E06C75]/30 bg-[#E06C75]/[0.06] px-4 py-3 text-[13px]">
          <AlertTriangle className="h-4 w-4 text-[#E06C75]" />
          <span>
            {error.status === 401
              ? "Your session has ended. Sign in again to view analytics."
              : error.status === 403
                ? "Admin access required."
                : `Unable to load analytics data. ${error.message}`}
          </span>
          {state === "offline" && (
            <button onClick={() => void reload()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] px-3 py-1.5 hover:border-neon/60">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Decorative: the support portal's globe language, monochrome, behind the header. */
function HeroGlobe() {
  return (
    <div aria-hidden className="pointer-events-none absolute -top-4 right-0 hidden h-[190px] w-[300px] select-none xl:block">
      <svg viewBox="0 0 300 190" className="h-full w-full" fill="none">
        <defs>
          <radialGradient id="an-globe" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#00E599" stopOpacity="0.25" />
            <stop offset="75%" stopColor="#00E599" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#00E599" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="160" cy="95" r="88" fill="url(#an-globe)" />
        {[28, 56, 82].map((r) => (
          <ellipse key={r} cx="160" cy="95" rx={r} ry="84" stroke="#00E599" strokeOpacity="0.16" />
        ))}
        {[-50, -25, 0, 25, 50].map((dy) => (
          <ellipse key={dy} cx="160" cy={95 + dy} rx={Math.sqrt(Math.max(0, 84 * 84 - dy * dy * 1.6)) * 0.97} ry="7" stroke="#00E599" strokeOpacity="0.13" />
        ))}
        <ellipse cx="160" cy="95" rx="140" ry="44" stroke="#00E599" strokeOpacity="0.28" strokeDasharray="3 6" transform="rotate(-14 160 95)" />
      </svg>
    </div>
  );
}

// ── KPI strip ────────────────────────────────────────────────────────────────

const KPI_DEFS: { key: keyof Dashboard["kpis"]; label: string; Icon: typeof Users; usd?: boolean }[] = [
  { key: "totalUsers", label: "Total Users", Icon: Users },
  { key: "newSignups", label: "New Signups", Icon: UserPlus },
  { key: "kycCompleted", label: "KYC Completed", Icon: ShieldCheck },
  { key: "activeUsers", label: "Active Users", Icon: Activity },
  { key: "transactions", label: "Total Transactions", Icon: Building2 },
  { key: "volume", label: "Transaction Volume", Icon: CircleDollarSign, usd: true },
];

export function KpiStrip({ only }: { only?: (keyof Dashboard["kpis"])[] }) {
  const { data } = useAnalytics();
  const defs = only ? KPI_DEFS.filter((d) => only.includes(d.key)) : KPI_DEFS;
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3 2xl:grid-cols-6">
      {defs.map(({ key, label, Icon, usd }) => {
        const s = data?.kpis[key];
        return (
          <div key={key} className="min-w-[230px] snap-start overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0B100E] p-3.5 sm:min-w-0">
            <div className="flex items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neon/[0.1] text-neon">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-[#D3D7D5]" title={s?.status === "ok" ? s.note : undefined}>
                  {label}
                </p>
                {!s ? (
                  <div className="mt-2 h-7 w-24 animate-pulse rounded bg-white/[0.05]" />
                ) : s.status === "ok" ? (
                  <KpiValue kpi={s.data} usd={usd} />
                ) : (
                  <p className="mt-1 text-[12px] leading-snug text-textSecondary" title={s.reason}>
                    No data · <span className="line-clamp-2">{s.reason}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KpiValue({ kpi, usd }: { kpi: Kpi; usd?: boolean }) {
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[23px] font-semibold leading-tight tracking-tight">{usd ? fmtUsd(kpi.value, { compact: true }) : fmtCount(kpi.value)}</p>
        <Sparkline values={kpi.series} width={68} height={26} />
      </div>
      <Change value={kpi.change} />
    </div>
  );
}

// ── User growth ──────────────────────────────────────────────────────────────

export function UserGrowthPanel({ tall = false }: { tall?: boolean }) {
  const { data } = useAnalytics();
  const s = useSection((d) => d.growth);
  return (
    <Card title="User Growth" source="users.created_at; audit_log (non-admin actions)">
      {!s || !data ? (
        <Skeleton h={tall ? 340 : 230} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[26px] font-semibold tracking-tight">{fmtCount(s.data.totalUsers)}</span>
            <Change value={s.data.change} />
            {s.data.change !== null && <span className="text-[12.5px] text-textSecondary">from start of period</span>}
          </div>
          <div className={tall ? "mt-3 h-[300px]" : "mt-3 h-[190px]"}>
            <ChartSummary label="New users" values={s.data.newUsers} buckets={data.range.buckets} bucket={data.range.bucket} />
            {s.data.activeUsers && <ChartSummary label="Active users" values={s.data.activeUsers} buckets={data.range.buckets} bucket={data.range.bucket} />}
            <GrowthChart
              buckets={data.range.buckets}
              bucket={data.range.bucket}
              primary={s.data.newUsers}
              secondary={s.data.activeUsers}
              primaryLabel="New users"
              secondaryLabel="Active users"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-5 text-[12.5px] text-[#C9CDCB]">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-neon" /> New users</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#8E9A95]" /> Active users</span>
          </div>
          {!s.data.activeUsers && <Note>Active users unavailable: {s.data.activeNote}</Note>}
        </>
      )}
    </Card>
  );
}

// ── Funnel ───────────────────────────────────────────────────────────────────

export function FunnelPanel() {
  const s = useSection((d) => d.funnel);
  return (
    <Card title="Acquisition Funnel" source="users, linked_wallets, ops_tx_events, analytics_events">
      {!s ? (
        <Skeleton h={230} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : s.data.cohortSize === 0 ? (
        <Empty text="No signups in this period, so there is no cohort to follow." />
      ) : (
        <>
          <ul className="space-y-2.5">
            {s.data.stages.map((st) => {
              const pct = st.count !== null && !st.context ? st.count / s.data.cohortSize : null;
              return (
                <li key={st.key} className="grid grid-cols-[118px_1fr_64px] items-center gap-3 text-[13px]">
                  <span className="truncate text-[#D3D7D5]">{st.label}</span>
                  {st.context && st.tracked ? (
                    <span className="truncate text-[11.5px] text-textSecondary" title={st.note}>
                      {st.note}
                    </span>
                  ) : st.tracked && pct !== null ? (
                    <span className="relative h-[22px] overflow-hidden rounded-md bg-white/[0.04]">
                      <span className="absolute inset-y-0 left-0 rounded-md bg-neon" style={{ width: `${Math.max(pct * 100, 1.5)}%` }} />
                      <span
                        className={`absolute inset-y-0 flex items-center text-[12px] font-medium ${pct > 0.2 ? "left-2 text-black" : "text-white"}`}
                        style={pct > 0.2 ? undefined : { left: `calc(${Math.max(pct * 100, 1.5)}% + 6px)` }}
                      >
                        {fmtPct(pct)}
                      </span>
                    </span>
                  ) : (
                    <span className="truncate rounded-md border border-dashed border-white/[0.1] px-2 py-0.5 text-[11.5px] text-textSecondary" title={st.note}>
                      {st.context ? "Unavailable" : "Not tracked"} · {st.note}
                    </span>
                  )}
                  <span className="text-right tabular-nums text-[#C9CDCB]">{st.count === null ? "—" : fmtCount(st.count)}</span>
                </li>
              );
            })}
          </ul>
          <Note>{s.note}{s.data.truncated ? " Cohort hit the row limit; counts are a lower bound." : ""}</Note>
        </>
      )}
    </Card>
  );
}

// ── Geography ────────────────────────────────────────────────────────────────

const WORLD = world as unknown as { width: number; height: number; dots: [number, number][]; centroids: Record<string, [number, number]> };

export function GeoPanel({ rows = 9 }: { rows?: number }) {
  const s = useSection((d) => d.geo);
  const countries = s?.status === "ok" ? s.data.countries : [];
  const top = countries.slice(0, rows);
  const rest = countries.slice(rows);
  const others = rest.reduce((a, c) => a + c.users, 0);
  const total = s?.status === "ok" ? s.data.total : 0;
  const max = Math.max(1, ...countries.map((c) => c.users));
  return (
    <Card title="Geographic Distribution" source="middleware telemetry (Vercel country header, signed-in users)">
      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <svg viewBox={`0 0 ${WORLD.width} ${WORLD.height}`} className="w-full" role="img" aria-label="World map of active users by country">
          {WORLD.dots.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={0.9} fill="#2C3A35" />
          ))}
          {countries.map((c) => {
            const p = WORLD.centroids[c.code];
            if (!p) return null;
            const r = 2 + (c.users / max) * 5;
            return (
              <g key={c.code}>
                <circle cx={p[0]} cy={p[1]} r={r * 1.9} fill="#00E599" fillOpacity={0.14} />
                <circle cx={p[0]} cy={p[1]} r={r * 0.55} fill="#00E599">
                  <title>{`${c.name}: ${fmtCount(c.users)}`}</title>
                </circle>
              </g>
            );
          })}
        </svg>
        <div>
          {!s ? (
            <Skeleton h={200} />
          ) : s.status !== "ok" ? (
            <Unavailable reason={s.reason} compact />
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11.5px] text-textSecondary">
                  <th className="pb-1.5 font-normal">Top countries</th>
                  <th className="pb-1.5 text-right font-normal">Users</th>
                  <th className="pb-1.5 text-right font-normal">%</th>
                </tr>
              </thead>
              <tbody>
                {top.map((c) => (
                  <tr key={c.code} className="text-[#D3D7D5]">
                    <td className="max-w-[150px] truncate whitespace-nowrap py-[3px] pr-2" title={c.name}><CountryBadge code={c.code} />{c.name}</td>
                    <td className="py-[3px] pl-2 text-right tabular-nums">{fmtCount(c.users)}</td>
                    <td className="py-[3px] pl-3 text-right tabular-nums text-textSecondary">{fmtPct(c.pct)}</td>
                  </tr>
                ))}
                {rest.length > 0 && (
                  <tr className="text-[#D3D7D5]">
                    <td className="py-[3px]"><span className="mr-2 inline-block h-3 w-3 rounded-full bg-white/30 align-middle" />Others ({rest.length})</td>
                    <td className="py-[3px] text-right tabular-nums">{fmtCount(others)}</td>
                    <td className="py-[3px] text-right tabular-nums text-textSecondary">{fmtPct(total ? others / total : null)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {s?.status === "ok" && <Note>{s.note}</Note>}
    </Card>
  );
}

/** Country code chip: renders the same on every OS (flag emoji do not on Windows). */
function CountryBadge({ code }: { code: string }) {
  return (
    <span className="mr-2 inline-flex h-[15px] w-[22px] items-center justify-center rounded-[3px] border border-white/[0.12] bg-white/[0.04] align-[-2px] text-[9px] font-semibold tracking-wide text-[#C9CDCB]" title={flag(code)}>
      {code}
    </span>
  );
}

// ── Transactions ─────────────────────────────────────────────────────────────

export function VolumePanel({ tall = false }: { tall?: boolean }) {
  const { data } = useAnalytics();
  const s = useSection((d) => d.transactions);
  return (
    <Card title="Transaction Volume" source="ops_tx_events, state = settled">
      {!s || !data ? (
        <Skeleton h={tall ? 340 : 230} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[26px] font-semibold tracking-tight">{fmtUsd(s.data.volume)}</span>
            <Change value={s.data.change} />
            {s.data.change !== null && <span className="text-[12.5px] text-textSecondary">from previous period</span>}
          </div>
          {s.data.byToken.length === 0 ? (
            <Empty text="No settled transactions in this period." />
          ) : (
            <>
              <div className={tall ? "mt-3 h-[300px]" : "mt-3 h-[190px]"}>
                <ChartSummary label="Settled volume" usd values={s.data.byToken.reduce((acc, t) => acc.map((v, i) => v + (t.values[i] ?? 0)), data.range.buckets.map(() => 0))} buckets={data.range.buckets} bucket={data.range.bucket} />
                <StackedBars buckets={data.range.buckets} bucket={data.range.bucket} series={s.data.byToken.map((t) => ({ name: t.token, values: t.values }))} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[12.5px] text-[#C9CDCB]">
                {s.data.byToken.map((t, i) => (
                  <span key={t.token} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: seriesColor(i) }} /> {t.token}
                  </span>
                ))}
              </div>
            </>
          )}
          <Note>
            Settled crypto volume from the ops ledger, by token. Card payments are not shown: no card rail records to the ledger yet.
            {s.data.truncated ? " Row limit reached; totals are a lower bound." : ""}
          </Note>
        </>
      )}
    </Card>
  );
}

export function ProductUsagePanel() {
  const s = useSection((d) => d.products);
  return (
    <Card title="Product Usage" source="ops_tx_events: distinct settled users per rail">
      {!s ? (
        <Skeleton h={200} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : (
        <>
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <Donut size={150} items={s.data.items.map((i) => ({ label: i.label, share: i.pct }))}>
              <span className="text-[24px] font-semibold leading-none">{fmtCount(s.data.totalUsers, { compact: true })}</span>
              <span className="mt-1 max-w-[84px] text-[11px] leading-tight text-textSecondary">transacting users</span>
            </Donut>
            <ul className="w-full space-y-2.5 text-[13px]">
              {s.data.items.map((it, i) => (
                <li key={it.rail} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2.5 text-[#D3D7D5]">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: seriesColor(i) }} /> <span className="truncate">{it.label}</span>
                  </span>
                  <span className="tabular-nums text-[#C9CDCB]">{fmtPct(it.pct)}</span>
                </li>
              ))}
            </ul>
          </div>
          <Note>{s.note}</Note>
        </>
      )}
    </Card>
  );
}

// ── Observability ────────────────────────────────────────────────────────────

export function ObservabilityPanel() {
  const { data } = useAnalytics();
  const o = data?.observability;
  const tile = (title: string, Icon: typeof Zap, section: Section<{ total: number; change?: number | null; rate?: number; series: number[] }> | undefined, kind: "requests" | "errors") => (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-3.5">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kind === "errors" && section?.status === "ok" && section.data.total > 0 ? "bg-[#E06C75]/10 text-[#E06C75]" : "bg-neon/[0.1] text-neon"}`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-[#D3D7D5]">{title}</p>
          {!section ? (
            <div className="mt-2 h-6 w-16 animate-pulse rounded bg-white/[0.05]" />
          ) : section.status !== "ok" ? (
            <p className="mt-1 text-[11.5px] leading-snug text-textSecondary">N/A · {section.reason}</p>
          ) : kind === "requests" ? (
            <div className="mt-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[21px] font-semibold leading-tight">{fmtCount(section.data.total, { compact: true })}</p>
                <Sparkline values={section.data.series} width={72} height={26} />
              </div>
              <Change value={section.data.change} />
            </div>
          ) : (
            <div className="mt-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[21px] font-semibold leading-tight">{fmtPct(section.data.rate ?? null, 2)}</p>
                <Sparkline values={section.data.series} width={72} height={26} color={section.data.total ? "#E06C75" : "#00E599"} />
              </div>
              <p className={`whitespace-nowrap text-[12px] ${section.data.total ? "text-[#E8A0A0]" : "text-neon"}`}>
                {section.data.total ? `${fmtCount(section.data.total)} unhandled` : "No unhandled errors"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  const na = (title: string, Icon: typeof Zap, section: Section<never> | undefined) => (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-textSecondary">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] text-[#D3D7D5]">{title}</p>
          <p className="mt-1 text-[11.5px] leading-snug text-textSecondary">
            N/A · {section && section.status !== "ok" ? section.reason : "Loading…"}
          </p>
        </div>
      </div>
    </div>
  );
  return (
    <Card title="System Observability" source="middleware request counter; onRequestError">
      <div className="grid gap-3 sm:grid-cols-2">
        {tile("Customer API Requests", Network, o?.requests as never, "requests")}
        {na("Function Invocations", Zap, o?.invocations as never)}
        {tile("Error Rate", AlertTriangle, o?.errors as never, "errors")}
        {na("Avg. Response Time", Clock, o?.latency as never)}
      </div>
      {o?.errors.status === "ok" && <Note>{o.errors.note}</Note>}
    </Card>
  );
}

// ── Live feed ────────────────────────────────────────────────────────────────

const FEED_FILTERS = [
  { v: "all", l: "All events" },
  { v: "signup", l: "Signups" },
  { v: "transaction", l: "Transactions" },
  { v: "security", l: "Security" },
] as const;

const FEED_ICON: Record<FeedItem["kind"], typeof Users> = { signup: UserPlus, transaction: Sigma, security: ShieldAlert };

export function FeedPanel({ limit = 8, search = "" }: { limit?: number; search?: string }) {
  const s = useSection((d) => d.feed);
  const [filter, setFilter] = useState<string>("all");
  const items = useMemo(() => {
    if (s?.status !== "ok") return [];
    const q = search.trim().toLowerCase();
    return s.data.items
      .filter((i) => filter === "all" || i.kind === filter)
      .filter((i) => !q || `${i.event} ${i.user} ${i.details}`.toLowerCase().includes(q))
      .slice(0, limit);
  }, [s, filter, limit, search]);
  return (
    <Card
      title="Live Activity Feed"
      right={
        <Select label="Event filter" value={filter} onChange={setFilter}>
          {FEED_FILTERS.map((f) => (
            <option key={f.v} value={f.v} className="bg-[#0B100E]">{f.l}</option>
          ))}
        </Select>
      }
    >
      {!s ? (
        <Skeleton h={180} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : items.length === 0 ? (
        <Empty text={search ? `No events match “${search}”.` : "No events yet."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[12.5px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[11.5px] text-textSecondary">
                <th className="pb-2 pr-3 font-normal">Time</th>
                <th className="pb-2 pr-3 font-normal">Event</th>
                <th className="pb-2 pr-3 font-normal">User</th>
                <th className="pb-2 pr-3 font-normal">Location</th>
                <th className="pb-2 font-normal">Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, k) => {
                const Icon = FEED_ICON[i.kind];
                return (
                  <tr key={`${i.ts}-${k}`} className="border-b border-white/[0.04] text-[#D3D7D5] last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-neon" />{relTime(i.ts)}</td>
                    <td className="whitespace-nowrap py-2 pr-3"><Icon className="mr-2 inline h-3.5 w-3.5 text-neon" />{i.event}</td>
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-[12px]">{i.user}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-textSecondary">{i.location ?? "—"}</td>
                    <td className="py-2 text-textSecondary">{i.details}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Errors & alerts ──────────────────────────────────────────────────────────

const LEVEL_STYLE = {
  Critical: { cls: "text-[#E06C75]", Icon: ShieldAlert },
  Error: { cls: "text-[#E8A0A0]", Icon: AlertTriangle },
  Warning: { cls: "text-[#E5C07B]", Icon: AlertTriangle },
  Info: { cls: "text-[#9FDCC4]", Icon: Info },
} as const;

export function AlertsPanel({ limit = 6, search = "" }: { limit?: number; search?: string }) {
  const s = useSection((d) => d.alerts);
  const items = useMemo(() => {
    if (s?.status !== "ok") return [];
    const q = search.trim().toLowerCase();
    return s.data.items.filter((i) => !q || `${i.level} ${i.service} ${i.message}`.toLowerCase().includes(q)).slice(0, limit);
  }, [s, limit, search]);
  return (
    <Card title="Recent Errors & Alerts" source="ops_security_events; unhandled server errors" right={<a href="/ops" className="text-[13px] text-neon hover:underline">View all</a>}>
      {!s ? (
        <Skeleton h={180} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : items.length === 0 ? (
        <Empty text="No recent errors or alerts in this period." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[11.5px] text-textSecondary">
                <th className="pb-2 pr-3 font-normal">Time</th>
                <th className="pb-2 font-normal">Level</th>
                <th className="pb-2 font-normal">Service</th>
                <th className="pb-2 font-normal">Message</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, k) => {
                const st = LEVEL_STYLE[i.level];
                return (
                  <tr key={`${i.ts}-${k}`} className="border-b border-white/[0.04] text-[#D3D7D5] last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">{relTime(i.ts)}</td>
                    <td className={`whitespace-nowrap py-2 pr-3 ${st.cls}`}><st.Icon className="mr-1.5 inline h-3.5 w-3.5" />{i.level}</td>
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-[12px]">{i.service}</td>
                    <td className="py-2 text-textSecondary">{i.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Traffic ──────────────────────────────────────────────────────────────────

export function TrafficPanel() {
  const { data } = useAnalytics();
  const s = useSection((d) => d.traffic);
  return (
    <Card title="Website Traffic" source="middleware telemetry (page views; cookieless daily visitor hash)">
      {!s || !data ? (
        <Skeleton h={200} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <Stat label="Page views" value={fmtCount(s.data.pageViews)} />
            <Stat label="Unique visitors / day (avg)" value={s.data.avgDailyVisitors === null ? "N/A" : fmtCount(s.data.avgDailyVisitors)} />
            <Stat label="Sessions" value="Not tracked" />
            <Stat label="Signed-in active users" value={data.kpis.activeUsers.status === "ok" ? fmtCount(data.kpis.activeUsers.data.value) : "N/A"} />
          </div>
          <div className="mt-3 h-[200px]">
            <ChartSummary label="Page views" values={s.data.pageViewSeries} buckets={data.range.buckets} bucket={data.range.bucket} />
            <StackedBars usd={false} buckets={data.range.buckets} bucket={data.range.bucket} series={[{ name: "Page views", values: s.data.pageViewSeries }]} />
          </div>
          <Note>{s.note}</Note>
        </>
      )}
    </Card>
  );
}

// ── Platforms ────────────────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<string, string> = { web: "Web", chrome_extension: "Chrome extension", android: "Android", ios: "iOS", api: "Server (api)" };

export function PlatformsPanel() {
  const s = useSection((d) => d.platforms);
  return (
    <Card title="Platforms & Versions" source="analytics_events (server + client), analytics_platforms / analytics_versions">
      {!s ? (
        <Skeleton h={200} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : (
        <>
          <p className="mb-2 text-[13px] text-[#C9CDCB]">
            Distinct signed-in users across all platforms: <span className="font-semibold text-white">{fmtCount(s.data.allUsers)}</span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[12.5px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-[11.5px] text-textSecondary">
                  <th className="pb-2 pr-3 font-normal">Platform</th>
                  <th className="pb-2 pr-3 text-right font-normal">Signed-in users</th>
                  <th className="pb-2 pr-3 text-right font-normal">Anonymous sessions</th>
                  <th className="pb-2 pr-3 text-right font-normal">Events</th>
                  <th className="pb-2 text-right font-normal">Errors</th>
                </tr>
              </thead>
              <tbody>
                {s.data.platforms.map((x) => (
                  <tr key={x.platform} className="border-b border-white/[0.04] text-[#D3D7D5] last:border-0">
                    <td className="py-1.5 pr-3">{PLATFORM_LABEL[x.platform] ?? x.platform}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCount(x.users)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCount(x.anonymous)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCount(x.events)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtCount(x.errors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.data.versions.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[12px] text-textSecondary">App / extension versions (reported by clients)</p>
              <ul className="grid gap-1 text-[12.5px] sm:grid-cols-2">
                {s.data.versions.slice(0, 12).map((v) => (
                  <li key={`${v.platform}-${v.version}`} className="flex justify-between gap-3 text-[#D3D7D5]">
                    <span>{PLATFORM_LABEL[v.platform] ?? v.platform} {v.version}</span>
                    <span className="tabular-nums text-textSecondary">{fmtCount(v.users)} users · {fmtCount(v.installs)} installs</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Note>{s.note}</Note>
        </>
      )}
    </Card>
  );
}

// ── Revenue ──────────────────────────────────────────────────────────────────

export function RevenuePanel() {
  const { data } = useAnalytics();
  const s = useSection((d) => d.transactions);
  return (
    <Card title="Fee Revenue" source="ops_tx_events.fee_usd, state = settled">
      {!s || !data ? (
        <Skeleton h={300} />
      ) : s.status !== "ok" ? (
        <Unavailable reason={s.reason} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[26px] font-semibold tracking-tight">{fmtUsd(s.data.fees)}</span>
            <Change value={s.data.feesChange} />
            <span className="text-[12.5px] text-textSecondary">fees on settled transactions</span>
          </div>
          <div className="mt-3 h-[280px]">
            <ChartSummary label="Fees" usd values={s.data.feeSeries} buckets={data.range.buckets} bucket={data.range.bucket} />
            <StackedBars buckets={data.range.buckets} bucket={data.range.bucket} series={[{ name: "Fees", values: s.data.feeSeries }]} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <Stat label="Settled volume" value={fmtUsd(s.data.volume)} />
            <Stat label="Settled transactions" value={fmtCount(s.data.count)} />
            <Stat label="Effective take rate" value={s.data.volume > 0 ? fmtPct(s.data.fees / s.data.volume, 2) : "—"} />
            <Stat label="Failed / rejected" value={fmtCount(s.data.failed)} />
          </div>
          <Note>Fees recorded on ops-ledger settlement events. Subscription and integrator (LI.FI) revenue are reported on the ops control plane, not here.</Note>
        </>
      )}
    </Card>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
      <p className="text-[11.5px] text-textSecondary">{label}</p>
      <p className="mt-0.5 text-[16px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function RangeCaption() {
  const { data } = useAnalytics();
  if (!data) return null;
  const b = data.range.buckets;
  return (
    <p className="mb-3 flex items-center gap-1.5 text-[12px] text-textSecondary">
      <Cpu className="h-3.5 w-3.5" />
      {bucketLabel(b[0], data.range.bucket)} – {bucketLabel(b[b.length - 1], data.range.bucket)} (UTC) · {data.product === "all" ? "All products" : PRODUCT_LABELS[data.product as keyof typeof PRODUCT_LABELS]}
    </p>
  );
}
