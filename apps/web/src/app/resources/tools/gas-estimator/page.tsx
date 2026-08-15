import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import GasEstimator from "@/components/marketing/GasEstimator";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { webApplication, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/resources/tools/gas-estimator`;

export const metadata: Metadata = {
  title: "Arbitrum Gas Cost Estimator — Arbitrum vs Ethereum vs Base",
  description:
    "Estimate gas costs for USDC payments on Arbitrum versus Ethereum, Base, Polygon, and Solana. Free interactive tool — enter your monthly payment volume.",
  alternates: { canonical: "/resources/tools/gas-estimator" },
};

const FAQ = [
  {
    q: "How much does gas cost for a USDC payment on Arbitrum?",
    a: "A USDC transfer on Arbitrum One typically costs a fraction of a cent — roughly $0.002–$0.005 — versus often $1 or more on Ethereum mainnet. That sub-cent cost is what makes 0.5% payment pricing and per-request micropayments viable.",
  },
  {
    q: "Why is Arbitrum so much cheaper than Ethereum?",
    a: "Arbitrum is an Ethereum Layer 2 that batches many transactions and settles proofs to Ethereum, spreading the mainnet cost across all of them. You get Ethereum-grade security at a small fraction of the gas cost.",
  },
  {
    q: "Do Furlpay users pay gas themselves?",
    a: "Not necessarily. Furlpay can sponsor Arbitrum gas via a paymaster, so a user can send USDC without holding ETH for fees. Even unsponsored, Arbitrum gas is a fraction of a cent.",
  },
];

export default function GasEstimatorPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={[
          webApplication({ name: "Furlpay Gas Cost Estimator", description: "Estimate USDC payment gas costs across Arbitrum, Ethereum, Base, Polygon, and Solana.", url: URL }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Resources", path: "/resources" },
            { name: "Tools", path: "/resources/tools" },
            { name: "Gas Estimator", path: "/resources/tools/gas-estimator" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Free tool</p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Gas cost estimator
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Settling payments on-chain costs a network fee (gas). See how Arbitrum — Furlpay&apos;s rail
          — compares with Ethereum, Base, Polygon, and Solana for your volume. Arbitrum gas is a
          fraction of a cent, which is what makes 0.5% pricing possible.
        </p>
        <div className="mt-10">
          <GasEstimator />
        </div>
        <FaqSection items={FAQ} />
      </main>
    </div>
  );
}
