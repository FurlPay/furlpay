"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Gift, Copy, Check, Sparkles } from "lucide-react";
import { sendJSON } from "@/lib/api";

const PRESETS = [25, 50, 100, 250, 500];
const TOKENS = ["USDC", "SOL", "BTC", "Card"];

export default function GiftCardsPage() {
  const [amount, setAmount] = useState(100);
  const [token, setToken] = useState("USDC");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; amountUsd: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // redeem
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  // Gift cards answer 503 in production until purchase, delivery and
  // redemption are real (api/travel/gift-cards). Say so, not "failed: 503".
  const unavailable = (e: unknown) =>
    /\b503\b/.test(String((e as Error)?.message ?? "")) ? "Gift cards are not available yet. Nothing was charged." : null;

  async function buy() {
    setBusy(true);
    setBuyError(null);
    try {
      const res = await sendJSON<{ giftCard: { code: string; amountUsd: number } }>("/api/travel/gift-cards", {
        amountUsd: amount,
        payToken: token,
        recipientEmail: email || undefined,
        message: message || undefined,
      });
      setIssued(res.giftCard);
    } catch (e) {
      setBuyError(unavailable(e) ?? "Could not create the gift card. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    setRedeemMsg(null);
    try {
      const res = await sendJSON<{ balanceLabel: string; error?: string }>("/api/travel/gift-cards/redeem", { code: redeemCode });
      setRedeemMsg(res.balanceLabel);
    } catch (e: any) {
      setRedeemMsg(unavailable(e) ?? e?.message ?? "Could not redeem this code.");
    }
  }

  function copy() {
    if (issued) {
      navigator.clipboard?.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>

      <div className="overflow-hidden rounded-card border border-white/10 bg-gradient-to-br from-fuchsia-500/15 via-charcoal to-amber-500/10 p-6">
        <div className="flex items-center gap-2 text-fuchsia-300">
          <Gift className="h-6 w-6" />
          <span className="text-xs font-semibold uppercase tracking-wider">Travel Gift Cards</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold text-white">Give the gift of travel.</h1>
        <p className="mt-1 text-sm text-textSecondary">
          Coming soon: gift cards are not available yet, and nothing on this page can be bought or
          redeemed today.
        </p>
      </div>

      {issued ? (
        <div className="mt-5 rounded-card border border-neon/30 bg-neon/[0.06] p-6 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-neon" />
          <p className="mt-2 text-sm text-textSecondary">${issued.amountUsd} gift card created</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <code className="rounded-lg bg-black/40 px-4 py-2 font-mono text-lg font-bold tracking-wider text-white">
              {issued.code}
            </code>
            <button onClick={copy} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20">
              {copied ? <Check className="h-4 w-4 text-neon" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button onClick={() => setIssued(null)} className="mt-4 text-sm text-neon hover:underline">
            Buy another
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded-card border border-white/10 bg-charcoal p-5">
          <p className="text-sm font-semibold text-white">Choose an amount</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                className={`rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                  amount === v ? "bg-white text-black" : "bg-white/[0.06] text-white hover:bg-white/10"
                }`}
              >
                ${v}
              </button>
            ))}
            <input
              type="number"
              min={10}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-24 rounded-xl bg-white/[0.06] px-3 py-2.5 text-sm text-white focus:outline-none"
            />
          </div>

          <p className="mt-4 text-sm font-semibold text-white">Pay with</p>
          <div className="mt-2 flex gap-2">
            {TOKENS.map((t) => (
              <button
                key={t}
                onClick={() => setToken(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  token === t ? "bg-neon text-black" : "bg-white/[0.06] text-textSecondary"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Recipient email (optional)"
            className="mt-4 w-full rounded-xl bg-white/[0.06] px-3 py-3 text-sm text-white placeholder:text-textSecondary focus:outline-none"
          />
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Personal message (optional)"
            className="mt-2 w-full rounded-xl bg-white/[0.06] px-3 py-3 text-sm text-white placeholder:text-textSecondary focus:outline-none"
          />

          <button
            onClick={buy}
            disabled={busy || amount < 10}
            className="mt-4 w-full rounded-xl bg-neon py-3.5 text-sm font-bold text-black transition enabled:hover:bg-neonDeep disabled:opacity-40"
          >
            {busy ? "Creating…" : `Buy gift card — Pay ${token} $${amount}`}
          </button>
          {buyError && (
            <p role="alert" className="mt-3 rounded-lg bg-loss/15 px-3 py-2 text-center text-xs text-loss">
              {buyError}
            </p>
          )}
        </div>
      )}

      {/* Redeem */}
      <div className="mt-5 rounded-card border border-white/10 bg-charcoal p-5">
        <p className="text-sm font-semibold text-white">Redeem a gift card</p>
        <div className="mt-2 flex gap-2">
          <input
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            placeholder="FURL-XXXX-XXXX-XXXX"
            className="flex-1 rounded-xl bg-white/[0.06] px-3 py-3 font-mono text-sm uppercase text-white placeholder:text-textSecondary focus:outline-none"
          />
          <button onClick={redeem} className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-black hover:bg-white/90">
            Redeem
          </button>
        </div>
        {redeemMsg && <p className="mt-2 text-xs text-neon">{redeemMsg}</p>}
      </div>
    </div>
  );
}
