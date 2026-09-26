import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/payments`;

export const metadata: Metadata = {
  title: "Crypto Payment Gateway — Accept USDC on Arbitrum (0.5%)",
  // The fee API, the quote and the EIP-3009 authorization flow are live and
  // documented. What is NOT live is Furlpay broadcasting settlement on a
  // merchant's behalf — no production signer or Arbitrum RPC is configured —
  // so the description stops at what a merchant can integrate today.
  description:
    "Furlpay is a crypto payment gateway for USDC on Arbitrum at 0.5% per transaction, with a live fee API, passkey-secured wallets and built-in sanctions screening. Merchant settlement is in development.",
  alternates: {
    canonical: "/products/payments",
    languages: { "en-US": "/products/payments", "en-GB": "/uk/products/payments", "en-AE": "/ae/products/payments", "en-JP": "/jp/products/payments", "x-default": "/products/payments" },
  },
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
    a: "Create a payment via the REST API or SDK and hand the payer an EIP-712 authorization to sign — that much works today and most integrations take an afternoon. Furlpay settling the authorization on Arbitrum and returning a signed receipt is in development; see the quickstart for the request shape, which is stable.",
  },
  {
    q: "How fast do I get paid?",
    a: "By design, immediately — an Arbitrum payment finalizes in about a second with no multi-day settlement hold or rolling reserve, unlike card processing. Furlpay is not settling live merchant volume yet; merchant settlement is in development pending production signer configuration.",
  },
];

export default function PaymentsPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
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
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow="Payments"
          title="The crypto payment gateway that costs 0.5%."
          subtitle="A live fee API, EIP-3009 authorizations and built-in sanctions screening for USDC on Arbitrum. Integrate today; merchant settlement is in development."
          secondary={{ href: "/docs/quickstart", label: "Read the quickstart" }}
        />

        {/* Atomic answer for AI Overviews. */}
        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Furlpay prices USDC payments on Arbitrum One (Chain ID 42161) at a flat{" "}
          <strong className="text-white">0.5%</strong> per transaction — about{" "}
          <strong className="text-white">85% cheaper</strong> than the 3.5% average card
          interchange. A merchant doing $1M a year would save roughly{" "}
          <strong className="text-neon">$30,000</strong>.
        </p>
        <p className="mt-4 max-w-2xl rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-5 text-[15px] leading-relaxed text-textSecondary">
          <strong className="text-amber-300">Where this stands today.</strong> The fee API, the
          quote, the EIP-3009 authorization and the SDKs are live — you can integrate and test the
          full request shape now. Furlpay broadcasting settlement on your behalf is in development:
          the production signer and RPC endpoint are not configured, so{" "}
          <a href="/api/rails" className="text-neon hover:underline">/api/rails</a> reports these
          rails as not configured. We are not taking live merchant volume yet.
        </p>

        <Section title="Why merchants switch">
          <FeatureGrid items={FEATURES} />
        </Section>

        <Section title="See your savings">
          <FeeCalculator />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Build your integration today"
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
