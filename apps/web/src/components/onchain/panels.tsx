"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeftRight, Bot, CircleDollarSign, Download, Link2, Wallet, type LucideIcon } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import type { OnchainDashboard as Data, Kpi, TokenKey } from "@/lib/onchain/dashboard";
import world from "@/components/analytics/worldDots.json";
import { fmtCount, fmtUsd, relTime } from "@/components/analytics/format";
import { CHAINS } from "./Shell";
import { Card, Change, Empty, GhostButton, Menu, NEON, PALETTE, RAIL_COLOR, SHORT_RAIL, Spark, TipBox, Unavailable, chainLabel, pct, railLabel } from "./ui";

// The cards of /onchain. Each takes the whole payload and reads only its own
// section; an unavailable section renders its reason in place of the chart.

const TOKEN_COLORS: Record<TokenKey, string> = { USDC: "#2F80ED", USDT: "#10D9A0", BTC: "#F7931A", ETH: "#8B5CF6", SOL: "#EC4899", OTHER: "#6B7280" };
const RAIL_ICON: Record<string, LucideIcon> = { x402: Bot, mpp: Bot, lifi: ArrowLeftRight, cctp: Link2, transfers: Wallet };
const CHAIN_LOGOS = new Set(["arbitrum", "avalanche", "ethereum", "gnosis", "optimism", "polygon", "solana"]);
const WORLD = world as unknown as { width: number; height: number; dots: [number, number][]; centroids: Record<string, [number, number]> };
const usdC = (n: number) => fmtUsd(n, { compact: true });
const axisUsd = (n: number) => (n === 0 ? "$0" : fmtUsd(n, { compact: true }).replace(".0", ""));
const ledgerOf = (d: Data) => (d.ledger.status === "ok" ? d.ledger.data : null);
const ledgerReason = (d: Data) => (d.ledger.status === "unavailable" ? d.ledger.reason : "");
const matches = (q: string, ...xs: (string | null | undefined)[]) => !q || xs.some((x) => x?.toLowerCase().includes(q.toLowerCase()));

// ── KPIs ────────────────────────────────────────────────────────────────────

function KpiCard({ label, kpi, format, color }: { label: string; kpi: Kpi | null; format: (n: number) => string; color: string }) {
  return (
    <div className="relative h-[105px] min-w-0 rounded-[10px] border border-white/[0.075] bg-[#0A0F10] px-[19px] pb-[14px] pt-[15px]">
      <p className="truncate text-[13px] text-white/85">{label}</p>
      <p className="mt-[3px] truncate text-[24px] font-bold leading-tight tracking-[-0.01em] text-white">{kpi ? format(kpi.value) : "—"}</p>
      <div className="mt-[5px]">{kpi ? <Change ratio={kpi.change} /> : <span className="text-[12px] text-white/35">source unavailable</span>}</div>
      {kpi && (
        <div className="absolute bottom-[14px] right-[14px] hidden min-[1380px]:block sm:max-lg:block">
          <Spark values={kpi.series} color={color} />
        </div>
      )}
    </div>
  );
}

export function KpiRow({ data }: { data: Data }) {
  const L = ledgerOf(data);
  return (
    <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard label="Total Payment Volume" kpi={L?.kpis.volume ?? null} format={usdC} color="#10D9A0" />
      <KpiCard label="Total Transactions" kpi={L?.kpis.transactions ?? null} format={(n) => fmtCount(n, { compact: true })} color="#2F80ED" />
      <KpiCard label="Unique Paying Users" kpi={L?.kpis.users ?? null} format={(n) => fmtCount(n)} color="#9B5CF6" />
      <KpiCard label="Active Recipients" kpi={L?.kpis.recipients ?? null} format={(n) => fmtCount(n)} color="#F5B83D" />
      <KpiCard label="Fees Earned" kpi={L?.kpis.fees ?? null} format={usdC} color="#10D9A0" />
    </div>
  );
}

// ── Payment volume ──────────────────────────────────────────────────────────

export function PaymentVolume({ data, chain, setChain, rangeKey }: { data: Data; chain: string; setChain: (c: string) => void; rangeKey: string }) {
  const L = ledgerOf(data);
  const rows = (L?.volumeByBucket ?? []).map((r) => ({
    label:
      data.range.bucket === "hour"
        ? new Date(r.bucket).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "UTC" })
        : new Date(r.bucket).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    ...r.tokens,
  }));
  const tokens = (Object.keys(TOKEN_COLORS) as TokenKey[]).filter((t) => t !== "OTHER" || rows.some((r) => r.OTHER > 0));
  const total = rows.reduce((a, r) => a + tokens.reduce((s, t) => s + r[t], 0), 0);
  const exportCsv = () => {
    const keys = Object.keys(TOKEN_COLORS) as TokenKey[];
    const lines = (L?.volumeByBucket ?? []).map((r) => [r.bucket, ...keys.map((k) => r.tokens[k].toFixed(2))].join(","));
    const url = URL.createObjectURL(new Blob([`bucket_start_utc,${keys.join(",")}\n${lines.join("\n")}\n`], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `furlpay-payment-volume-${rangeKey}-${chain}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card
      id="payments"
      title="Payment Volume"
      source={data.ledger.source}
      action={
        <>
          <Menu label="Chain" width={150} value={chain} onChange={setChain} options={CHAINS.map((c) => [c, chainLabel(c)] as const)} />
          <GhostButton onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export
          </GhostButton>
        </>
      }
    >
      {!L ? (
        <Unavailable reason={ledgerReason(data)} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div>
              <p className="text-[24px] font-bold leading-tight">{usdC(L.kpis.volume.value)}</p>
              <p className="mt-0.5 text-[13px] text-white/65">
                <Change ratio={L.kpis.volume.change} /> <span className="ml-1">vs last period</span>
              </p>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-white/85">
              {tokens.map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: TOKEN_COLORS[t] }} /> {t}
                </li>
              ))}
            </ul>
          </div>
          {total === 0 ? (
            <Empty text="No settled payments in this period." />
          ) : (
            <div className="-ml-2 mt-1 h-[118px] min-h-[118px] flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} barCategoryGap="22%" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10.5 }} tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.1)" }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis width={46} tickFormatter={axisUsd} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10.5 }} tickLine={false} axisLine={false} tickCount={4} />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    content={({ active, payload, label }) =>
                      active && payload?.length ? (
                        <TipBox title={String(label)} rows={[...payload].reverse().filter((p) => Number(p.value) > 0).map((p) => ({ label: String(p.dataKey), value: fmtUsd(Number(p.value)), color: TOKEN_COLORS[p.dataKey as TokenKey] }))} />
                      ) : null
                    }
                  />
                  {tokens.map((t, i) => (
                    <Bar key={t} dataKey={t} stackId="v" fill={TOKEN_COLORS[t]} radius={i === tokens.length - 1 ? [2, 2, 0, 0] : 0} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Chains donut ────────────────────────────────────────────────────────────

const DONUT = ["#2F80ED", "#10D9A0", "#1D4ED8", "#F97316", "#8B5CF6", "#6B7280"];

export function ChainDonut({ data }: { data: Data }) {
  const [metric, setMetric] = useState<"volume" | "count">("volume");
  const L = ledgerOf(data);
  const all = (L?.chains ?? []).map((c) => ({ label: chainLabel(c.chain), value: metric === "volume" ? c.volume : c.count }));
  const top = all.slice(0, 5);
  const rest = all.slice(5).reduce((a, c) => a + c.value, 0);
  const items = [...top, ...(rest > 0 ? [{ label: "Others", value: rest }] : [])].map((it, i) => ({ ...it, color: it.label === "Others" ? DONUT[5] : DONUT[i] }));
  const total = items.reduce((a, b) => a + b.value, 0);
  const fmt = (n: number) => (metric === "volume" ? usdC(n) : fmtCount(n, { compact: true }));
  return (
    <Card
      id="chains"
      title="Transactions by Chain"
      source={data.ledger.source}
      action={<Menu label="Metric" width={104} value={metric} onChange={setMetric} options={[["volume", "Volume"], ["count", "Transactions"]] as const} />}
    >
      {!L ? (
        <Unavailable reason={ledgerReason(data)} />
      ) : total === 0 ? (
        <Empty text="No settled transactions to break down by chain yet." />
      ) : (
        <div className="flex flex-1 flex-col items-center gap-4 sm:flex-row sm:gap-5">
          <div className="relative h-[150px] w-[150px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={items} dataKey="value" nameKey="label" innerRadius={51} outerRadius={74} paddingAngle={1.5} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                  {items.map((it) => (
                    <Cell key={it.label} fill={it.color} />
                  ))}
                </Pie>
                <Tooltip content={({ active, payload }) => (active && payload?.[0] ? <TipBox title={String(payload[0].name)} rows={[{ label: metric === "volume" ? "Volume" : "Transactions", value: fmt(Number(payload[0].value)) }, { label: "Share", value: pct(Number(payload[0].value) / total) }]} /> : null)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-[24px] flex flex-col items-center justify-center rounded-full bg-[#070B0C] text-center shadow-[inset_0_0_18px_rgba(0,0,0,0.6)]">
              <span className="text-[18px] font-bold">{fmt(total)}</span>
              <span className="text-[11.5px] text-white/70">{metric === "volume" ? "Total Volume" : "Transactions"}</span>
            </div>
          </div>
          <ul className="w-full space-y-[9px] text-[12px]">
            {items.map((it) => (
              <li key={it.label} className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
                <span className="whitespace-nowrap text-white/90">{it.label}</span>
                <span className="ml-auto tabular-nums text-white/80">{pct(it.value / total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ── Stablecoin flows map ────────────────────────────────────────────────────

export function StablecoinFlows({ data }: { data: Data }) {
  const corr = data.corridors;
  const lines = corr.status === "ok" ? corr.data : [];
  const max = Math.max(1, ...lines.map((l) => l.volumeUsd));
  const nodes = new Set(lines.flatMap((l) => [l.from, l.to]));
  return (
    <Card title="Stablecoin Flows (Global)" source={corr.source} action={<Menu label="Metric" width={96} value="volume" onChange={() => {}} options={[["volume", "Volume"]] as const} />}>
      <div className="grid flex-1 items-center gap-3 sm:grid-cols-[1.9fr_1fr]">
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(0,229,153,0.10),transparent_65%)]" />
          <svg viewBox={`8 6 ${WORLD.width - 16} ${WORLD.height - 30}`} preserveAspectRatio="xMidYMid slice" className="relative h-[168px] w-full" role="img" aria-label="World map of stablecoin corridors">
            {WORLD.dots.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={1.15} fill="#1F6B52" fillOpacity={0.55} />
            ))}
            {lines.map((l) => {
              const a = WORLD.centroids[l.from];
              const b = WORLD.centroids[l.to];
              if (!a || !b) return null;
              const mx = (a[0] + b[0]) / 2, my = Math.min(a[1], b[1]) - Math.abs(a[0] - b[0]) * 0.28 - 6;
              const t = l.volumeUsd / max;
              return <path key={`${l.from}-${l.to}`} d={`M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}`} fill="none" stroke={NEON} strokeOpacity={0.4 + 0.5 * t} strokeWidth={0.6 + 1.2 * t} style={{ filter: "drop-shadow(0 0 2px #00E599)" }} />;
            })}
            {[...nodes].map((c) => {
              const p = WORLD.centroids[c];
              return p ? <circle key={c} cx={p[0]} cy={p[1]} r={2.2} fill={NEON} style={{ filter: "drop-shadow(0 0 3px #00E599)" }} /> : null;
            })}
          </svg>
        </div>
        <div className="min-w-0 self-start pt-1">
          <p className="mb-2.5 text-[11.5px] text-white/65">Top Corridors</p>
          {corr.status === "unavailable" ? (
            <p className="text-[11.5px] leading-relaxed text-white/45">{corr.reason}</p>
          ) : lines.length === 0 ? (
            <p className="text-[11.5px] text-white/45">The Allium corridor query returned no rows.</p>
          ) : (
            <ul className="space-y-[11px] text-[12px]">
              {lines.map((l) => (
                <li key={`${l.from}-${l.to}`} className="flex items-center gap-2">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white/[0.08] text-[7.5px] font-bold text-white/80">{l.from}</span>
                  <span className="truncate text-white/90">
                    {l.from} → {l.to}
                  </span>
                  <span className="ml-auto tabular-nums text-white">{usdC(l.volumeUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Categories ──────────────────────────────────────────────────────────────

function RailIcon({ rail }: { rail: string }) {
  const Icon = RAIL_ICON[rail] ?? CircleDollarSign;
  const color = RAIL_COLOR[rail] ?? "#6B7280";
  return (
    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md" style={{ background: `${color}26`, color }}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

export function Categories({ data }: { data: Data }) {
  const [metric, setMetric] = useState<"volume" | "count">("volume");
  const L = ledgerOf(data);
  const rails = L?.rails ?? [];
  const totalCount = rails.reduce((a, r) => a + r.count, 0);
  const rows = rails.map((r) => ({ ...r, s: metric === "volume" ? r.share : totalCount > 0 ? r.count / totalCount : 0 })).sort((a, b) => b.s - a.s);
  return (
    <Card id="categories" title="Top Payment Categories" source={data.ledger.source} action={<Menu label="Metric" width={96} value={metric} onChange={setMetric} options={[["volume", "Volume"], ["count", "Count"]] as const} />}>
      {!L ? (
        <Unavailable reason={ledgerReason(data)} />
      ) : rows.length === 0 ? (
        <Empty text="No settled payments in this period." />
      ) : (
        <ul className="space-y-[13px] pt-1">
          {rows.slice(0, 6).map((r) => (
            <li key={r.rail} className="grid grid-cols-[22px_minmax(0,1.25fr)_minmax(48px,1.05fr)_46px] items-center gap-3 text-[13px]" title={`${fmtCount(r.count)} transactions · ${fmtUsd(r.volume)}`}>
              <RailIcon rail={r.rail} />
              <span className="truncate text-white/90">{railLabel(r.rail)}</span>
              <span className="h-[9px] overflow-hidden rounded-full bg-white/[0.07]">
                <span className="block h-full rounded-full" style={{ width: `${r.s * 100}%`, background: RAIL_COLOR[r.rail] ?? "#6B7280" }} />
              </span>
              <span className="text-right tabular-nums text-white/90">{pct(r.s)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Counterparties ──────────────────────────────────────────────────────────

function ChainIcon({ chain }: { chain: string | null }) {
  if (chain && CHAIN_LOGOS.has(chain)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/logos/chains/${chain}.svg`} alt={chainLabel(chain)} width={20} height={20} className="h-5 w-5 rounded-full" />;
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] text-[8.5px] font-semibold uppercase text-white/75" title={chain ?? "unknown chain"}>
      {(chain ?? "?").slice(0, 2)}
    </span>
  );
}

export function Counterparties({ data, query }: { data: Data; query: string }) {
  const [all, setAll] = useState(false);
  const L = ledgerOf(data);
  const rows = (L?.counterparties ?? []).filter((c) => matches(query, c.address, c.chain));
  return (
    <Card
      id="counterparties"
      title="Counterparties & Entities"
      source={`${data.ledger.source}; entity labels need Allium`}
      action={rows.length > 6 && <GhostButton onClick={() => setAll((a) => !a)}>{all ? "Show less" : "View All"}</GhostButton>}
    >
      {!L ? (
        <Unavailable reason={ledgerReason(data)} />
      ) : rows.length === 0 ? (
        <Empty text={query ? `No recipient matches “${query}”.` : "No settled payments to a recipient address in this period."} />
      ) : (
        <ul className={`text-[12.5px] ${all ? "max-h-[230px] overflow-y-auto pr-1" : ""}`}>
          {(all ? rows : rows.slice(0, 6)).map((c) => (
            <li key={c.address} className="grid grid-cols-[20px_minmax(0,1.2fr)_minmax(0,0.9fr)_auto_auto] items-center gap-3 rounded-md px-1 py-[6px] transition-colors hover:bg-white/[0.035]">
              <ChainIcon chain={c.chain} />
              <span className="truncate font-mono text-[12px] text-white/90">{c.address}</span>
              <span className="truncate text-white/55">Unlabeled</span>
              <span className="text-right tabular-nums text-white">{usdC(c.volume)}</span>
              <span className="w-[64px] text-right tabular-nums text-white/55">{fmtCount(c.count)} txs</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Real-time activity ──────────────────────────────────────────────────────

export function Activity({ data, query }: { data: Data; query: string }) {
  const [state, setState] = useState<"all" | "settled" | "pending" | "failed">("all");
  const L = ledgerOf(data);
  const rows = (L?.activity ?? []).filter((a) => (state === "all" || a.state === state || (state === "failed" && a.state === "rejected")) && matches(query, a.hash, a.rail, railLabel(a.rail), a.chain, a.token));
  return (
    <Card
      title="Real-time Activity"
      source={data.ledger.source}
      action={<Menu label="Transactions" width={140} value={state} onChange={setState} options={[["all", "All Transactions"], ["settled", "Settled"], ["pending", "Pending"], ["failed", "Failed"]] as const} />}
    >
      {!L ? (
        <Unavailable reason={ledgerReason(data)} />
      ) : rows.length === 0 ? (
        <Empty text={query ? `No transaction matches “${query}”.` : "No ledger events in this period."} />
      ) : (
        <ul className="text-[12.5px]">
          {rows.slice(0, 6).map((a, i) => (
            <li key={`${a.at}-${i}`} className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1fr)_auto_52px] items-center gap-3 rounded-md px-1 py-[6px] transition-colors hover:bg-white/[0.035]">
              <RailIcon rail={a.rail} />
              <span className="truncate font-mono text-[12px] text-white/90">{a.hash ?? "no tx hash"}</span>
              <span className="truncate text-white/60">
                {SHORT_RAIL[a.rail] ?? railLabel(a.rail)}
                {a.state !== "settled" ? ` · ${a.state}` : ""}
              </span>
              <span className="text-right tabular-nums text-white">{a.amountUsd === null ? "—" : `${fmtUsd(a.amountUsd)}${a.token ? ` ${a.token.toUpperCase()}` : ""}`}</span>
              <span className="text-right text-white/50">{relTime(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Risk ────────────────────────────────────────────────────────────────────

export function Risk({ data }: { data: Data }) {
  const R = data.risk.status === "ok" ? data.risk.data : null;
  const lowShare = R && R.total > 0 ? R.bySeverity.low / R.total : null;
  const C = 2 * Math.PI * 42;
  return (
    <Card id="risk" title="Risk & Compliance" source={data.risk.source} action={<GhostButton href="/trust">View All</GhostButton>}>
      {!R ? (
        <Unavailable reason={data.risk.status === "unavailable" ? data.risk.reason : ""} />
      ) : (
        <>
          <div className="flex items-center gap-6 pl-2">
            <div className="relative h-[110px] w-[110px] shrink-0">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
                {lowShare !== null && <circle cx="50" cy="50" r="42" fill="none" stroke={NEON} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${lowShare * C} ${C}`} style={{ filter: "drop-shadow(0 0 4px #00E59988)" }} />}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[19px] font-bold">{lowShare === null ? "—" : pct(lowShare)}</p>
                <p className="text-[11px] text-white/65">{R.total === 0 ? "no events" : "Low Risk"}</p>
              </div>
            </div>
            <ul className="w-full space-y-[9px] text-[12px]">
              {(
                [
                  ["Low Risk", R.bySeverity.low, "#10D9A0"],
                  ["Medium Risk", R.bySeverity.medium, "#F5C542"],
                  ["High Risk", R.bySeverity.high, "#FF3B5C"],
                ] as const
              ).map(([l, v, c]) => (
                <li key={l} className="flex items-center gap-2.5" title={`${fmtCount(v)} events`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                  <span className="text-white/85">{l}</span>
                  <span className="ml-auto tabular-nums text-white/90">{R.total > 0 ? pct(v / R.total) : "0.0%"}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {(
              [
                ["Flagged Events", R.flagged],
                ["Sanctions Matches", R.sanctions],
                ["Critical Alerts", R.critical],
              ] as const
            ).map(([l, k]) => (
              <div key={l} className="rounded-lg border border-white/[0.08] bg-white/[0.015] px-2.5 py-2">
                <p className="text-[18px] font-bold leading-tight">{fmtCount(k.value)}</p>
                <p className="truncate text-[10.5px] text-white/65">{l}</p>
                <Change ratio={k.change} invert className="text-[12px]" />
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ── Transaction flow ────────────────────────────────────────────────────────

export function Flow({ data, chain, setChain }: { data: Data; chain: string; setChain: (c: string) => void }) {
  const [type, setType] = useState("all");
  const L = ledgerOf(data);
  const src = L?.flow.sources ?? [];
  const dst = L?.flow.destinations ?? [];
  const total = src.reduce((a, b) => a + b.value, 0);
  const H = 150;
  const layout = (xs: { value: number }[]) => {
    const t = xs.reduce((a, b) => a + b.value, 0) || 1;
    const gap = 5, h = H - gap * Math.max(0, xs.length - 1);
    let y = 0;
    return xs.map((x) => {
      const hh = Math.max(5, (x.value / t) * h);
      const r = { y, h: hh, mid: y + hh / 2 };
      y += hh + gap;
      return r;
    });
  };
  const ls = layout(src), ld = layout(dst);
  const dim = (rail: string) => (type === "all" || type === rail ? 0.62 : 0.12);
  return (
    <Card
      title="Transaction Flow"
      source={`${data.ledger.source}: rail → destination chain`}
      action={
        <>
          <Menu label="Chain" width={112} value={chain} onChange={setChain} options={CHAINS.map((c) => [c, chainLabel(c)] as const)} />
          <Menu label="Type" width={104} value={type} onChange={setType} options={[["all", "All Types"], ...src.map((s) => [s.label, SHORT_RAIL[s.label] ?? railLabel(s.label)] as const)] as const} />
        </>
      }
    >
      {!L ? (
        <Unavailable reason={ledgerReason(data)} />
      ) : total === 0 ? (
        <Empty text="No settled volume to trace in this period." />
      ) : (
        <>
          <div className="mb-1 flex justify-between text-[11px] text-white/60">
            <span>Sources</span>
            <span>Destinations</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(80px,1.05fr)_minmax(0,1fr)] gap-1.5 text-[12px]">
            <div className="relative" style={{ height: H }}>
              {src.map((s, i) => (
                <div key={s.label} className="absolute inset-x-0 flex items-center gap-1.5" style={{ top: ls[i].mid - 9, opacity: type === "all" || type === s.label ? 1 : 0.4 }}>
                  <RailIcon rail={s.label} />
                  <span className="truncate text-white/90">{SHORT_RAIL[s.label] ?? railLabel(s.label)}</span>
                  <span className="ml-auto tabular-nums text-white/85">{usdC(s.value)}</span>
                </div>
              ))}
            </div>
            <div className="relative" style={{ height: H }}>
              <svg viewBox={`0 0 200 ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
                {src.map((s, i) => (
                  <path key={`s${i}`} d={`M0,${ls[i].mid} C55,${ls[i].mid} 45,${H / 2} 82,${H / 2}`} fill="none" stroke={RAIL_COLOR[s.label] ?? PALETTE[i]} strokeOpacity={dim(s.label)} strokeWidth={Math.max(3, ls[i].h * 0.9)} />
                ))}
                {dst.map((d, i) => (
                  <path key={`d${i}`} d={`M118,${H / 2} C155,${H / 2} 145,${ld[i].mid} 200,${ld[i].mid}`} fill="none" stroke={["#8B5CF6", "#A855F7", "#6366F1", "#3B82F6", "#06B6D4"][i]} strokeOpacity={0.55} strokeWidth={Math.max(3, ld[i].h * 0.9)} />
                ))}
              </svg>
              <span className="absolute left-1/2 top-1/2 flex h-[58px] w-[58px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-[#00E599]/45 bg-[#06120D] shadow-[0_0_22px_rgba(0,229,153,0.25)]">
                <FurlPayMark size={30} />
              </span>
            </div>
            <div className="relative" style={{ height: H }}>
              {dst.map((d, i) => (
                <div key={d.label} className="absolute inset-x-0 flex items-center gap-2" style={{ top: ld[i].mid - 9 }}>
                  <span className="tabular-nums text-white/90">{usdC(d.value)}</span>
                  <span className="truncate text-white/70">{chainLabel(d.label).replace(" One", "")}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Market insights ─────────────────────────────────────────────────────────

type Tab = "supply" | "transfers" | "addresses";

export function MarketInsights({ data }: { data: Data }) {
  const [tab, setTab] = useState<Tab>("supply");
  const M = data.market.status === "ok" ? data.market.data : null;
  const daily = data.alliumDaily.status === "ok" ? data.alliumDaily.data : [];
  const last = daily.at(-1);
  const prev = daily.at(-2);
  const r = (a?: number, b?: number) => (a !== undefined && b !== undefined && b > 0 ? (a - b) / b : null);
  const avg = (d?: (typeof daily)[number]) => (d && d.transferCount > 0 ? d.transferVolumeUsd / d.transferCount : undefined);
  const alliumMissing = data.alliumDaily.status === "unavailable" ? data.alliumDaily.reason : null;
  const series =
    tab === "supply"
      ? (M?.supplySeries ?? null)
      : data.alliumDaily.status === "ok"
        ? daily.map((d) => ({ date: d.day, value: tab === "transfers" ? d.transferVolumeUsd : d.activeAddresses }))
        : null;
  const money = tab !== "addresses";

  const metric = (label: string, value: string | null, change: number | null) => (
    <div>
      <p className="text-[11.5px] text-white/75">{label}</p>
      <p className="flex items-baseline gap-3">
        <span className="text-[18px] font-bold">{value ?? "—"}</span>
        {value && <Change ratio={change} className="text-[12.5px]" />}
      </p>
    </div>
  );

  return (
    <Card id="market" title="Stablecoin Market Insights" source={`${data.market.source} (supply)${data.alliumDaily.status === "ok" ? `; ${data.alliumDaily.source}` : ""}`} action={<GhostButton href="/markets">View All</GhostButton>}>
      <div className="grid flex-1 gap-3 sm:grid-cols-[0.78fr_1.22fr]">
        <div className="space-y-[7px]">
          {metric("Total Stablecoin Supply", M ? usdC(M.totalSupplyUsd) : null, M?.supplyChange30d ?? null)}
          {metric("Daily Transfer Volume", last ? usdC(last.transferVolumeUsd) : null, r(last?.transferVolumeUsd, prev?.transferVolumeUsd))}
          {metric("Active Addresses", last ? fmtCount(last.activeAddresses, { compact: true }) : null, r(last?.activeAddresses, prev?.activeAddresses))}
          {metric("Avg Transfer Size", avg(last) !== undefined ? fmtUsd(avg(last)!) : null, r(avg(last), avg(prev)))}
          {alliumMissing && <p className="text-[10.5px] leading-snug text-white/40">Transfer metrics: {alliumMissing}</p>}
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="mb-1.5 flex justify-end gap-1.5 text-[11.5px]" role="tablist">
            {(["supply", "transfers", "addresses"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`h-[26px] rounded-md border px-3 capitalize transition-colors ${tab === t ? "border-[#00E599]/70 bg-[#00E599]/[0.10] text-[#00E599]" : "border-white/[0.12] text-white/75 hover:text-white"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {series && series.length > 1 ? (
            <div className="-ml-1 h-[150px] min-h-[150px] flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="onchain-area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor={NEON} stopOpacity={0.4} />
                      <stop offset="1" stopColor={NEON} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                    tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10.5 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis width={44} domain={["auto", "auto"]} tickFormatter={(n: number) => (money ? axisUsd(n) : fmtCount(n, { compact: true }))} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10.5 }} tickLine={false} axisLine={false} tickCount={5} />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.2)" }}
                    content={({ active, payload, label }) =>
                      active && payload?.[0] ? <TipBox title={String(label)} rows={[{ label: tab === "supply" ? "Supply" : tab === "transfers" ? "Transfer volume" : "Active addresses", value: money ? fmtUsd(Number(payload[0].value), { compact: true }) : fmtCount(Number(payload[0].value)) }]} /> : null
                    }
                  />
                  <Area type="monotone" dataKey="value" stroke={NEON} strokeWidth={1.8} fill="url(#onchain-area)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Unavailable reason={tab === "supply" ? (data.market.status === "unavailable" ? data.market.reason : "No supply history returned.") : (alliumMissing ?? "No rows returned yet.")} />
          )}
        </div>
      </div>
    </Card>
  );
}
