import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, CtaBand } from "@/components/marketing/blocks";
import { VaraRiskNote, VaraStatusNote } from "@/components/marketing/AeCompliance";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Crypto Payment Gateway Dubai — Accept USDC at 0.5%",
  description:
    "Furlpay for the UAE: accept USDC stablecoin payments at 0.5% instead of 2.9–3.5% card fees. For Dubai hotels, airlines and merchants. Aligned with Dubai's cashless 2026 vision.",
  alternates: {
    canonical: "/ae",
    languages: { "en-US": "/", "en-GB": "/uk", "en-AE": "/ae", "en-JP": "/jp", "x-default": "/" },
  },
};

const CARDS = [
  { href: "/ae/products/payments", name: "Payments", body: "Accept USDC at 0.5% — an alternative to card interchange for Dubai business." },
  { href: "/ae/solutions/hotels", name: "For hotels", body: "Capture the crypto traveller. Cut fees and FX on international guests." },
  { href: "/ae/solutions/airlines", name: "For airlines", body: "Settle cross-border fares in USDC with no FX loss." },
  { href: "/ae/pricing", name: "Pricing (AED)", body: "0.5% per transaction, shown in dirhams, with an enterprise tier." },
  { href: "/ae/trust", name: "Trust & VARA status", body: "Our security posture and honest UAE regulatory status." },
  { href: "/ae/compare/stripe", name: "vs Stripe", body: "How 0.5% USDC compares with card processing in the UAE." },
];

export default function AeHomePage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "UAE", path: "/ae" },
        ])}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="United Arab Emirates"
          title="The USDC payment gateway for Dubai business."
          subtitle="As Dubai targets a cashless economy, let customers pay in dollar-stable USDC on Arbitrum and settle for a flat 0.5% — an alternative to 2.9–3.5% card fees, with no FX on international guests and no chargebacks. Built for Dubai's hotels, airlines and merchants."
          primary={{ href: "/talk-to-us", label: "Request a demo" }}
          secondary={{ href: "/ae/pricing", label: "See AED pricing" }}
        />

        <VaraRiskNote />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Crypto payments are already live across Dubai: Emirates and Dubai Duty Free are enabling
          crypto via Crypto.com, and luxury properties such as Palazzo Versace Dubai already accept
          it. Furlpay brings the same capability to any business — at a flat{" "}
          <strong className="text-white">0.5%</strong>, settled on Arbitrum.
        </p>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <Link key={c.href} href={c.href} className="glass-card p-6 transition-colors hover:border-neon/30">
              <h2 className="text-[17px] font-bold">{c.name}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{c.body}</p>
            </Link>
          ))}
        </div>

        <CtaBand
          title="Bring lower payment fees to your Dubai business"
          subtitle="Talk to us about a pilot, or model your savings first."
          primary={{ href: "/talk-to-us", label: "Request a demo" }}
          secondary={{ href: "/resources/tools/fee-calculator", label: "Fee calculator" }}
        />

        <VaraStatusNote />
      </main>
    </div>
  );
}
