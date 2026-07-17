import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import type { PendingChallenge, Transaction } from "@/lib/types";
import { CATEGORY_ICONS } from "./ActivityTab";
import { send, usd } from "./shared";

export default function NotificationCenter({ onClose, onGoApprove }: { onClose: () => void; onGoApprove: () => void }) {
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
