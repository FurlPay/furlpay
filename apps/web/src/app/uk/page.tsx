import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, CtaBand } from "@/components/marketing/blocks";
import { FcaRiskWarning, FcaStatusNote } from "@/components/marketing/UkCompliance";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Crypto Payment Gateway UK — Accept USDC at 0.5%",
  description:
    "Furlpay for the UK: accept USDC stablecoin payments at 0.5% instead of 2.9–3.5% card fees. For UK hotels, airlines and merchants. Settled on Arbitrum, priced in GBP.",
  alternates: {
    canonical: "/uk",
    languages: { "en-GB": "/uk", "en-US": "/", "en-AE": "/ae", "en-JP": "/jp", "x-default": "/" },
  },
};

const CARDS = [
  { href: "/uk/products/payments", name: "Payments", body: "Accept USDC at 0.5% — an alternative to card interchange for UK businesses." },
  { href: "/uk/solutions/hotels", name: "For hotels", body: "Cut fees on international guests and remove FX and chargebacks." },
  { href: "/uk/solutions/airlines", name: "For airlines", body: "Settle cross-border fares in USDC with no FX loss." },
  { href: "/uk/pricing", name: "Pricing (GBP)", body: "0.5% per transaction, priced in pounds, with an enterprise tier." },
  { href: "/uk/trust", name: "Trust & FCA status", body: "Our security posture and honest UK regulatory status." },
  { href: "/uk/compare/stripe", name: "vs Stripe", body: "How 0.5% USDC compares with UK card processing." },
];

export default function UkHomePage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "UK", path: "/uk" },
        ])}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="United Kingdom"
          title="The USDC payment gateway for UK business."
          subtitle="Let your customers pay in dollar-stable USDC on Arbitrum and settle for a flat 0.5% — an alternative to 2.9–3.5% card fees, with no FX on international payments and no chargebacks. Built for UK hotels, airlines and merchants."
          primary={{ href: "/talk-to-us", label: "Request a demo" }}
          secondary={{ href: "/uk/pricing", label: "See GBP pricing" }}
        />

        <FcaRiskWarning />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <Link key={c.href} href={c.href} className="glass-card p-6 transition-colors hover:border-neon/30">
              <h2 className="text-[17px] font-bold">{c.name}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{c.body}</p>
            </Link>
          ))}
        </div>

        <CtaBand
          title="Bring lower payment fees to your UK business"
          subtitle="Talk to us about a pilot, or model your savings first."
          primary={{ href: "/talk-to-us", label: "Request a demo" }}
          secondary={{ href: "/resources/tools/fee-calculator", label: "Fee calculator" }}
        />

        <FcaStatusNote />
      </main>
    </div>
  );
}
