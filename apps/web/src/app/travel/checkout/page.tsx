"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Wallet, CreditCard, Coins, Bot, ShieldCheck, Lock, CheckCircle2 } from "lucide-react";
import { sendJSON } from "@/lib/api";
import { Spinner, Pill } from "@/components/ui";
import { RATES, CASHBACK_RATE, type PayToken } from "@/lib/travel/data";

type Method = "wallet" | "balance" | "vcard" | "card" | "agent";
type Booking = {
  id: string;
  authorization: { route: string; x402?: { proof: string; network: string }; card?: { last4: string }; cashbackUsd: number; rebate?: { developerUsd: number } };
};

const METHODS: { id: Method; Icon: typeof Wallet; title: string; sub: string; source: "travala" | "legacy" }[] = [
  { id: "wallet", Icon: Wallet, title: "Pay with Crypto Wallet", sub: "Phantom, Solflare or Coinbase Wallet · x402 on Base", source: "travala" },
  { id: "balance", Icon: Coins, title: "Pay with FurlPay Balance", sub: "Available: 1,240.50 USDC", source: "travala" },
  { id: "vcard", Icon: CreditCard, title: "One-time Virtual Card", sub: "Generate a single-use, MCC-locked Visa card", source: "legacy" },
  { id: "card", Icon: CreditCard, title: "Credit / Debit Card", sub: "Visa · Mastercard · Amex", source: "legacy" },
  { id: "agent", Icon: Bot, title: "AI Agent Authorization", sub: "Set a budget; your agent completes the booking", source: "travala" },
];

function Checkout() {
  const params = useSearchParams();
  const name = params.get("name") ?? "Your stay";
  const ref = params.get("ref") ?? "";
  const nights = Number(params.get("nights")) || 3;
  const roomRate = Number(params.get("amount")) || 540;

  const taxes = Math.round(roomRate * 0.1 * 100) / 100;
  const cashback = Math.round((roomRate + taxes) * CASHBACK_RATE * 100) / 100;
  const total = Math.round((roomRate + taxes - cashback) * 100) / 100;

  const [method, setMethod] = useState<Method>("wallet");
  const [agree, setAgree] = useState(false);
  const [lock, setLock] = useState(15 * 60);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setLock((l) => (l > 0 ? l - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(lock / 60)).padStart(2, "0");
  const ss = String(lock % 60).padStart(2, "0");

  async function pay() {
    setBusy(true);
    const m = METHODS.find((x) => x.id === method)!;
    try {
      const res = await sendJSON<{ booking: Booking }>("/api/travel/book", {
        amountUsd: total,
        source: m.source,
        reference: ref,
        name,
        nights,
        method: m.title,
      });
      setBooking(res.booking);
    } finally {
      setBusy(false);
    }
  }

  if (booking) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-neon" />
        <h1 className="mt-4 text-2xl font-bold text-white">Booking confirmed</h1>
        <p className="mt-1 text-sm text-textSecondary">{name}</p>
        <div className="mt-6 rounded-card border border-white/10 bg-charcoal p-5 text-left text-sm">
          <Row label="Booking ID" value={booking.id} />
          <Row label="Paid" value={`$${total.toLocaleString()}`} />
          <Row label="Route" value={booking.authorization.route === "travala" ? "x402 · USDC on Base" : "Visa VCN"} />
          {booking.authorization.x402 && <Row label="Settlement" value={`${booking.authorization.x402.network} · ${booking.authorization.x402.proof.slice(0, 14)}…`} />}
          {booking.authorization.card && <Row label="Card" value={`•••• ${booking.authorization.card.last4}`} />}
          <Row label="Cashback earned" value={`$${booking.authorization.cashbackUsd} USDC`} highlight />
        </div>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/travel/booking/${booking.id}`} className="rounded-xl bg-neon px-5 py-3 text-sm font-bold text-black transition hover:bg-neonDeep">
            View booking
          </Link>
          <Link href="/travel/my-trips" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.06]">
            My trips
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-6">
      <Link href="/travel/stays" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Back to results
      </Link>
      <h1 className="text-2xl font-bold text-white">Checkout</h1>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Summary */}
        <div className="h-fit rounded-card border border-white/10 bg-charcoal p-5">
          <p className="text-sm font-semibold text-white">Booking summary</p>
          <p className="mt-3 text-base font-bold text-white">{name}</p>
          <p className="text-xs text-textSecondary">{nights} nights · 2 adults</p>
          <div className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-sm">
            <Row label={`Room rate (${nights} nights)`} value={`$${roomRate.toLocaleString()}`} />
            <Row label="Taxes & fees" value={`$${taxes.toLocaleString()}`} />
            <Row label="FurlPay cashback (2%)" value={`-$${cashback.toLocaleString()}`} highlight />
            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
              <span className="font-semibold text-white">Total</span>
              <span className="text-lg font-bold text-white">${total.toLocaleString()}</span>
            </div>
            <p className="text-right text-[11px] text-textSecondary">
              ≈ {total.toFixed(2)} USDC · {(total * RATES.SOL).toFixed(2)} SOL · {(total * RATES.BTC).toFixed(5)} BTC
            </p>
          </div>
          <p className="mt-4 flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-3 py-2 text-[11px] text-textSecondary">
            <Lock className="h-3 w-3" /> Rate locked for {mm}:{ss}
          </p>
        </div>

        {/* Payment */}
        <div>
          <p className="mb-3 text-sm font-semibold text-white">Select payment method</p>
          <div className="space-y-2.5">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  method === m.id ? "border-neon bg-neon/[0.06]" : "border-white/10 bg-charcoal hover:border-white/20"
                }`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-full ${method === m.id ? "bg-neon/15 text-neon" : "bg-white/[0.06] text-textSecondary"}`}>
                  <m.Icon className="h-4 w-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-white">{m.title}</span>
                  <span className="block text-[11px] text-textSecondary">{m.sub}</span>
                </span>
                {m.source === "travala" && <Pill tone="gain">x402</Pill>}
              </button>
            ))}
          </div>

          <label className="mt-4 flex items-center gap-2 text-xs text-textSecondary">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="accent-neon" />
            I agree to the travel terms & cancellation policy
          </label>

          <button
            disabled={!agree || busy || lock === 0}
            onClick={pay}
            className="mt-4 w-full rounded-xl bg-neon py-3.5 text-sm font-bold text-black transition enabled:hover:bg-neonDeep disabled:opacity-40"
          >
            {busy ? "Authorizing…" : lock === 0 ? "Rate expired — refresh" : `Complete booking — Pay $${total.toLocaleString()}`}
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-textSecondary">
            <ShieldCheck className="h-3 w-3 text-neon" /> Secured by FurlPay · Travel Rule &amp; KYC enforced over $1,000
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-textSecondary">{label}</span>
      <span className={highlight ? "font-semibold text-neon" : "text-white"}>{value}</span>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Checkout />
    </Suspense>
  );
}
