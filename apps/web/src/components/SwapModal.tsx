"use client";

import { useState } from "react";
import { sendJSON } from "@/lib/api";
import { Chain, Token } from "@/lib/types";
import { TOKENS } from "@furlpay/types";
import { TOKEN_CHAINS, type SwapQuote } from "@/lib/services/swap";
import Modal from "./Modal";

export default function SwapModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [fromToken, setFromToken] = useState<Token>("USDT");
  const [toToken, setToToken] = useState<Token>("USDC");
  const [fromChain, setFromChain] = useState<Chain>("arbitrum");
  const [toChain, setToChain] = useState<Chain>("arbitrum");
  const [amount, setAmount] = useState("100");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amt = Number(amount);
  const sameRoute = fromToken === toToken && fromChain === toChain;
  const valid = amt > 0 && !sameRoute;

  // A quote is only good for the inputs it priced — invalidate it on any change.
  function update<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setQuote(null);
      setError(null);
    };
  }

  // Token picks also snap the chain to somewhere the token circulates.
  function pickToken(side: "from" | "to") {
    return (t: Token) => {
      if (side === "from") {
        update(setFromToken)(t);
        if (!TOKEN_CHAINS[t].includes(fromChain)) setFromChain(TOKEN_CHAINS[t][0]);
      } else {
        update(setToToken)(t);
        if (!TOKEN_CHAINS[t].includes(toChain)) setToChain(TOKEN_CHAINS[t][0]);
      }
    };
  }

  async function getQuote() {
    setBusy(true);
    setError(null);
    try {
      const r = await sendJSON<{ quote: SwapQuote }>("/api/swaps", {
        fromToken, toToken, fromChain, toChain, amountIn: amt,
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
        fromToken, toToken, fromChain, toChain, amountIn: amt, execute: true,
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
    <Modal open={open} onClose={onClose} title="Swap">
      <p className="mb-4 text-[13px] text-textSecondary">
        Li.Fi routes across chains — including Solana and Robinhood Chain — for the cheapest fill.
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
        <Select value={fromToken} onChange={(v) => pickToken("from")(v as Token)} options={TOKENS} />
        <Select value={fromChain} onChange={(v) => update(setFromChain)(v as Chain)} options={TOKEN_CHAINS[fromToken]} />
      </div>

      <label className="mb-1 block text-[12px] text-textSecondary">You receive</label>
      <div className="mb-4 flex gap-2">
        <div className="flex-1 rounded-2xl bg-surface px-4 py-3 text-lg font-semibold text-textSecondary">
          {quote ? quote.amountOut : "—"}
        </div>
        <Select value={toToken} onChange={(v) => pickToken("to")(v as Token)} options={TOKENS} />
        <Select value={toChain} onChange={(v) => update(setToChain)(v as Chain)} options={TOKEN_CHAINS[toToken]} />
      </div>

      {sameRoute && (
        <p className="mb-3 text-[12px] text-loss">Pick a different token or destination chain.</p>
      )}
      {error && (
        <p className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</p>
      )}

      {quote && (
        <div className="mb-4 space-y-1 rounded-2xl bg-white/[0.04] p-4 text-[13px] text-textSecondary">
          <Row k="Route" v={quote.route.join(" · ")} />
          <Row k="Destination" v={quote.toChain} />
          <Row k="Slippage" v={`${quote.slippagePct}%`} />
          {quote.feeUsd > 0 && <Row k="Swap fees" v={`$${quote.feeUsd.toFixed(2)}`} />}
          <Row k="Network fee" v={quote.gasUsd < 0.01 ? "<$0.01" : `$${quote.gasUsd.toFixed(4)}`} />
          <Row k="ETA" v={`~${quote.etaSeconds}s`} />
          <Row k="Quote" v={quote.source === "lifi" ? "Li.Fi live" : "Estimated"} />
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

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
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
