import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";

export const metadata: Metadata = {
  title: "Enterprise Stablecoin Settlement API — 24/7 USDC on Arbitrum",
  description:
    "Enterprise-grade stablecoin settlement: 24/7 USDC payouts on Arbitrum, sanctions screening and Travel Rule support, signed receipts, and SLAs. The same rails Mastercard chose.",
  alternates: { canonical: "/solutions/enterprise" },
};

export default function EnterpriseSolutionPage() {
  return (
    <LandingPage
      eyebrow="Solutions · Enterprise"
      title="Enterprise stablecoin settlement."
      subtitle="Move money 24/7 in USDC on Arbitrum — the same Layer 2 Mastercard uses for stablecoin settlement. Sanctions screening, Travel Rule support, signed receipts, and SLAs, exposed as a clean API."
      atomicAnswer={
        <>
          Furlpay provides enterprise stablecoin settlement in <strong className="text-white">USDC on
          Arbitrum</strong> with 24/7 availability, built-in sanctions screening and Travel Rule
          support, and signed on-chain receipts — settling in about a second versus the multi-day,
          business-hours windows of traditional rails.
        </>
      }
      featuresTitle="Settlement infrastructure that clears compliance"
      features={[
        { title: "24/7 settlement", body: "Move funds any time — no cutoff windows, weekends, or bank holidays holding up payouts." },
        { title: "Sanctions screening", body: "Every counterparty is screened against sanctions lists before settlement, with an auditable trail." },
        { title: "Travel Rule", body: "Originator/beneficiary information support for transfers that require it under FATF guidance." },
        { title: "Signed receipts", body: "Each settlement returns a receipt verifiable on Arbiscan for reconciliation and audit." },
        { title: "Batch payouts", body: "Disburse to many recipients in one call via the batch payments API." },
        { title: "Proven rails", body: "Arbitrum is where Mastercard brought 24/7 stablecoin settlement and Robinhood built its chain." },
      ]}
      faq={[
        { q: "What is enterprise stablecoin settlement?", a: "It is moving funds between businesses in a dollar-pegged stablecoin like USDC instead of via wires or card rails. On Arbitrum it settles in about a second, 24/7, for a fraction of a cent of gas, with compliance screening applied to each transfer." },
        { q: "How does Furlpay handle compliance at enterprise scale?", a: "Sanctions screening runs on both sides of every settlement, Travel Rule information is supported where required, and each transfer produces a signed, Arbiscan-verifiable receipt so audit and reconciliation are straightforward." },
        { q: "Why Arbitrum for enterprise settlement?", a: "Arbitrum is a mature Ethereum Layer 2 with sub-second finality and sub-cent gas, and it is where major institutions have moved: Mastercard runs 24/7 stablecoin settlement on it and Robinhood built its chain on Arbitrum Orbit." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Solutions", path: "/solutions/enterprise" },
        { name: "Enterprise", path: "/solutions/enterprise" },
      ]}
      primary={{ href: "/talk-to-us", label: "Talk to us" }}
      secondary={{ href: "/trust", label: "Trust center" }}
      cta={{ title: "Settle at enterprise scale", subtitle: "24/7 USDC settlement with compliance built in.", primary: { href: "/talk-to-us", label: "Talk to sales" }, secondary: { href: "/docs", label: "Read the docs" } }}
      disclaimer="Availability of specific compliance features may vary by jurisdiction."
    />
  );
}
