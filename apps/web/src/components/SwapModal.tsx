"use client";

import { useState } from "react";
import { sendJSON } from "@/lib/api";
import { Chain, Stablecoin } from "@/lib/types";
import Modal from "./Modal";

const TOKENS: Stablecoin[] = ["USDC", "USDT", "EURC", "PYUSD"];
const CHAINS: Chain[] = ["base", "solana", "arbitrum", "polygon", "ethereum"];

interface Quote {
  amountOut: number;
  slippagePct: number;
  gasUsd: number;
  route: string[];
  toChain: Chain;
  etaSeconds: number;
}

export default function SwapModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [fromToken, setFromToken] = useState<Stablecoin>("USDT");
  const [toToken, setToToken] = useState<Stablecoin>("USDC");
  const [fromChain, setFromChain] = useState<Chain>("arbitrum");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amt = Number(amount);
  const sameToken = fromToken === toToken;
  const valid = amt > 0 && !sameToken;

  // A quote is only good for the inputs it priced — invalidate it on any change.
  function update<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setQuote(null);
      setError(null);
    };
  }

  async function getQuote() {
    setBusy(true);
    setError(null);
    try {
      const r = await sendJSON<{ quote: Quote }>("/api/swaps", {
        fromToken, toToken, fromChain, amountIn: amt,
      });
      setQuote(r.quote);
    } catch {
      setError("Couldn't fetch a route. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    setBusy(true);
    setError(null);
    try {
      await sendJSON("/api/swaps", {
        fromToken, toToken, fromChain, amountIn: amt, execute: true,
      });
      setQuote(null);
      onDone();
      onClose();
    } catch {
      setError("Swap failed — nothing was moved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Swap Stablecoins">
      <p className="mb-4 text-[13px] text-textSecondary">
        Li.Fi auto-routes to the cheapest L2 with &lt;0.05% slippage.
      </p>

      <label className="mb-1 block text-[12px] text-textSecondary">You pay</label>
      <div className="mb-3 flex gap-2">
        <input
          type="number"
          min={0}
          inputMode="decimal"
          value={amount}
          onChange={(e) => update(setAmount)(e.target.value)}
          className="flex-1 rounded-2xl bg-surface px-4 py-3 text-lg font-semibold outline-none"
        />
        <Select value={fromToken} onChange={(v) => update(setFromToken)(v as Stablecoin)} options={TOKENS} />
        <Select value={fromChain} onChange={(v) => update(setFromChain)(v as Chain)} options={CHAINS} />
      </div>

      <label className="mb-1 block text-[12px] text-textSecondary">You receive</label>
      <div className="mb-4 flex gap-2">
        <div className="flex-1 rounded-2xl bg-surface px-4 py-3 text-lg font-semibold text-textSecondary">
          {quote ? quote.amountOut : "—"}
        </div>
        <Select value={toToken} onChange={(v) => update(setToToken)(v as Stablecoin)} options={TOKENS} />
      </div>

      {sameToken && (
        <p className="mb-3 text-[12px] text-loss">Pick two different tokens to swap.</p>
      )}
      {error && (
        <p className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</p>
      )}

      {quote && (
        <div className="mb-4 space-y-1 rounded-2xl bg-white/[0.04] p-4 text-[13px] text-textSecondary">
          <Row k="Route" v={quote.route.join(" · ")} />
          <Row k="Destination" v={quote.toChain} />
          <Row k="Slippage" v={`${quote.slippagePct}%`} />
          <Row k="Network fee" v={`$${quote.gasUsd.toFixed(4)}`} />
          <Row k="ETA" v={`~${quote.etaSeconds}s`} />
        </div>
      )}

      {!quote ? (
        <button onClick={getQuote} disabled={busy || !valid} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
          {busy ? "Fetching best route…" : "Get quote"}
        </button>
      ) : (
        <button onClick={execute} disabled={busy || !valid} className="w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
          {busy ? "Swapping…" : "Confirm swap"}
        </button>
      )}
    </Modal>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-2xl bg-surface px-3 py-3 text-sm font-semibold outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o.toUpperCase()}</option>
      ))}
    </select>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span>{k}</span>
      <span className="text-textPrimary">{v}</span>
    </div>
  );
}
