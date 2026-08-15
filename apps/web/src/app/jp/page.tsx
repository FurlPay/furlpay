import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, CtaBand } from "@/components/marketing/blocks";
import { JfsaRiskNote, JfsaStatusNote } from "@/components/marketing/JpCompliance";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { altLanguages } from "@/lib/seo/hreflang";

export const metadata: Metadata = {
  title: "Crypto Payment Gateway Japan — Accept USDC at 0.5%",
  description:
    "Furlpay for Japan: accept USDC stablecoin payments at 0.5% instead of 3–4% card fees plus FX. For Tokyo and Kyoto hotels, ryokans, airlines and merchants. USDC is a legal Electronic Payment Instrument in Japan.",
  alternates: {
    canonical: "/jp",
    languages: altLanguages({ us: "/", uk: "/uk", ae: "/ae", jp: "/jp" }),
  },
};

const CARDS = [
  { href: "/jp/products/payments", name: "Payments", body: "Accept USDC at 0.5% — an alternative to card interchange for Japanese business." },
  { href: "/jp/solutions/hotels", name: "For hotels & ryokans", body: "Capture the inbound crypto traveller. Cut fees and FX on international guests." },
  { href: "/jp/solutions/airlines", name: "For airlines", body: "Settle cross-border fares in USDC with no FX loss." },
  { href: "/jp/pricing", name: "Pricing (JPY)", body: "0.5% per transaction, shown in yen, with an enterprise tier." },
  { href: "/jp/trust", name: "Trust & JFSA status", body: "Our security posture and honest Japan regulatory status." },
  { href: "/jp/compare/stripe", name: "vs Stripe", body: "How 0.5% USDC compares with card processing in Japan." },
];

export default function JpHomePage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Japan", path: "/jp" },
        ])}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Japan · 日本"
          title="The USDC payment gateway for Japanese business."
          subtitle="Japan welcomed over 40 million inbound visitors in 2025, many carrying digital wallets. Let them pay in dollar-stable USDC on Arbitrum and settle for a flat 0.5% — an alternative to 3–4% card fees plus FX, with no chargebacks. Built for Japan's hotels, ryokans, airlines and merchants."
          primary={{ href: "/talk-to-us", label: "Request a demo" }}
          secondary={{ href: "/jp/pricing", label: "See JPY pricing" }}
        />

        <JfsaRiskNote />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Since 1 June 2026, USDC is legally recognised in Japan as an{" "}
          <strong className="text-white">Electronic Payment Instrument</strong>, distributed through
          JFSA-registered providers such as SBI VC Trade. Furlpay brings USDC acceptance to any
          business — at a flat <strong className="text-white">0.5%</strong>, settled on Arbitrum —
          designed to complement, not replace, Japanese hospitality.
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
          title="Bring lower payment fees to your Japanese business"
          subtitle="Talk to us about a pilot, or model your savings first."
          primary={{ href: "/talk-to-us", label: "Request a demo" }}
          secondary={{ href: "/resources/tools/fee-calculator", label: "Fee calculator" }}
        />

        <JfsaStatusNote />
      </main>
    </div>
  );
}
