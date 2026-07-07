"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowDownUp, Zap, Route as RouteIcon } from "lucide-react";
import { sendJSON } from "@/lib/api";

const STABLES = ["USDC", "USDT", "EURC", "PYUSD", "DAI"] as const;
const CHAINS = ["arbitrum", "base", "polygon", "solana", "ethereum"] as const;
type Stable = (typeof STABLES)[number];
type Chain = (typeof CHAINS)[number];

interface SwapQuote {
  fromToken: Stable;
  toToken: Stable;
  fromChain: Chain;
  toChain: Chain;
  amountIn: number;
  amountOut: number;
  slippagePct: number;
  gasUsd: number;
  route: string[];
  etaSeconds: number;
}

export default function SwapTerminal() {
  const [fromToken, setFromToken] = useState<Stable>("USDT");
  const [toToken, setToToken] = useState<Stable>("USDC");
  const [fromChain, setFromChain] = useState<Chain>("arbitrum");
  const [toChain, setToChain] = useState<Chain>("arbitrum");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "swapping" | "done">("idle");

  const getQuote = useCallback(async () => {
    const amountIn = Number(amount);
    if (!Number.isFinite(amountIn) || amountIn <= 0) {
      setQuote(null);
      return;
    }
    setLoading(true);
    setStatus("idle");
    try {
      const res = await sendJSON<{ quote: SwapQuote }>("/api/swaps", {
        fromToken,
        toToken,
        fromChain,
        toChain,
        amountIn,
      });
      setQuote(res.quote);
    } catch {
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }, [fromToken, toToken, fromChain, toChain, amount]);

  useEffect(() => {
    const id = setTimeout(getQuote, 250);
    return () => clearTimeout(id);
  }, [getQuote]);

  const flip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromChain(toChain);
    setToChain(fromChain);
  };

  const execute = async () => {
    if (!quote) return;
    setStatus("swapping");
    try {
      await sendJSON("/api/swaps", {
        fromToken,
        toToken,
        fromChain,
        toChain,
        amountIn: Number(amount),
        execute: true,
      });
      setStatus("done");
    } catch {
      setStatus("idle");
    }
  };

  const disabled = !quote || loading || status === "swapping";

  return (
    <div className="mx-auto min-h-[100dvh] max-w-md px-4 pb-24 pt-4">
      <header className="mb-5 flex items-center gap-3">
        <Link href="/dashboard" aria-label="Back" className="text-white/60 hover:text-white">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Swap</h1>
          <p className="text-[11px] text-white/50">Best cross-chain route · Li.Fi + CCTP V2</p>
        </div>
      </header>

      {/* From */}
      <TokenBox
        label="You pay"
        token={fromToken}
        chain={fromChain}
        onToken={setFromToken}
        onChain={setFromChain}
        value={amount}
        onValue={setAmount}
        editable
      />

      <div className="relative z-10 -my-3 flex justify-center">
        <button
          onClick={flip}
          aria-label="Flip"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#12131a] text-white/70 hover:text-white"
        >
          <ArrowDownUp size={16} />
        </button>
      </div>

      {/* To */}
      <TokenBox
        label="You receive"
        token={toToken}
        chain={toChain}
        onToken={setToToken}
        onChain={setToChain}
        value={quote ? String(quote.amountOut) : loading ? "…" : "0"}
      />

      {/* Route detail */}
      {quote && (
        <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
          <Row label="Rate">
            1 {fromToken} ≈ {(quote.amountOut / quote.amountIn).toFixed(4)} {toToken}
          </Row>
          <Row label="Network fee">
            <span className="inline-flex items-center gap-1 text-green-400">
              <Zap size={11} /> ${quote.gasUsd.toFixed(3)}
            </span>
          </Row>
          <Row label="Slippage">{quote.slippagePct}%</Row>
          <Row label="ETA">~{quote.etaSeconds}s</Row>
          <div className="flex items-start gap-2 border-t border-white/10 pt-2 text-white/50">
            <RouteIcon size={13} className="mt-0.5 shrink-0" />
            <span>{quote.route.join(" → ")}</span>
          </div>
        </div>
      )}

      <button
        onClick={execute}
        disabled={disabled}
        className="mt-5 w-full rounded-xl bg-accent py-3.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {status === "swapping"
          ? "Swapping…"
          : status === "done"
            ? "Swapped ✓"
            : `Swap ${fromToken} → ${toToken}`}
      </button>
    </div>
  );
}

function TokenBox(props: {
  label: string;
  token: string;
  chain: string;
  onToken?: (t: Stable) => void;
  onChain?: (c: Chain) => void;
  value: string;
  onValue?: (v: string) => void;
  editable?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between text-[11px] text-white/40">
        <span>{props.label}</span>
        <select
          value={props.chain}
          onChange={(e) => props.onChain?.(e.target.value as Chain)}
          disabled={!props.onChain}
          className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] capitalize text-white/70 outline-none"
        >
          {CHAINS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={props.value}
          onChange={(e) => props.onValue?.(e.target.value.replace(/[^0-9.]/g, ""))}
          readOnly={!props.editable}
          inputMode="decimal"
          className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none"
        />
        <select
          value={props.token}
          onChange={(e) => props.onToken?.(e.target.value as Stable)}
          disabled={!props.onToken}
          className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-sm font-medium outline-none"
        >
          {STABLES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/40">{label}</span>
      <span>{children}</span>
    </div>
  );
}
