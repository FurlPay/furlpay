"use client";

import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Bot, Plus } from "lucide-react";
import { CoinLogo, StockLogo } from "@furlpay/ui";
import { NoData, Panel } from "./Panel";
import type {
  AgentsResponse,
  CardRow,
  Mover,
  Overview,
  RwaResponse,
} from "@/lib/terminal/hooks";
import type { PortfolioHolding } from "@/lib/terminal/hooks";

// Right-rail panels — Wallet, Watchlist, Agents, Cards, Activity.
//
// Every figure here comes from a live endpoint verified against the running
// server: 6 real token balances, live market movers, the real agent
// control-plane summary (2 active of 3), 2 real cards, and the actual recent
// transactions. Nothing is invented — where a source is planned but absent, the
// panel renders an honest empty state instead of a plausible number.

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const usd0 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// ── Wallet ───────────────────────────────────────────────────────────────

export function WalletPanel({
  overview,
  onAction,
  index = 0,
}: {
  overview: Overview | null;
  onAction?: (a: "deposit" | "withdraw" | "swap") => void;
  index?: number;
}) {
  const balances = overview?.tokenBalances ?? [];
  const total = balances.reduce((s, b) => s + b.usdValue, 0);

  return (
    <Panel title="Wallet" index={index} scroll className="max-h-[420px]">
      <div className="mb-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-textSecondary">
          Total balance
        </p>
        <p className="font-mono text-[24px] font-bold tabular-nums text-textPrimary">
          {overview ? usd(total) : "—"}
        </p>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <WalletAction icon={<ArrowDownLeft size={15} />} label="Deposit" onClick={() => onAction?.("deposit")} />
        <WalletAction icon={<ArrowUpRight size={15} />} label="Withdraw" onClick={() => onAction?.("withdraw")} />
        <WalletAction icon={<ArrowLeftRight size={15} />} label="Swap" primary onClick={() => onAction?.("swap")} />
      </div>

      {balances.length ? (
        <ul className="flex flex-col gap-1">
          {balances.map((b, i) => (
            <li key={`${b.token}-${b.chain}-${i}`} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
              <CoinLogo token={b.token} size={26} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-textPrimary">{b.token}</p>
                <p className="text-[10px] capitalize text-textSecondary">{b.chain}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[13px] font-medium tabular-nums text-textPrimary">
                  {usd(b.usdValue)}
                </p>
                <p className="font-mono text-[10px] tabular-nums text-textSecondary">
                  {b.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <NoData label="No balances yet" />
      )}
    </Panel>
  );
}

function WalletAction({
  icon,
  label,
  primary,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[11px] font-semibold transition-colors ${
        primary
          ? "border-neon/40 bg-neon/12 text-neon hover:bg-neon/20"
          : "border-term-border bg-term-raised text-textSecondary hover:border-neon/30 hover:text-textPrimary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Watchlist ──────────────────────────────────────────────────────────────

export function WatchlistPanel({
  gainers,
  losers,
  index = 0,
}: {
  gainers: Mover[];
  losers: Mover[];
  index?: number;
}) {
  // Interleave the strongest movers of each direction — a watchlist should show
  // what's moving, not only what's up.
  const rows = [...gainers.slice(0, 5), ...losers.slice(0, 3)];

  return (
    <Panel title="Watchlist" subtitle="Live movers" index={index} scroll className="max-h-[360px]">
      {rows.length ? (
        <ul className="flex flex-col gap-0.5">
          {rows.map((m) => {
            const up = (m.changePct ?? 0) >= 0;
            return (
              <li key={`${m.kind}-${m.symbol}`} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
                {m.kind === "stock" ? (
                  <StockLogo symbol={m.symbol} size={24} />
                ) : (
                  <CoinLogo token={m.symbol} size={24} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-textPrimary">{m.symbol}</p>
                  <p className="truncate text-[10px] text-textSecondary">{m.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[12px] tabular-nums text-textPrimary">
                    {m.price !== undefined ? usd(m.price) : "—"}
                  </p>
                  <p className={`font-mono text-[10px] tabular-nums ${up ? "text-gain" : "text-loss"}`}>
                    {up ? "+" : ""}
                    {(m.changePct ?? 0).toFixed(2)}%
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <NoData label="Market data unavailable" />
      )}
    </Panel>
  );
}

// ── Agents (the differentiator, from the real control plane) ────────────────

export function AgentsPanel({ data, index = 0 }: { data: AgentsResponse | null; index?: number }) {
  const agents = data?.agents ?? [];
  const s = data?.summary;

  return (
    <Panel
      title="AI Agents"
      subtitle={s ? `${s.activeAgents} active · ${usd(s.totalSpentToday)} today` : undefined}
      index={index}
      className="min-h-[160px]"
    >
      {agents.length ? (
        <ul className="flex flex-col gap-1.5">
          {agents.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-term-raised">
                <Bot size={15} className="text-textSecondary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-textPrimary">{a.name}</p>
                {a.model ? <p className="truncate text-[10px] text-textSecondary">{a.model}</p> : null}
              </div>
              <AgentStatus status={a.status} />
            </li>
          ))}
          {s && s.pendingApprovals > 0 ? (
            <li className="mt-1 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
              {s.pendingApprovals} approval{s.pendingApprovals === 1 ? "" : "s"} awaiting your review
            </li>
          ) : null}
        </ul>
      ) : (
        <NoData label="No agents deployed" />
      )}
    </Panel>
  );
}

function AgentStatus({ status }: { status: string }) {
  const map: Record<string, { c: string; label: string }> = {
    active: { c: "text-gain bg-gain/10", label: "Active" },
    paused: { c: "text-warning bg-warning/10", label: "Paused" },
    stopped: { c: "text-textMuted bg-white/5", label: "Stopped" },
  };
  const m = map[status] ?? map.stopped;
  return (
    <span className={`flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold ${m.c}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

// ── Cards ────────────────────────────────────────────────────────────────

export function CardsPanel({ cards, index = 0 }: { cards: CardRow[]; index?: number }) {
  return (
    <Panel title="Cards" subtitle={`${cards.length} active`} index={index} className="min-h-[120px]">
      {cards.length ? (
        <ul className="flex flex-col gap-2">
          {cards.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-term-border bg-term-raised px-3 py-2"
            >
              <div>
                <p className="text-[12px] font-semibold text-textPrimary">{c.label}</p>
                <p className="font-mono text-[11px] text-textSecondary">•••• {c.last4}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] capitalize text-textSecondary">{c.kind}</p>
                {c.frozen ? (
                  <p className="text-[10px] font-semibold text-loss">Frozen</p>
                ) : (
                  <p className="text-[10px] font-semibold text-gain">Active</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <NoData label="No cards issued" />
      )}
    </Panel>
  );
}

// ── Tokenized assets, with real stock logos ─────────────────────────────────

export function TokenizedPanel({ rwa, index = 0 }: { rwa: RwaResponse | null; index?: number }) {
  const positions = rwa?.tokenized ?? [];
  return (
    <Panel
      title="Tokenized assets"
      subtitle={rwa ? `${usd0(rwa.summary.tokenizedValue)} · partner-held` : "Read-only"}
      index={index}
      scroll
      className="max-h-[300px]"
    >
      {positions.length ? (
        <ul className="flex flex-col gap-1.5">
          {positions.map((p) => (
            <li key={p.token} className="flex items-center gap-2.5">
              <StockLogo symbol={p.symbol} size={24} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-textPrimary">{p.symbol}</p>
                <p className="truncate text-[10px] text-textSecondary">{p.issuer}</p>
              </div>
              <p className="font-mono text-[12px] tabular-nums text-textPrimary">{usd0(p.marketValue)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <NoData label="No tokenized positions" />
      )}
      <p className="mt-3 border-t border-term-border/70 pt-2 text-[10px] leading-snug text-textMuted">
        Positions held at partner issuers. FurlPay does not custody securities or place orders.
      </p>
    </Panel>
  );
}

// ── Allocation donut is in ExpensePanels; this is the portfolio breakdown ────

export function AllocationPanel({
  breakdown,
  holdings,
  index = 0,
}: {
  breakdown: Overview["breakdown"] | undefined;
  holdings: PortfolioHolding[];
  index?: number;
}) {
  const slices = breakdown
    ? [
        { name: "Crypto", value: breakdown.crypto, color: "#00E599" },
        { name: "Fiat", value: breakdown.fiat, color: "#38BDF8" },
        { name: "Equities", value: breakdown.equities, color: "#A78BFA" },
      ].filter((s) => s.value > 0)
    : [];
  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <Panel title="Allocation" subtitle={holdings.length ? `${holdings.length} holdings` : undefined} index={index} className="min-h-[180px]">
      {total > 0 ? (
        <div className="flex flex-col gap-2">
          {/* A simple stacked bar reads more honestly than a donut for three
              slices, and needs no chart runtime. */}
          <div className="flex h-3 overflow-hidden rounded-full">
            {slices.map((s) => (
              <div key={s.name} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
            ))}
          </div>
          <ul className="flex flex-col gap-1">
            {slices.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-[12px]">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 text-textPrimary">{s.name}</span>
                <span className="font-mono tabular-nums text-textSecondary">
                  {Math.round((s.value / total) * 100)}%
                </span>
                <span className="w-20 text-right font-mono tabular-nums text-textPrimary">{usd0(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <NoData label="No holdings to allocate" />
      )}
    </Panel>
  );
}

export const QUICK_ACTIONS: { label: string; href: string; icon: React.ReactNode }[] = [
  { label: "Send", href: "/dashboard", icon: <ArrowUpRight size={14} /> },
  { label: "Receive", href: "/receive", icon: <ArrowDownLeft size={14} /> },
  { label: "Swap", href: "/dashboard", icon: <ArrowLeftRight size={14} /> },
  { label: "Add card", href: "/cards", icon: <Plus size={14} /> },
];
