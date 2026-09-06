"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { getJSON } from "@/lib/api";
import { chainName, shortAddress, type Connection } from "@/lib/wallet/connect";

// ---------------------------------------------------------------------------
// Deposit, after a wallet is connected.
//
// THE HONEST SHAPE OF THIS SCREEN. A deposit moves funds from the user's own
// wallet to their FurlPay address, and there are two ways to build it:
//
//   1. the dapp constructs a transfer and calls eth_sendTransaction, or
//   2. the dapp shows the destination address and the user sends from their
//      wallet.
//
// This does (2), because (1) requires a deployed receiving contract, a token
// registry per chain and a confirmed settlement watcher — none of which exist
// on this deployment. Building (1)'s UI over nothing would produce a "Confirm
// deposit" button that either does nothing or, far worse, prompts a real
// wallet signature for a transfer FurlPay cannot credit.
//
// So the review step ends with the destination address and instructions. The
// amount and network the user picks are carried into that copy, so the screen
// is genuinely useful — it just never claims to have submitted anything.
//
// The estimated fee is NOT invented. There is no gas oracle wired here, so the
// row says the wallet will quote it, which is true and is where the user will
// actually read it.
// ---------------------------------------------------------------------------

const ASSETS = [
  { symbol: "USDC", name: "USD Coin", decimals: 6 },
  { symbol: "USDT", name: "Tether", decimals: 6 },
  { symbol: "ETH", name: "Ether", decimals: 18 },
] as const;

const NETWORKS = [
  { id: 1, label: "Ethereum" },
  { id: 8453, label: "Base" },
  { id: 42161, label: "Arbitrum One" },
  { id: 137, label: "Polygon" },
] as const;

type Step = "form" | "review";

export default function DepositFlow({
  conn,
  onCancel,
  onBack,
}: {
  conn: Connection;
  onCancel: () => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<Step>("form");
  const [asset, setAsset] = useState<string>("USDC");
  const [network, setNetwork] = useState<number>(
    conn.chainId > 0 && NETWORKS.some((n) => n.id === conn.chainId) ? conn.chainId : 1
  );
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The address funds should be sent TO. This read `safeAddress`, which is a
  // hash with no key behind it (lib/receiveAddress.ts) — a deposit screen
  // pointing at it destroys whatever is sent. `receiveAddress` is present only
  // when the user has linked a wallet and its EIP-191 proof verified; a null
  // means we genuinely do not have somewhere to send their money, and the
  // screen says so instead of offering something address-shaped.
  useEffect(() => {
    getJSON<{ receiveAddress: { address: string } | null }>("/api/profile")
      .then((p) => setDestination(p.receiveAddress?.address ?? null))
      .catch(() => setDestination(null));
  }, []);

  const numeric = Number.parseFloat(amount);
  const valid = Number.isFinite(numeric) && numeric > 0;

  const networkLabel = useMemo(
    () => NETWORKS.find((n) => n.id === network)?.label ?? chainName(network),
    [network]
  );

  async function copyAddress() {
    if (!destination) return;
    try {
      await navigator.clipboard.writeText(destination);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the address is on screen and selectable. */
    }
  }

  if (step === "review") {
    return (
      <div className="px-6 pb-6 pt-5">
        <button
          type="button"
          onClick={() => setStep("form")}
          className="mb-4 inline-flex items-center gap-1.5 rounded text-[12px] font-semibold text-textSecondary transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Edit amount
        </button>

        <dl className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08]">
          <Line label="Amount" value={`${numeric} ${asset}`} />
          <Line label="Network" value={networkLabel} />
          <Line label="From" value={shortAddress(conn.address)} mono />
          <Line
            label="Network fee"
            value="Quoted by your wallet"
            hint="FurlPay does not estimate gas — your wallet shows the exact fee before you approve."
          />
        </dl>

        <div className="mt-4 rounded-xl border border-gain/25 bg-gain/[0.06] p-4">
          <p className="text-[12.5px] font-semibold text-white">Send to your FurlPay address</p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-textSecondary">
            Send <span className="font-semibold text-white">{numeric} {asset}</span> on{" "}
            <span className="font-semibold text-white">{networkLabel}</span> to the address below
            from your connected wallet. Funds are credited once the transfer confirms on-chain.
          </p>

          {destination ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2.5">
              <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-white">
                {destination}
              </code>
              <button
                type="button"
                onClick={copyAddress}
                aria-label="Copy deposit address"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-textSecondary transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-gain" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[11.5px] text-textMuted">Loading your deposit address…</p>
          )}

          <p className="mt-2.5 text-[10.5px] leading-relaxed text-textMuted">
            Only send {asset} on {networkLabel}. Assets sent on another network may be unrecoverable.
          </p>
        </div>

        {/* No "Confirm deposit" button. Nothing here submits a transaction —
            the user sends from their own wallet, which is the only place a
            transfer can actually be authorised. */}
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded-xl border border-white/[0.14] py-2.5 text-[13px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6 pt-5">
      {/* Connected wallet strip */}
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-gain" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-textSecondary">
          {conn.name} · <span className="font-mono text-white">{shortAddress(conn.address)}</span>
        </span>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 rounded text-[11.5px] font-semibold text-textSecondary transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gain"
        >
          Change
        </button>
      </div>

      {/* Asset */}
      <label htmlFor="dep-asset" className="mt-4 block text-[11.5px] font-medium text-textSecondary">
        Asset
      </label>
      <select
        id="dep-asset"
        value={asset}
        onChange={(e) => setAsset(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-white/[0.1] bg-black/40 px-3 py-2.5 text-[13px] font-semibold text-white outline-none transition-colors hover:border-white/25 focus-visible:border-gain/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
      >
        {ASSETS.map((a) => (
          <option key={a.symbol} value={a.symbol} className="bg-[#141416]">
            {a.symbol} — {a.name}
          </option>
        ))}
      </select>

      {/* Amount. No balance shown and no percentage buttons: FurlPay cannot
          read the balance of a self-custodial wallet without an RPC provider,
          and "MAX" computed from a balance we do not have would be a number
          the user could not act on. */}
      <label htmlFor="dep-amount" className="mt-4 block text-[11.5px] font-medium text-textSecondary">
        Amount
      </label>
      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/[0.1] bg-black/40 px-3 focus-within:border-gain/60">
        <input
          id="dep-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[18px] font-bold tabular-nums text-white outline-none placeholder:text-textMuted"
        />
        <span className="shrink-0 text-[13px] font-semibold text-textSecondary">{asset}</span>
      </div>

      {/* Network */}
      <label htmlFor="dep-network" className="mt-4 block text-[11.5px] font-medium text-textSecondary">
        Network
      </label>
      <select
        id="dep-network"
        value={network}
        onChange={(e) => setNetwork(Number(e.target.value))}
        className="mt-1.5 w-full rounded-xl border border-white/[0.1] bg-black/40 px-3 py-2.5 text-[13px] font-semibold text-white outline-none transition-colors hover:border-white/25 focus-visible:border-gain/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
      >
        {NETWORKS.map((n) => (
          <option key={n.id} value={n.id} className="bg-[#141416]">
            {n.label}
          </option>
        ))}
      </select>

      {network !== conn.chainId && conn.chainId > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-textMuted">
          Your wallet is on {chainName(conn.chainId)}. Switch it to {networkLabel} before sending.
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-white/[0.14] py-2.5 text-[13px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => setStep("review")}
          className="flex-[1.4] rounded-xl bg-gain py-2.5 text-[13px] font-bold text-[#04220F] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain disabled:cursor-not-allowed disabled:opacity-40"
        >
          Review deposit
        </button>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-2.5">
      <dt className="text-[12px] text-textSecondary">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className={`text-[12.5px] font-semibold text-white ${mono ? "font-mono" : ""}`}>
          {value}
        </span>
        {hint && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-textMuted">{hint}</span>}
      </dd>
    </div>
  );
}
