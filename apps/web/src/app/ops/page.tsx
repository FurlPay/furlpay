"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Database,
  LockKeyhole,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";

// FurlPay Ops: real control plane over live money rails.
// Reads only ops endpoints; pause controls are durable server-side flags.

type RailStatus = "HEALTHY" | "DEGRADED" | "INCIDENT" | "PAUSED" | "NOT_CONFIGURED" | "UNKNOWN";

type PauseState = {
  paused: boolean;
  by?: string;
  at?: string;
  reason?: string;
};

type RailHealth = {
  status: Exclude<RailStatus, "PAUSED" | "NOT_CONFIGURED" | "UNKNOWN">;
  checkedAt: string;
  latencyMs?: number;
  detail?: string;
};

type RailRow = {
  rail: string;
  status: RailStatus;
  armed: boolean;
  control?: PauseState;
  health?: RailHealth | null;
  total: number;
  attempted: number;
  prepared: number;
  settled: number;
  pending: number;
  failed: number;
  rejected: number;
  volumeUsd: number;
  feeUsd: number;
  successRate: number | null;
};

type Overview = {
  globalPaused: boolean;
  globalPause?: PauseState;
  totals: {
    volumeUsd: number;
    feeUsd: number;
    transactions: number;
    attempted: number;
    prepared: number;
    settled: number;
    pending: number;
    failed: number;
    successRate: number | null;
  };
  rails: RailRow[];
  futureRails: { rail: string; status: string }[];
  config: {
    x402: Record<string, unknown> & { armed: boolean };
    lifi: Record<string, unknown> & { armed: boolean };
    cctp: Record<string, unknown> & { armed: boolean };
    limits: { maxSwapUsd: number; maxCctpUsd: number };
    providers?: Record<string, boolean>;
  };
};

type SecEvent = {
  id: string;
  kind: string;
  rail: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  detail: string;
  actor?: string;
  ts: string;
  acknowledged?: boolean;
};

type TxEvent = {
  id: string;
  rail: string;
  state: "prepared" | "settled" | "pending" | "failed" | "rejected";
  substate?: string;
  amountUsd?: number;
  feeUsd?: number;
  token?: string;
  sourceChain?: string;
  destChain?: string;
  txHash?: string;
  userId?: string;
  ts: string;
};

type AuditEntry = {
  id: number;
  ts: string;
  event: string;
  actor: string;
  fields: Record<string, unknown>;
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { message?: string };
};

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const count = (n: number) => n.toLocaleString();
const pct = (n: number | null) => (n === null ? "-" : `${(n * 100).toFixed(1)}%`);
const fmtTime = (ts?: string) => (ts ? new Date(ts).toLocaleString() : "-");
const ago = (ts?: string) => {
  if (!ts) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(ts)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

async function getJson<T>(url: string) {
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: res.status, body };
}

export default function OpsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [security, setSecurity] = useState<SecEvent[]>([]);
  const [txs, setTxs] = useState<TxEvent[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [txRail, setTxRail] = useState("all");
  const [txState, setTxState] = useState("all");
  const [spark, setSpark] = useState<{
    volume: { points: number[]; direction: string };
    success: { points: number[]; direction: string };
  } | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const o = await getJson<Overview>("/api/ops/overview");
      if (o.status === 401 || o.status === 403) {
        setError("Admin access required. Sign in with an admin account.");
        return;
      }
      if (!o.body?.ok || !o.body.data) {
        setError(o.body?.error?.message ?? "Failed to load ops overview.");
        return;
      }

      const [s, t, a, spVol, spOk] = await Promise.all([
        getJson<{ events: SecEvent[] }>("/api/ops/security?limit=40"),
        getJson<{ transactions: TxEvent[] }>("/api/ops/transactions?limit=80"),
        getJson<{ entries: AuditEntry[] }>("/api/ops/audit?limit=40"),
        getJson<{ points: number[]; trendDirection: string }>("/api/ops/metrics/sparkline?metric=volume"),
        getJson<{ points: number[]; trendDirection: string }>("/api/ops/metrics/sparkline?metric=success_rate"),
      ]);

      setError(null);
      setOverview(o.body.data);
      if (s.body?.ok && s.body.data) setSecurity(s.body.data.events);
      if (t.body?.ok && t.body.data) setTxs(t.body.data.transactions);
      if (a.body?.ok && a.body.data) setAudit(a.body.data.entries);
      if (spVol.body?.ok && spVol.body.data && spOk.body?.ok && spOk.body.data) {
        setSpark({
          volume: { points: spVol.body.data.points, direction: spVol.body.data.trendDirection },
          success: { points: spOk.body.data.points, direction: spOk.body.data.trendDirection },
        });
      }
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ops data.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const setPause = useCallback(
    async (scope: "global" | "rail", rail: string | null, paused: boolean) => {
      const label = rail ?? "all rails";
      if (scope === "global") {
        const phrase = paused ? "PAUSE ALL" : "RESUME ALL";
        const typed = window.prompt(`Type ${phrase} to ${paused ? "halt" : "resume"} ${label}:`);
        if (typed !== phrase) return;
      }

      const min = scope === "global" || !paused ? 8 : 4;
      const reason = window.prompt(
        `Reason for ${paused ? "pausing" : "resuming"} ${label} (min ${min} chars):`
      );
      if (!reason || reason.trim().length < min) return;

      const key = `${scope}:${rail}`;
      setBusy(key);
      try {
        const res = await fetch("/api/ops/controls", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope, rail: rail ?? undefined, paused, reason: reason.trim() }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as ApiEnvelope<unknown>;
          window.alert(body?.error?.message ?? "Control change failed.");
        }
      } finally {
        setBusy(null);
        await load();
      }
    },
    [load]
  );

  const filteredTxs = useMemo(
    () =>
      txs.filter((tx) => (txRail === "all" || tx.rail === txRail) && (txState === "all" || tx.state === txState)),
    [txRail, txState, txs]
  );

  if (error) {
    return (
      <main className="min-h-screen bg-[#08090a] px-5 py-8 text-white">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold tracking-tight">FurlPay Ops</h1>
          <div className="mt-5 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </div>
        </div>
      </main>
    );
  }

  if (!overview) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#08090a] text-white">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading real ops data...
        </div>
      </main>
    );
  }

  const o = overview;
  const liveRails = o.rails.filter((r) => r.armed).length;
  const pausedRails = o.rails.filter((r) => r.status === "PAUSED").length;
  const riskRails = o.rails.filter((r) => ["INCIDENT", "DEGRADED", "UNKNOWN"].includes(r.status)).length;
  const highSecurity = security.filter((e) => e.severity === "critical" || e.severity === "high").length;
  const states = Array.from(new Set(txs.map((t) => t.state)));
  const rails = Array.from(new Set([...o.rails.map((r) => r.rail), ...txs.map((t) => t.rail)]));

  return (
    <main className="min-h-screen bg-[#08090a] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">FurlPay Ops</h1>
              <StatusBadge status={o.globalPaused ? "PAUSED" : riskRails > 0 ? "DEGRADED" : "HEALTHY"} />
            </div>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Live money-rail control plane, settlement telemetry, security signals, and privileged action audit.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Freshness lastUpdated={lastUpdated} />
            <button
              type="button"
              onClick={load}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white/85 hover:bg-white/[0.08]"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              disabled={busy === "global:null"}
              onClick={() => setPause("global", null, !o.globalPaused)}
              className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50 ${
                o.globalPaused
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15"
                  : "border-red-400/40 bg-red-400/10 text-red-100 hover:bg-red-400/15"
              }`}
            >
              {o.globalPaused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
              {o.globalPaused ? "Resume all" : "Global pause"}
            </button>
          </div>
        </header>

        {o.globalPaused && (
          <section className="rounded-lg border border-amber-400/35 bg-amber-400/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-200" />
                <div>
                  <p className="font-semibold text-amber-100">Global pause active</p>
                  <p className="mt-1 text-sm text-amber-100/75">
                    All live money movement is halted server-side.
                  </p>
                </div>
              </div>
              <div className="text-sm text-amber-100/75">
                <span>{fmtTime(o.globalPause?.at)}</span>
                {o.globalPause?.reason ? <span className="ml-3">Reason: {o.globalPause.reason}</span> : null}
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={<Activity />} label="Settled volume" value={money(o.totals.volumeUsd)} meta="90d rolling" points={spark?.volume.points} direction={spark?.volume.direction} />
          <Metric icon={<Zap />} label="Success rate" value={pct(o.totals.successRate)} meta={`${count(o.totals.attempted)} attempted`} points={spark?.success.points} direction={spark?.success.direction} />
          <Metric icon={<ShieldAlert />} label="High risk events" value={count(highSecurity)} meta={`${count(security.length)} security events`} tone={highSecurity > 0 ? "danger" : "ok"} />
          <Metric icon={<SlidersHorizontal />} label="Rail posture" value={`${liveRails}/${o.rails.length} live`} meta={`${pausedRails} paused, ${riskRails} need review`} tone={riskRails > 0 || pausedRails > 0 ? "warn" : "ok"} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.9fr)]">
          <Panel title="Payment rails" icon={<Database className="h-4 w-4" />}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.08em] text-white/45">
                    {["Rail", "Status", "Mode", "Flow", "Success", "Volume", "Revenue", "Health", "Control"].map((h) => (
                      <th key={h} className="border-b border-white/10 px-3 py-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {o.rails.map((r) => {
                    const railControlPaused = !!r.control?.paused;
                    const controlDisabled = busy === `rail:${r.rail}` || (o.globalPaused && !railControlPaused);
                    return (
                    <tr key={r.rail} className="group">
                      <td className="border-b border-white/[0.06] px-3 py-4">
                        <div className="font-semibold">{r.rail}</div>
                        {r.control?.paused && r.control.reason ? (
                          <div className="mt-1 max-w-[180px] truncate text-xs text-white/45">{r.control.reason}</div>
                        ) : null}
                      </td>
                      <td className="border-b border-white/[0.06] px-3 py-4">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="border-b border-white/[0.06] px-3 py-4">
                        <ModeBadge armed={r.armed} />
                      </td>
                      <td className="border-b border-white/[0.06] px-3 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          <FlowPill label="ready" value={r.prepared} />
                          <FlowPill label="settled" value={r.settled} />
                          <FlowPill label="pending" value={r.pending} />
                          <FlowPill label="failed" value={r.failed + r.rejected} tone={r.failed + r.rejected > 0 ? "danger" : "muted"} />
                        </div>
                      </td>
                      <td className="border-b border-white/[0.06] px-3 py-4 font-medium">{pct(r.successRate)}</td>
                      <td className="border-b border-white/[0.06] px-3 py-4 font-medium">{money(r.volumeUsd)}</td>
                      <td className="border-b border-white/[0.06] px-3 py-4 font-medium">{money(r.feeUsd)}</td>
                      <td className="border-b border-white/[0.06] px-3 py-4">
                        <div className="max-w-[180px]">
                          <div className="text-xs text-white/75">{r.health?.latencyMs != null ? `${r.health.latencyMs}ms` : "no signal"}</div>
                          <div className="mt-0.5 truncate text-xs text-white/40">{r.health ? ago(r.health.checkedAt) : "awaiting check"}</div>
                        </div>
                      </td>
                      <td className="border-b border-white/[0.06] px-3 py-4">
                        <button
                          type="button"
                          disabled={controlDisabled}
                          onClick={() => setPause("rail", r.rail, !railControlPaused)}
                          className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
                            railControlPaused
                              ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-100"
                              : "border-red-400/35 bg-red-400/10 text-red-100"
                          }`}
                        >
                          {railControlPaused ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                          {o.globalPaused && !railControlPaused ? "Global" : railControlPaused ? "Resume" : "Pause"}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                  {o.futureRails.map((r) => (
                    <tr key={r.rail} className="opacity-55">
                      <td className="border-b border-white/[0.06] px-3 py-4 font-semibold">{r.rail}</td>
                      <td className="border-b border-white/[0.06] px-3 py-4"><StatusBadge status={r.status} /></td>
                      <td className="border-b border-white/[0.06] px-3 py-4" colSpan={7}>not configured</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Configuration readiness" icon={<LockKeyhole className="h-4 w-4" />}>
            <div className="space-y-4">
              <ConfigGroup title="x402 mainnet settlement" rows={o.config.x402} />
              <ConfigGroup title="LI.FI swaps" rows={o.config.lifi} />
              <ConfigGroup title="CCTP V2" rows={o.config.cctp} />
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/45">Money caps</div>
                <ConfigLine label="Max swap" value={money(o.config.limits.maxSwapUsd)} />
                <ConfigLine label="Max CCTP" value={money(o.config.limits.maxCctpUsd)} />
              </div>
              {o.config.providers ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/45">Providers</div>
                  {Object.entries(o.config.providers).map(([k, v]) => (
                    <ConfigLine key={k} label={k} value={v ? "CONFIGURED" : "MISSING"} ok={v} />
                  ))}
                </div>
              ) : null}
            </div>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <Panel title="Security events" icon={<ShieldAlert className="h-4 w-4" />}>
            {security.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} text="No security events recorded." />
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {security.map((event) => (
                  <div key={event.id} className="grid gap-2 py-3 sm:grid-cols-[92px_72px_1fr_auto] sm:items-start">
                    <SeverityBadge severity={event.severity} />
                    <span className="font-mono text-xs text-white/55">{event.rail}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{event.kind}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-white/45">{event.detail}</div>
                    </div>
                    <span className="text-xs text-white/45">{ago(event.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Privileged audit" icon={<Clock3 className="h-4 w-4" />}>
            {audit.length === 0 ? (
              <EmptyState icon={<CircleDashed className="h-5 w-5" />} text="No privileged actions in this instance." />
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {audit.map((entry) => (
                  <div key={entry.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{entry.event}</span>
                        <span className="rounded-md bg-white/[0.05] px-2 py-0.5 font-mono text-[11px] text-white/50">
                          {shorten(entry.actor, 18)}
                        </span>
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-white/40">{compactFields(entry.fields)}</div>
                    </div>
                    <span className="text-xs text-white/45">{ago(entry.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <Panel title="Recent transactions" icon={<Activity className="h-4 w-4" />}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select label="Rail" value={txRail} onChange={setTxRail} options={["all", ...rails]} />
            <Select label="State" value={txState} onChange={setTxState} options={["all", ...states]} />
            <span className="ml-auto text-xs text-white/45">{count(filteredTxs.length)} shown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.08em] text-white/45">
                  {["Time", "Rail", "State", "Route", "Amount", "Fee", "Tx hash"].map((h) => (
                    <th key={h} className="border-b border-white/10 px-3 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTxs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8">
                      <EmptyState icon={<CircleDashed className="h-5 w-5" />} text="No transactions match the current filters." />
                    </td>
                  </tr>
                ) : (
                  filteredTxs.map((tx) => (
                    <tr key={tx.id}>
                      <td className="border-b border-white/[0.06] px-3 py-3 text-white/55">{fmtTime(tx.ts)}</td>
                      <td className="border-b border-white/[0.06] px-3 py-3 font-mono text-xs">{tx.rail}</td>
                      <td className="border-b border-white/[0.06] px-3 py-3"><StateBadge state={tx.state} /></td>
                      <td className="border-b border-white/[0.06] px-3 py-3 text-white/55">
                        {tx.sourceChain || tx.destChain ? `${tx.sourceChain ?? "-"} -> ${tx.destChain ?? "-"}` : tx.substate ?? "-"}
                      </td>
                      <td className="border-b border-white/[0.06] px-3 py-3 font-medium">
                        {tx.amountUsd != null ? money(tx.amountUsd) : "-"}
                      </td>
                      <td className="border-b border-white/[0.06] px-3 py-3 text-white/55">
                        {tx.feeUsd != null ? money(tx.feeUsd) : "-"}
                      </td>
                      <td className="border-b border-white/[0.06] px-3 py-3 font-mono text-xs text-white/55">
                        {tx.txHash ? shorten(tx.txHash, 22) : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </main>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] shadow-[0_20px_60px_-40px_rgba(0,0,0,0.9)]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="text-white/55">{icon}</span>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// Compact 7-day sparkline for metric cards — pure SVG, no chart library.
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const y = (p: number) => (max === min ? 12 : 22 - ((p - min) / (max - min)) * 20);
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 100},${y(p).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full text-white/30" aria-hidden>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function TrendArrow({ direction }: { direction: string }) {
  if (direction === "up") return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-300" aria-label="trending up" />;
  if (direction === "down") return <ArrowDownRight className="h-3.5 w-3.5 text-red-300" aria-label="trending down" />;
  return <ArrowRight className="h-3.5 w-3.5 text-white/35" aria-label="flat" />;
}

// Data-freshness indicator: Live (<20s, pulsing) / Stale (<60s) / Disconnected.
// Ticks every 5s so the state degrades visibly if polling stops.
function Freshness({ lastUpdated }: { lastUpdated: Date | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const age = lastUpdated ? (Date.now() - lastUpdated.getTime()) / 1000 : Infinity;
  if (age > 60) {
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-400/35 bg-red-400/10 px-3 text-xs font-semibold text-red-200">
        <WifiOff className="h-3.5 w-3.5" aria-hidden />
        Disconnected
      </span>
    );
  }
  if (age > 20) {
    return (
      <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 text-xs font-semibold text-amber-200">
        <span className="h-2 w-2 rounded-full bg-amber-300" aria-hidden />
        Stale · {Math.floor(age)}s
      </span>
    );
  }
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
      </span>
      Live
    </span>
  );
}

function Metric({
  icon,
  label,
  value,
  meta,
  tone = "neutral",
  points,
  direction,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  meta: string;
  tone?: "neutral" | "ok" | "warn" | "danger";
  points?: number[];
  direction?: string;
}) {
  const toneClass = {
    neutral: "text-white/55 bg-white/[0.05]",
    ok: "text-emerald-200 bg-emerald-400/10",
    warn: "text-amber-200 bg-amber-400/10",
    danger: "text-red-200 bg-red-400/10",
  }[tone];

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-white/45">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}>
          <span className="h-4 w-4">{icon}</span>
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {/* keyed on value: re-mounts on change so the pulse animation replays */}
        <span key={value} className="animate-[metricpulse_0.7s_ease-out] text-2xl font-bold tracking-tight">
          {value}
        </span>
        {direction && <TrendArrow direction={direction} />}
      </div>
      <div className="mt-1 text-xs text-white/45">{meta}</div>
      {points && points.length > 1 && (
        <div className="mt-3">
          <Sparkline points={points} />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style =
    {
      HEALTHY: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
      PAUSED: "border-amber-400/30 bg-amber-400/10 text-amber-100",
      DEGRADED: "border-yellow-400/30 bg-yellow-400/10 text-yellow-100",
      INCIDENT: "border-red-400/30 bg-red-400/10 text-red-100",
      UNKNOWN: "border-slate-400/30 bg-slate-400/10 text-slate-100",
      NOT_CONFIGURED: "border-white/15 bg-white/[0.04] text-white/55",
    }[status] ?? "border-white/15 bg-white/[0.04] text-white/55";

  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${style}`}>{status}</span>;
}

function StateBadge({ state }: { state: TxEvent["state"] }) {
  const icon =
    state === "settled" ? <CheckCircle2 className="h-3.5 w-3.5" /> :
    state === "failed" || state === "rejected" ? <XCircle className="h-3.5 w-3.5" /> :
    state === "pending" ? <Clock3 className="h-3.5 w-3.5" /> :
    <CircleDashed className="h-3.5 w-3.5" />;
  const color =
    state === "settled" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" :
    state === "failed" || state === "rejected" ? "border-red-400/30 bg-red-400/10 text-red-100" :
    state === "pending" ? "border-amber-400/30 bg-amber-400/10 text-amber-100" :
    "border-white/15 bg-white/[0.04] text-white/60";

  return <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${color}`}>{icon}{state}</span>;
}

function SeverityBadge({ severity }: { severity: SecEvent["severity"] }) {
  const color =
    severity === "critical" || severity === "high" ? "text-red-100 bg-red-400/10 border-red-400/30" :
    severity === "medium" ? "text-amber-100 bg-amber-400/10 border-amber-400/30" :
    severity === "low" ? "text-sky-100 bg-sky-400/10 border-sky-400/30" :
    "text-white/55 bg-white/[0.04] border-white/10";

  return <span className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold ${color}`}>{severity.toUpperCase()}</span>;
}

function ModeBadge({ armed }: { armed: boolean }) {
  return armed ? (
    <span className="inline-flex rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-100">
      LIVE
    </span>
  ) : (
    <span className="inline-flex rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-white/55">
      MOCK
    </span>
  );
}

function ReadinessBadge({ armed }: { armed: boolean }) {
  return armed ? (
    <span className="inline-flex rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-100">
      ARMED
    </span>
  ) : (
    <span className="inline-flex rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-white/55">
      NOT ARMED
    </span>
  );
}

function FlowPill({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "danger" }) {
  return (
    <span className={`rounded-md px-2 py-1 text-xs ${tone === "danger" ? "bg-red-400/10 text-red-100" : "bg-white/[0.045] text-white/60"}`}>
      {label} {count(value)}
    </span>
  );
}

function ConfigGroup({ title, rows }: { title: string; rows: Record<string, unknown> & { armed?: boolean } }) {
  const entries = Object.entries(rows).filter(([k]) => k !== "armed");
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">{title}</div>
        <ReadinessBadge armed={!!rows.armed} />
      </div>
      <div className="space-y-2">
        {entries.map(([k, v]) => (
          <ConfigLine key={k} label={k} value={displayConfigValue(v)} ok={typeof v === "boolean" ? v : v != null && v !== ""} />
        ))}
      </div>
    </div>
  );
}

function ConfigLine({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="min-w-0 truncate text-white/45">{label}</span>
      <span className={`shrink-0 font-mono ${ok === false ? "text-red-200" : ok === true ? "text-emerald-200" : "text-white/65"}`}>
        {value}
      </span>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-white/50">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-sm font-semibold text-white outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#101214] text-white">
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 px-4 py-6 text-sm text-white/45">
      {icon}
      {text}
    </div>
  );
}

function displayConfigValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "CONFIGURED" : "MISSING";
  if (value == null || value === "") return "-";
  return String(value);
}

function shorten(value: string, max: number) {
  if (value.length <= max) return value;
  const head = Math.max(6, Math.floor(max * 0.55));
  const tail = Math.max(4, max - head - 3);
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function compactFields(fields: Record<string, unknown>) {
  const raw = JSON.stringify(fields);
  return raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
}
