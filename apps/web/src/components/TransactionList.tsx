"use client";

import { Transaction } from "@/lib/types";
import { ArrowDown, ArrowUp } from "./icons";
import { Pill, timeAgo, usd } from "./ui";

const statusTone: Record<Transaction["status"], "muted" | "accent" | "gain" | "loss"> = {
  settled: "muted",
  pending: "accent",
  escrow: "accent",
  declined: "loss",
};

export default function TransactionList({ items }: { items: Transaction[] }) {
  if (!items.length) {
    return <p className="px-5 py-8 text-center text-sm text-textSecondary">No transactions yet.</p>;
  }
  return (
    <ul className="space-y-1 px-2">
      {items.map((t) => {
        const inbound = t.direction === "in";
        return (
          <li key={t.id} className="flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-white/[0.03]">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${inbound ? "bg-gain/15 text-gain" : "bg-white/[0.06] text-textPrimary"}`}>
              {inbound ? <ArrowDown className="h-5 w-5" /> : <ArrowUp className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold">{t.title}</p>
                {t.status !== "settled" && <Pill tone={statusTone[t.status]}>{t.status}</Pill>}
              </div>
              <p className="truncate text-[13px] text-textSecondary">{t.subtitle} · {timeAgo(t.timestamp)}</p>
            </div>
            <div className={`shrink-0 font-semibold ${inbound ? "text-gain" : "text-textPrimary"}`}>
              {inbound ? "+" : "−"}{usd(t.amountUsd).replace("$", "$")}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
