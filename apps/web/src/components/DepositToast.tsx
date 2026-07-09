"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { getJSON } from "@/lib/api";
import type { DepositEvent } from "@/lib/services/deposits";
import { EXPLORER_TX } from "@/lib/services/deposits";

// Real-time deposit toast: polls /api/deposits and surfaces incoming on-chain
// transfers through the pending → processing → success state machine, in the
// style of an exchange deposit tracker ("+4.99 USDT · BSC · Deposit detected").
const POLL_MS = 5000;

const CHAIN_LABEL: Record<string, string> = {
  ethereum: "Ethereum",
  polygon: "Polygon",
  base: "Base",
  arbitrum: "Arbitrum",
  solana: "Solana",
  gnosis: "Gnosis",
  robinhood: "Robinhood Chain",
  bsc: "BSC",
};

export default function DepositToast() {
  const [tx, setTx] = useState<DepositEvent | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const seenSettled = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    // Anything already settled before the page opened isn't news — prime the
    // seen-set on first poll so we only toast live transitions.
    let primed = false;

    async function poll() {
      try {
        const res = await getJSON<{ deposits: DepositEvent[] }>("/api/deposits");
        if (!alive) return;
        const deposits = res.deposits ?? [];
        if (!primed) {
          primed = true;
          deposits.filter((d) => d.status === "success").forEach((d) => seenSettled.current.add(d.txHash));
        }
        const active =
          deposits.find((d) => d.status !== "success") ??
          deposits.find((d) => d.status === "success" && !seenSettled.current.has(d.txHash));
        if (active) setTx(active);
      } catch {
        /* signed out or offline — stay quiet */
      }
    }

    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!tx || dismissed === tx.txHash + tx.status) return null;

  const cfg = {
    pending: {
      title: "Deposit detected",
      subtitle: "Waiting for network confirmation…",
      icon: (
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
        </span>
      ),
    },
    processing: {
      title: "Processing deposit",
      subtitle: `Confirming (${tx.confirmations}/${tx.requiredConfirmations})…`,
      icon: <Loader2 size={15} className="animate-spin text-sky-400" />,
    },
    success: {
      title: "Deposit credited",
      subtitle: `+${tx.amount} ${tx.token} added to your balance.`,
      icon: (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gain/15">
          <Check size={13} className="text-gain" />
        </span>
      ),
    },
  }[tx.status];

  const dismiss = () => {
    if (tx.status === "success") seenSettled.current.add(tx.txHash);
    setDismissed(tx.txHash + tx.status);
  };

  return (
    <div
      className="deposit-toast fixed bottom-6 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#0a0a0b]/90 p-4 shadow-2xl backdrop-blur-xl"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{cfg.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-[13px] font-semibold text-white">{cfg.title}</h4>
            <span className={`text-[13px] font-bold ${tx.status === "success" ? "text-gain" : "text-white"}`}>
              +{tx.amount} {tx.token}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-white/50">{cfg.subtitle}</p>

          <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-2 text-[10px] text-white/40">
            <div className="flex justify-between gap-2">
              <span>Network</span>
              <span className="text-white/70">{CHAIN_LABEL[tx.chain] ?? tx.chain}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Order ID</span>
              <span className="font-mono text-white/70">{tx.orderId}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Transaction</span>
              <a
                href={`${EXPLORER_TX[tx.chain]}${tx.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="truncate font-mono text-gain hover:underline"
              >
                {tx.txHash.slice(0, 10)}…{tx.txHash.slice(-8)}
              </a>
            </div>
          </div>

          {tx.status !== "success" && (
            <p className="mt-2 text-[10px] leading-relaxed text-white/30">
              Deposit in progress. Processing times depend on the network.
            </p>
          )}
        </div>
        <button onClick={dismiss} aria-label="Dismiss" className="text-white/40 hover:text-white">
          <X size={14} />
        </button>
      </div>

      <style>{`
        .deposit-toast { animation: deposit-toast-in 0.3s ease both; }
        @keyframes deposit-toast-in {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .deposit-toast { animation: none; }
        }
      `}</style>
    </div>
  );
}
