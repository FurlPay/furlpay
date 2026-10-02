import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Coins, Link2, Timer, ShieldCheck, ArrowLeft, ArrowRight } from "lucide-react";
import { Pill } from "@/components/ui";

export const metadata: Metadata = {
  title: "Price match (coming soon) — USDC cash, not credit | FurlPay Travels",
  description:
    "Planned and not yet available: find the same room or flight cheaper within 24 hours of booking and the difference is paid in USDC, not expiring platform credit.",
};

const STEPS = [
  {
    Icon: BadgeCheck,
    title: "Book on FurlPay",
    body: "Complete any stay or flight booking. Your on-chain receipt is your proof of purchase.",
  },
  {
    Icon: Link2,
    title: "Find it cheaper within 24h",
    body: "Same property or flight, same dates, same room or cabin, same cancellation policy — on any publicly bookable site.",
  },
  {
    Icon: Timer,
    title: "Submit the link",
    body: "Paste the URL in My Trips → Price Match. One link is enough — no screenshot bureaucracy, no support-call maze.",
  },
  {
    Icon: Coins,
    title: "Difference refunds in USDC",
    body: "Approved claims settle to your wallet on-chain, usually in under a minute. Cash you can withdraw — not credit that expires.",
  },
];

const COMPARISON: Array<{ label: string; furlpay: string; typical: string }> = [
  { label: "Payout", furlpay: "USDC cash to your wallet", typical: "Platform credit / wallet balance" },
  { label: "Expiry", furlpay: "Never — it's your money", typical: "Often 12 months, then forfeited" },
  { label: "Settlement", furlpay: "On-chain, under a minute", typical: "Manual review + cash-out request calls" },
  { label: "Proof required", furlpay: "One public URL", typical: "Single-screenshot rules, currency nitpicks" },
  { label: "Claim window", furlpay: "24h after booking", typical: "24h after booking (varies)" },
];

const CONDITIONS = [
  "The lower rate must be publicly viewable and instantly bookable — no member-only, opaque, or mobile-only offline rates.",
  "Identical property/flight, dates, room or cabin class, occupancy, and cancellation policy.",
  "Claims are per booking and capped at $500 USDC per claim.",
  "Currency conversion uses the mid-market rate at claim time — small FX drift on identical base prices won't void a claim.",
  "Submit within 24 hours of completing your FurlPay booking.",
];

export default function PriceMatchPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-8">
      <Link href="/travel" className="mb-4 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Travels
      </Link>

      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Coming soon</Pill>
        <span className="text-xs text-textSecondary">Cash, not credit</span>
      </div>
      {/* No price-match claim flow, payout or refund path exists in the code
          (no API, no My Trips entry). Until it does, this page describes a
          planned programme and says so first; it is not an active guarantee. */}
      <p role="note" className="mb-4 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-[13px] text-textSecondary">
        Price matching is not available yet. Nothing on this page is an active guarantee, and no claim
        can be submitted today. It describes how the programme is planned to work.
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Found it cheaper? <span className="text-neon">The difference, paid in USDC.</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-textSecondary">
        Most platforms &quot;match&quot; prices with wallet credit that expires in a year and takes a support
        call to cash out. We think a price match should be money, not a coupon. Find the same booking
        cheaper within 24 hours and the difference lands in your wallet as USDC — withdrawable, spendable,
        yours.
      </p>

      {/* Steps */}
      <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-card border border-white/10 bg-charcoal p-4">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-neon/15 text-neon">
              <s.Icon className="h-4 w-4" />
            </div>
            <p className="text-sm font-semibold text-white">
              {i + 1}. {s.title}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-textSecondary">{s.body}</p>
          </div>
        ))}
      </section>

      {/* Comparison */}
      <section className="mt-12">
        <h2 className="mb-4 text-xl font-bold text-white">How that compares</h2>
        <div className="overflow-x-auto rounded-card border border-white/10">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-wide text-textMuted">
                <th className="px-4 py-3 font-semibold" />
                <th className="px-4 py-3 font-semibold text-neon">FurlPay Travels</th>
                <th className="px-4 py-3 font-semibold">Typical OTA guarantee</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 text-[13px] font-semibold text-white">{row.label}</td>
                  <td className="px-4 py-3 text-[13px] text-white">{row.furlpay}</td>
                  <td className="px-4 py-3 text-[13px] text-textSecondary">{row.typical}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Conditions */}
      <section className="mt-12 rounded-card border border-white/10 bg-charcoal p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-neon" />
          <h2 className="text-lg font-bold text-white">The fine print — kept short</h2>
        </div>
        <ul className="mt-4 space-y-2">
          {CONDITIONS.map((c) => (
            <li key={c} className="flex gap-2 text-[13px] leading-relaxed text-textSecondary">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neon" />
              {c}
            </li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <section className="mt-12 flex flex-wrap items-center gap-3">
        <Link
          href="/travel"
          className="flex items-center gap-2 rounded-lg bg-neon px-5 py-2.5 text-sm font-bold text-black transition hover:bg-neon/90"
        >
          Book with confidence <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="/travel/alerts"
          className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
        >
          Or set a price alert first
        </Link>
      </section>
    </div>
  );
}
