import Link from "next/link";
import type { Metadata } from "next";
import { Zap, Globe, Code2, ShieldCheck, Clock, Wallet, ArrowRight } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Furlpay Payouts — Instant USDC Payouts API for Platforms",
  description:
    "Pay creators, sellers and partners in USDC — instantly, globally, with no bank minimums. The payout rail that replaces 60–150 day fiat holds. One API for creator programs, marketplaces and OTAs.",
  alternates: { canonical: "/payouts" },
  openGraph: {
    title: "Furlpay Payouts — Instant USDC Payouts for Platforms",
    description: "Replace slow fiat payouts with instant USDC. One API, global reach, $0 minimum.",
  },
};

const PROBLEM: [string, string][] = [
  ["60–150 days", "Typical wait for a travel creator to be paid after a trip is consumed"],
  ["$50–$109", "Minimum thresholds before a payout even releases"],
  ["Bank-only", "No global reach — creators without the right bank get stuck"],
];

const FEATURES = [
  { icon: Zap, title: "Instant settlement", body: "Payouts clear in seconds on Arbitrum, not in a monthly batch. Your partners feel paid the moment they earn." },
  { icon: Globe, title: "Global by default", body: "Pay anyone, anywhere, to a wallet — no correspondent banks, no country gaps, no FX surprises." },
  { icon: Wallet, title: "$0 minimum", body: "Release from the first cent. No thresholds that trap small creators' earnings for months." },
  { icon: Code2, title: "One API", body: "A single POST to pay one recipient or ten thousand. Batch payouts settle in one transaction." },
  { icon: ShieldCheck, title: "Compliant by design", body: "OFAC screening on every recipient, Travel Rule payloads, and jurisdiction rules — before funds move." },
  { icon: Clock, title: "On-chain transparency", body: "Every payout is verifiable on-chain. No black-box statements or disputed attribution." },
];

const AUDIENCES = [
  { title: "Creator programs", body: "Travel, gaming, and social platforms paying thousands of creators. Turn a 90-day fiat wait into instant USDC — the single biggest complaint creators have." },
  { title: "Marketplaces & OTAs", body: "Settle with hosts, suppliers, and sellers globally without correspondent-bank delays. Cross-border payout, one integration." },
  { title: "Gig & freelance platforms", body: "Pay a global workforce the moment work is approved. Meta and Visa proved instant USDC payouts in 2026 — offer the same." },
];

const STEPS = [
  { n: 1, title: "Connect", body: "Fund a Furlpay payout balance and get API keys. Sandbox first, no commitment." },
  { n: 2, title: "Call the API", body: "POST a recipient and amount — or a batch of thousands. We screen and settle on Arbitrum." },
  { n: 3, title: "They're paid", body: "Recipients receive USDC in seconds, to any wallet, verifiable on-chain. You get a webhook." },
];

export default function PayoutsPage() {
  return (
    <div className="min-h-screen bg-black text-textPrimary">
      <LandingChrome />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow pointer-events-none absolute inset-0" />
        <div className="mx-auto max-w-6xl px-6 pb-8 pt-16 text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-[12px] text-textSecondary">
            <span className="h-1.5 w-1.5 rounded-full bg-neon" /> Furlpay Payouts · for platforms
          </div>
          <h1 className="mx-auto max-w-3xl text-[40px] font-extrabold leading-[1.05] tracking-tighter sm:text-[56px]">
            Pay creators and partners in <span className="text-neon">seconds, not months.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-textSecondary sm:text-[18px]">
            Every creator program pays slowly, in fiat, with bank minimums and 60–150 day holds. Furlpay Payouts is
            the API that replaces all of it — instant USDC, global, $0 minimum, compliant by design.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/talk-to-us" className="rounded-pill bg-neon px-8 py-3.5 text-[15px] font-semibold text-black transition-transform hover:-translate-y-0.5">
              Talk to us
            </Link>
            <Link href="/docs" className="rounded-pill border border-white/15 px-8 py-3.5 text-[15px] font-semibold text-white transition-colors hover:border-white/40">
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      {/* The problem */}
      <section className="section py-12">
        <h2 className="text-center text-[26px] font-extrabold tracking-tighter sm:text-[32px]">The payout problem everyone lives with</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {PROBLEM.map(([big, small]) => (
            <div key={small} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center">
              <div className="text-[30px] font-extrabold tracking-tight text-red-400">{big}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-textMuted">{small}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-[14px] text-textSecondary">
          It&apos;s the number-one complaint creators have with Expedia, Booking, Klook and every OTA program. Furlpay
          Payouts turns it into your advantage.
        </p>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-neon/10">
                <f.icon className="h-5 w-5 text-neon" />
              </div>
              <h3 className="text-[16px] font-bold text-textPrimary">{f.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-textMuted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Code sample */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="mb-6 text-center text-[24px] font-extrabold tracking-tighter sm:text-[30px]">Pay in one call</h2>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0C]">
          <div className="border-b border-white/5 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-textSecondary">
            payout.ts
          </div>
          <pre className="overflow-x-auto px-5 py-5 text-[13px] leading-relaxed">
            <code className="font-mono text-white/90">{`import { Furlpay } from "@furlpay/node";

const furlpay = new Furlpay(process.env.FURLPAY_KEY);

// Pay a creator instantly in USDC — global, $0 minimum.
const payout = await furlpay.payouts.create({
  recipient: "0xCreator...",   // wallet, or a Furlpay account
  amount: "125.00",
  currency: "USDC",
  metadata: { program: "creators", period: "2026-07" },
});

// payout.status === "settled"  ·  ~250ms on Arbitrum`}</code>
          </pre>
        </div>
      </section>

      {/* Audiences */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <h2 className="text-center text-[26px] font-extrabold tracking-tighter sm:text-[32px]">Built for platforms that pay people</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="text-[17px] font-bold text-textPrimary">{a.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-textMuted">{a.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="section py-12">
        <h2 className="text-center text-[26px] font-extrabold tracking-tighter sm:text-[32px]">Live in three steps</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-neon text-[15px] font-extrabold text-black">{s.n}</div>
              <h3 className="text-[16px] font-bold text-textPrimary">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-textMuted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-3xl border border-neon/30 bg-gradient-to-br from-neon/[0.08] to-transparent p-8 text-center sm:p-10">
          <h2 className="text-[28px] font-extrabold tracking-tighter sm:text-[34px]">Replace your slowest process</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-textMuted">
            If you pay creators, sellers, or partners, we&apos;ll show you a live USDC payout in a 20-minute call.
          </p>
          <Link
            href="/talk-to-us"
            className="mt-6 inline-flex items-center gap-2 rounded-pill bg-neon px-8 py-3.5 text-[15px] font-semibold text-black transition-transform hover:-translate-y-0.5"
          >
            Book a call <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
