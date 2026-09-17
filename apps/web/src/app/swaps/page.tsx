"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowDownUp,
  Check,
  Fingerprint,
  Route as RouteIcon,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { TOKENS, type Chain, type Token } from "@furlpay/types";
import ConnectWallet from "@/components/ConnectWallet";
import { sendJSON } from "@/lib/api";
import { TOKEN_CHAINS, usdPrice, type SwapQuote } from "@/lib/services/swap";
import {
  authenticateFingerprint,
  isFingerprintAvailable,
  passkeyErrorMessage,
} from "@/lib/passkey";

type Step = "form" | "review" | "confirm" | "success";

const CHAIN_LABEL: Record<Chain, string> = {
  ethereum: "Ethereum",
  polygon: "Polygon",
  base: "Base",
  arbitrum: "Arbitrum",
  arc: "Arc",
  solana: "Solana",
  gnosis: "Gnosis",
  robinhood: "Robinhood Chain",
  bsc: "BNB Chain",
};

export default function SwapTerminal() {
  const [step, setStep] = useState<Step>("form");
  const [fromToken, setFromToken] = useState<Token>("SOL");
  const [toToken, setToToken] = useState<Token>("ETH");
  const [fromChain, setFromChain] = useState<Chain>("solana");
  const [toChain, setToChain] = useState<Chain>("robinhood");
  const [amount, setAmount] = useState("1");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [passkeyReady, setPasskeyReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isFingerprintAvailable().then(setPasskeyReady);
  }, []);

  // Keep chain selections legal for the chosen tokens.
  const pickToken = (side: "from" | "to") => (t: Token) => {
    if (side === "from") {
      setFromToken(t);
      if (!TOKEN_CHAINS[t].includes(fromChain)) setFromChain(TOKEN_CHAINS[t][0]);
    } else {
      setToToken(t);
      if (!TOKEN_CHAINS[t].includes(toChain)) setToChain(TOKEN_CHAINS[t][0]);
    }
  };

  const getQuote = useCallback(async () => {
    const amountIn = Number(amount);
    if (!Number.isFinite(amountIn) || amountIn <= 0) {
      setQuote(null);
      return;
    }
    setLoading(true);
    try {
      const res = await sendJSON<{ quote: SwapQuote; quoteId: string }>("/api/swaps", {
        fromToken,
        toToken,
        fromChain,
        toChain,
        amountIn,
      });
      setQuote(res.quote);
      setQuoteId(res.quoteId);
      setError(null);
    } catch {
      setQuote(null);
      setQuoteId(null);
    } finally {
      setLoading(false);
    }
  }, [fromToken, toToken, fromChain, toChain, amount]);

  useEffect(() => {
    if (step !== "form") return;
    const id = setTimeout(getQuote, 250);
    return () => clearTimeout(id);
  }, [getQuote, step]);

  const flip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromChain(toChain);
    setToChain(fromChain);
  };

  const execute = async () => {
    if (!quote || !quoteId) return;
    // Settles the quote the server issued and is holding. The passkey ceremony
    // in confirmSwap() runs first and can outlast the quote's TTL, in which
    // case this throws and confirmSwap surfaces it — nothing settles at a
    // price the user never saw.
    await sendJSON("/api/swaps", { execute: true, quoteId });
    setQuoteId(null); // single-use server-side; don't let a retry replay it
  };

  /** Passkey ceremony first (when the device has one), then settle the swap. */
  const confirmSwap = async (skipBiometric = false) => {
    setConfirming(true);
    setError(null);
    try {
      if (!skipBiometric && passkeyReady) {
        const verified = await authenticateFingerprint();
        if (!verified) {
          setError("Biometric verification failed.");
          return;
        }
      }
      await execute();
      setStep("success");
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setConfirming(false);
    }
  };

  const reset = () => {
    setQuote(null);
    setError(null);
    setStep("form");
  };

  const sameRoute = fromToken === toToken && fromChain === toChain;
  const crossChain = fromChain !== toChain;
  const rate = quote ? quote.amountOut / quote.amountIn : 0;
  const sellUsd = quote ? quote.amountIn * usdPrice(quote.fromToken) : 0;
  const buyUsd = quote ? quote.amountOut * usdPrice(quote.toToken) : 0;

  return (
    <div className="mx-auto min-h-[100dvh] max-w-md px-4 pb-24 pt-4">
      {step === "form" && (
        <section key="form" className="swap-step">
          <header className="mb-5 flex items-center gap-3">
            <Link href="/dashboard" aria-label="Back" className="text-white/60 hover:text-white">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold">Swap</h1>
              <p className="text-[11px] text-white/50">Cross-chain routing · powered by Li.Fi</p>
            </div>
            <div className="ml-auto">
              <ConnectWallet />
            </div>
          </header>

          <TokenBox
            label="You pay"
            token={fromToken}
            chain={fromChain}
            onToken={pickToken("from")}
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

          <TokenBox
            label="You receive"
            token={toToken}
            chain={toChain}
            onToken={pickToken("to")}
            onChain={setToChain}
            value={quote ? formatAmount(quote.amountOut) : loading ? "…" : "0"}
          />

          {sameRoute && (
            <p className="mt-3 text-[12px] text-loss">
              Pick a different token or destination chain.
            </p>
          )}

          {quote && !sameRoute && (
            <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
              <Row label="Rate">
                1 {fromToken} ≈ {formatAmount(rate)} {toToken}
              </Row>
              <Row label="Network fee">
                <span className="inline-flex items-center gap-1 text-green-400">
                  <Zap size={11} /> {feeLabel(quote.gasUsd)}
                </span>
              </Row>
              {quote.feeUsd > 0 && <Row label="Swap fees">${quote.feeUsd.toFixed(2)}</Row>}
              <Row label="Max slippage">{quote.slippagePct}%</Row>
              <Row label="ETA">~{etaLabel(quote.etaSeconds)}</Row>
              <div className="flex items-start gap-2 border-t border-white/10 pt-2 text-white/50">
                <RouteIcon size={13} className="mt-0.5 shrink-0" />
                <span>
                  {quote.route.join(" → ")}
                  {quote.source === "lifi" ? " · live quote" : " · estimated"}
                </span>
              </div>
            </div>
          )}

          <button
            onClick={() => setStep("review")}
            disabled={!quote || loading || sameRoute}
            className="mt-5 w-full rounded-xl bg-accent py-3.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Review order
          </button>
        </section>
      )}

      {step === "review" && quote && (
        <section key="review" className="swap-step">
          <header className="mb-4 flex items-center justify-between">
            <h1 className="text-lg font-semibold">Review order</h1>
            <button onClick={reset} className="text-[13px] text-white/50 hover:text-white">
              Cancel
            </button>
          </header>

          {crossChain && (
            <p className="border-b border-white/[0.06] pb-3 text-center text-[11px] uppercase tracking-wider text-white/40">
              Swapping across networks
            </p>
          )}

          <div className="border-b border-white/[0.06] py-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[13px] text-white/50">You sell</span>
              <span className="text-sm font-semibold">${sellUsd.toFixed(2)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold">
                {formatAmount(quote.amountIn)} {quote.fromToken}
              </span>
              <span className="text-[11px] text-white/40">on {CHAIN_LABEL[quote.fromChain]}</span>
            </div>
          </div>

          <div className="border-b border-white/[0.06] py-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[13px] text-white/50">You buy</span>
              <span className="text-sm font-semibold text-gain">Est. ${buyUsd.toFixed(2)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-bold text-gain">
                {formatAmount(quote.amountOut)} {quote.toToken}
              </span>
              <span className="text-[11px] text-white/40">on {CHAIN_LABEL[quote.toChain]}</span>
            </div>
          </div>

          <div className="space-y-2.5 py-4 text-[13px] text-white/50">
            <Row label={quote.source === "lifi" ? "Li.Fi rate" : "Estimated rate"}>
              <span className="text-white">
                1 {quote.fromToken} ≈ {formatAmount(rate)} {quote.toToken}
              </span>
            </Row>
            <Row label="Includes swap fees">
              <span className="text-white">
                {quote.feeUsd > 0 ? `$${quote.feeUsd.toFixed(2)}` : "Included in rate"}
              </span>
            </Row>
            <Row label="Estimated network fees">
              <span className="text-gain">{feeLabel(quote.gasUsd)}</span>
            </Row>
            <Row label="Max slippage">
              <span className="text-white">{quote.slippagePct}%</span>
            </Row>
            <Row label="Estimated settlement">
              <span className="text-white">~{etaLabel(quote.etaSeconds)}</span>
            </Row>
          </div>

          <p className="mb-5 text-[11px] leading-relaxed text-white/35">
            By submitting this order you are confirming a swap from {CHAIN_LABEL[quote.fromChain]} to{" "}
            {CHAIN_LABEL[quote.toChain]} routed by Li.Fi. The rate shown includes provider and
            network fees. You will receive at least {formatAmount(quote.amountOut * (1 - quote.slippagePct / 100))}{" "}
            {quote.toToken} or the transaction reverts.
          </p>

          <button
            onClick={() => setStep("confirm")}
            className="w-full rounded-xl bg-accent py-3.5 text-sm font-semibold text-white"
          >
            Submit swap
          </button>
        </section>
      )}

      {step === "confirm" && quote && (
        <section key="confirm" className="swap-step pt-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
            <Fingerprint size={30} className="text-accent" />
          </div>
          <h1 className="text-lg font-semibold">Confirm with passkey</h1>
          <p className="mx-auto mt-2 max-w-[280px] text-[13px] text-white/50">
            FurlPay requires biometric verification before moving{" "}
            {formatAmount(quote.amountIn)} {quote.fromToken} from {CHAIN_LABEL[quote.fromChain]}.
          </p>

          {error && (
            <p className="mx-auto mt-4 max-w-[300px] rounded-xl bg-loss/15 p-3 text-[12px] text-loss">
              {error}
            </p>
          )}

          <div className="mt-8 space-y-3">
            <button
              onClick={() => confirmSwap()}
              disabled={confirming}
              className="w-full rounded-xl bg-accent py-3.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {confirming ? "Verifying…" : passkeyReady ? "Verify and swap" : "Confirm swap"}
            </button>
            {error && passkeyReady && (
              <button
                onClick={() => confirmSwap(true)}
                disabled={confirming}
                className="w-full rounded-xl border border-white/10 py-3 text-[13px] text-white/60 hover:text-white disabled:opacity-40"
              >
                Continue without passkey
              </button>
            )}
            <button
              onClick={() => setStep("review")}
              disabled={confirming}
              className="w-full py-2 text-[13px] text-white/40 hover:text-white"
            >
              Back
            </button>
          </div>

          <p className="mt-8 inline-flex items-center gap-1.5 text-[11px] text-white/35">
            <ShieldCheck size={13} /> Verified by your device&apos;s platform authenticator
          </p>
        </section>
      )}

      {step === "success" && quote && (
        <section key="success" className="swap-step pt-10 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gain/10">
            <Check size={30} className="text-gain" />
          </div>
          <h1 className="text-lg font-semibold text-gain">Swap submitted</h1>
          <p className="mx-auto mt-2 max-w-[280px] text-[13px] text-white/50">
            Your {crossChain ? "bridge" : "swap"} from {CHAIN_LABEL[quote.fromChain]} to{" "}
            {CHAIN_LABEL[quote.toChain]} has been broadcast.
          </p>

          <div className="mt-6 space-y-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left text-[13px] text-white/50">
            <Row label="You receive">
              <span className="text-white">
                {formatAmount(quote.amountOut)} {quote.toToken}
              </span>
            </Row>
            <Row label="Destination">
              <span className="text-white">{CHAIN_LABEL[quote.toChain]}</span>
            </Row>
            <Row label="Estimated settlement">
              <span className="text-white">~{etaLabel(quote.etaSeconds)}</span>
            </Row>
          </div>

          <div className="mt-6 space-y-3">
            <Link
              href="/dashboard"
              className="block w-full rounded-xl border border-white/10 bg-white/[0.04] py-3.5 text-sm font-semibold text-white"
            >
              Back to dashboard
            </Link>
            <button onClick={reset} className="w-full py-2 text-[13px] text-white/40 hover:text-white">
              Make another swap
            </button>
          </div>
        </section>
      )}

      <style>{`
        .swap-step {
          animation: swap-step-in 0.25s ease both;
        }
        @keyframes swap-step-in {
          from { opacity: 0; transform: translateX(16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .swap-step { animation: none; }
        }
      `}</style>
    </div>
  );
}

function TokenBox(props: {
  label: string;
  token: Token;
  chain: Chain;
  onToken?: (t: Token) => void;
  onChain?: (c: Chain) => void;
  value: string;
  onValue?: (v: string) => void;
  editable?: boolean;
}) {
  const chains = TOKEN_CHAINS[props.token];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between text-[11px] text-white/40">
        <span>{props.label}</span>
        <select
          value={props.chain}
          onChange={(e) => props.onChain?.(e.target.value as Chain)}
          disabled={!props.onChain}
          className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-white/70 outline-none"
        >
          {chains.map((c) => (
            <option key={c} value={c}>
              {CHAIN_LABEL[c]}
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
          onChange={(e) => props.onToken?.(e.target.value as Token)}
          disabled={!props.onToken}
          className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-sm font-medium outline-none"
        >
          {TOKENS.map((s) => (
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

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

function feeLabel(usd: number): string {
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

function etaLabel(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)} min`;
}
