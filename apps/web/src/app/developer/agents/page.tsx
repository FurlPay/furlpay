"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Check, X, Pause, Play, Shield, Activity as ActivityIcon } from "lucide-react";
import { getJSON } from "@/lib/api";
import MarketingBar from "@/components/marketing/MarketingBar";
import { usd } from "@/components/ui";

interface Agent {
  id: string; name: string; model: string; status: "active" | "paused" | "revoked";
  dailyBudget: number; spentToday: number; merchants: string[]; lastTxAgo: string; keyPrefix: string;
}
interface Policy { id: string; name: string; maxPerTx: number; daily: number; allow: string[]; block: string[]; autoApproveUnder: number }
interface Act { id: string; time: string; agent: string; merchant: string; amount: number; state: "settled" | "pending" }
interface Data {
  agents: Agent[]; policies: Policy[]; activity: Act[];
  summary: { activeAgents: number; totalSpentToday: number; pendingApprovals: number };
}

export default function AgentConsole() {
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(() => getJSON<Data>("/api/agents").then(setData).catch(console.error), []);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, string>) {
    await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  }

  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Developer · Agent Console</p>
        <h1 className="text-[34px] font-extrabold tracking-tighter sm:text-[42px]">Corporate cards for AI agents.</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-textSecondary">
          Give each agent a scoped <code className="rounded bg-white/[0.06] px-1 text-neon">ak_</code> key with a budget,
          merchant allowlist, and human-approval threshold. Watch every payment in real time. Nobody else has this.
        </p>

        {!data ? (
          <p className="mt-10 text-textSecondary">Loading…</p>
        ) : (
          <>
            {/* Summary */}
            <div className="mt-8 grid grid-cols-3 gap-3">
              <Stat label="Active agents" value={String(data.summary.activeAgents)} />
              <Stat label="Spent today" value={usd(data.summary.totalSpentToday)} />
              <Stat label="Pending approvals" value={String(data.summary.pendingApprovals)} accent={data.summary.pendingApprovals > 0} />
            </div>

            {/* Agents */}
            <h2 className="mb-3 mt-10 text-[18px] font-bold tracking-tight">Active agents</h2>
            <div className="space-y-3">
              {data.agents.map((a) => (
                <div key={a.id} className="surface-card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-neon/25 bg-neonSoft text-neon">
                      <Bot className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{a.name}</p>
                        <StatusPill status={a.status} />
                      </div>
                      <p className="truncate text-[12px] text-textMuted">
                        {a.merchants.join(", ")} · key {a.keyPrefix} · last tx {a.lastTxAgo}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-semibold">{usd(a.spentToday)} <span className="text-textSecondary">/ {usd(a.dailyBudget)}</span></p>
                      <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-white/[0.08]">
                        <div className="h-full rounded-full bg-neon" style={{ width: `${Math.min(100, (a.spentToday / a.dailyBudget) * 100)}%` }} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {a.status === "active" && (
                        <IconBtn onClick={() => act({ id: a.id, action: "pause" })} label="Pause"><Pause className="h-4 w-4" /></IconBtn>
                      )}
                      {a.status === "paused" && (
                        <IconBtn onClick={() => act({ id: a.id, action: "resume" })} label="Resume"><Play className="h-4 w-4" /></IconBtn>
                      )}
                      {a.status !== "revoked" && (
                        <IconBtn onClick={() => act({ id: a.id, action: "revoke" })} label="Revoke" danger><X className="h-4 w-4" /></IconBtn>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Policies */}
            <h2 className="mb-3 mt-10 flex items-center gap-2 text-[18px] font-bold tracking-tight">
              <Shield className="h-5 w-5 text-neon" /> Spend policies
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.policies.map((p) => (
                <div key={p.id} className="surface-card p-4">
                  <p className="font-semibold">{p.name}</p>
                  <p className="mt-1 text-[12px] text-textSecondary">
                    Max/tx {usd(p.maxPerTx)} · Daily {usd(p.daily)} · Auto-approve under {usd(p.autoApproveUnder)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.allow.map((x) => <span key={x} className="rounded-full bg-neon/10 px-2 py-0.5 text-[11px] text-neon">✓ {x}</span>)}
                    {p.block.map((x) => <span key={x} className="rounded-full bg-loss/10 px-2 py-0.5 text-[11px] text-loss">✕ {x}</span>)}
                  </div>
                </div>
              ))}
            </div>

            {/* Activity */}
            <h2 className="mb-3 mt-10 flex items-center gap-2 text-[18px] font-bold tracking-tight">
              <ActivityIcon className="h-5 w-5 text-neon" /> Activity feed
            </h2>
            <div className="surface-card divide-y divide-white/[0.06]">
              {data.activity.map((t) => (
                <div key={t.id} className="flex items-center gap-3 p-3.5">
                  <span className="w-12 text-[12px] text-textMuted">{t.time}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    <span className="font-medium">{t.agent}</span> · {t.merchant}
                  </span>
                  <span className="text-[13px] font-semibold">{usd(t.amount)}</span>
                  {t.state === "settled" ? (
                    <span className="flex items-center gap-1 text-[12px] text-gain"><Check className="h-3.5 w-3.5" /> settled</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-textMuted">exceeds cap</span>
                      <button onClick={() => act({ action: "approve", txId: t.id })} className="tap rounded-full bg-neon px-3 py-1 text-[12px] font-bold text-black">Approve</button>
                      <button onClick={() => act({ action: "deny", txId: t.id })} className="tap rounded-full border border-white/15 px-3 py-1 text-[12px] font-semibold">Deny</button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-8 text-[12px] text-textMuted">
              Built on the{" "}
              <Link href="/docs/payments/agentic-x402" className="text-neon hover:underline">x402 facilitator</Link>{" "}
              and MCP server. Demo data. <Link href="/developer" className="text-neon hover:underline">← Developer portal</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="surface-card p-4">
      <p className="text-[12px] text-textSecondary">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${accent ? "text-accent" : ""}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: Agent["status"] }) {
  const map = {
    active: "bg-gain/15 text-gain",
    paused: "bg-white/[0.08] text-textSecondary",
    revoked: "bg-loss/15 text-loss",
  } as const;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${map[status]}`}>{status}</span>;
}

function IconBtn({ onClick, label, children, danger }: { onClick: () => void; label: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`tap flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] transition-colors ${danger ? "hover:border-loss/50 hover:text-loss" : "hover:border-neon/40 hover:text-neon"}`}
    >
      {children}
    </button>
  );
}
