import type { Metadata } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/payments`;

export const metadata: Metadata = {
  title: "Crypto Payment Gateway — Accept USDC on Arbitrum (0.5%)",
  description:
    "Furlpay is a crypto payment gateway for accepting USDC stablecoin payments on Arbitrum at 0.5% per transaction. Sub-second settlement, a live fee API, and passkey-secured wallets.",
  alternates: { canonical: "/products/payments" },
  openGraph: { type: "website", url: URL, title: "Crypto Payment Gateway — USDC on Arbitrum" },
};

const FEATURES = [
  { title: "0.5% flat", body: "One rate, no monthly fee, no setup fee, no interchange. Gas on Arbitrum is a fraction of a cent." },
  { title: "Sub-second settlement", body: "Payments finalize on Arbitrum One (Chain ID 42161) in about a second — funds are yours immediately, not in 2–3 days." },
  { title: "Live fee API", body: "Quote any payment in real time at /api/payments/fees/estimate. No hidden FX spread, no surprise markups." },
  { title: "Sanctions screening", body: "Both sides of every payment are screened against sanctions lists before settlement — compliance is built in, not bolted on." },
  { title: "Passkey wallets", body: "Customers pay from phishing-resistant, passkey-secured wallets. No seed phrase, no browser-extension popups." },
  { title: "On-chain receipts", body: "Every payment links to Arbiscan and returns a signed receipt you can reconcile programmatically." },
];

const FAQ = [
  {
    q: "How much does the Furlpay payment gateway cost?",
    a: "Furlpay charges 0.5% per transaction plus a fraction of a cent of Arbitrum gas. There is no monthly fee, setup fee, or interchange. That is roughly 80% cheaper than the 2.9–3.5% typical of card processing.",
  },
  {
    q: "Which stablecoins and network does Furlpay support?",
    a: "Furlpay settles USDC on Arbitrum One (Chain ID 42161). Arbitrum is an Ethereum Layer 2 with sub-second confirmation and gas costs measured in fractions of a cent, which is what makes 0.5% pricing viable.",
  },
  {
    q: "How do I integrate it?",
    a: "Create a payment via the REST API or SDK, hand the payer an EIP-712 authorization to sign, and Furlpay settles USDC on Arbitrum and returns a signed receipt. Most integrations take an afternoon — see the quickstart.",
  },
  {
    q: "How fast do I get paid?",
    a: "Immediately. Payments finalize on-chain in about a second and the USDC is in your account with no multi-day settlement hold or rolling reserve.",
  },
];

export default function PaymentsPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={[
          financialProduct({
            name: "Furlpay USDC Payment Gateway",
            description:
              "Accept USDC stablecoin payments on Arbitrum with 0.5% fees and sub-second settlement.",
            url: URL,
            fees: "0.5% per transaction",
            serviceUrl: `${SITE}/docs`,
            category: "Payment gateway",
          }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Products", path: "/products" },
            { name: "Payments", path: "/products/payments" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Payments"
          title="The crypto payment gateway that costs 0.5%."
          subtitle="Accept USDC on Arbitrum with sub-second settlement, a live fee API, and built-in sanctions screening. No interchange, no rolling reserve, no multi-day hold."
          secondary={{ href: "/docs/quickstart", label: "Read the quickstart" }}
        />

        {/* Atomic answer for AI Overviews. */}
        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Furlpay processes USDC payments on Arbitrum One (Chain ID 42161) for a flat{" "}
          <strong className="text-white">0.5%</strong> per transaction with sub-second settlement —
          about <strong className="text-white">85% cheaper</strong> than the 3.5% average card
          interchange. A merchant doing $1M a year saves roughly{" "}
          <strong className="text-neon">$30,000</strong>.
        </p>

        <Section title="Why merchants switch">
          <FeatureGrid items={FEATURES} />
        </Section>

        <Section title="See your savings">
          <FeeCalculator />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Accept your first USDC payment today"
          subtitle="Free sandbox, open-source SDKs, and a 5-minute quickstart."
          secondary={{ href: "/docs/quickstart", label: "Quickstart" }}
        />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Card comparison figures are typical published rates and vary by
          issuer, category, and geography.
        </p>
      </main>
    </div>
  );
}
