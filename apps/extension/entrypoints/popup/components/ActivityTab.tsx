import { useCallback, useEffect, useState } from "react";
import { IconName } from "@/components/icons";
import { clockLabel, dayLabel, txStatusMeta } from "@/lib/market";
import type { Transaction } from "@/lib/types";
import { EmptyState, ErrorPanel, MerchantAvatar, SkeletonPage, send, usd } from "./shared";

export const CATEGORY_ICONS: Record<string, IconName> = {
  card: "card",
  travel: "travel",
  x402: "code",
  transfer: "send",
  swap: "swap",
  invest: "invest",
  earn: "earn",
};

export default function ActivityTab() {
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
  if (!txs) return <SkeletonPage rows={6} label="Loading your activity…" />;

  // Group by calendar day — Today / Yesterday / Jul 4 headers.
  const groups: { label: string; items: Transaction[] }[] = [];
  for (const tx of txs) {
    const label = tx.timestamp ? dayLabel(tx.timestamp) : "Earlier";
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(tx);
    else groups.push({ label, items: [tx] });
  }

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
        groups.map((g, gi) => (
          <div key={g.label}>
            <div className="group-head">{g.label}</div>
            {g.items.map((tx, i) => (
              <TxRow key={tx.id} tx={tx} delay={Math.min((gi * 3 + i) * 0.03, 0.3)} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function TxRow({ tx, delay }: { tx: Transaction; delay: number }) {
  const st = txStatusMeta(tx.status);
  const negative = st.tone === "loss";
  return (
    <div className="tx-row fade-up" style={{ animationDelay: `${delay}s` }}>
      <MerchantAvatar name={tx.title} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.title}</div>
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)" }}>
          {tx.timestamp ? `${clockLabel(tx.timestamp)} · ` : ""}
          {tx.subtitle}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontFamily: "var(--fp-font-mono)",
            fontWeight: 600,
            fontSize: "0.84rem",
            color: negative ? "var(--fp-loss)" : tx.direction === "in" ? "var(--fp-gain)" : "var(--fp-text-primary)",
            textDecoration: negative ? "line-through" : undefined,
            opacity: st.tone === "warning" ? 0.75 : 1,
          }}
        >
          {tx.direction === "in" ? "+" : "-"}${usd(tx.amountUsd)}
        </div>
        <span className={`status-badge status-badge--${st.tone}`}>{st.label}</span>
      </div>
    </div>
  );
}
