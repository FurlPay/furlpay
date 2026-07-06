import type { Metadata } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/merchant`;

export const metadata: Metadata = {
  title: "Accept Stablecoin Payments — Merchant USDC Acceptance",
  description:
    "Accept USDC stablecoin payments as a merchant: hosted checkout, signed receipts, refunds, and settlement to a local bank account. 0.5% per transaction on Arbitrum.",
  alternates: { canonical: "/products/merchant" },
  openGraph: { type: "website", url: URL, title: "Accept Stablecoin Payments" },
};

const FEATURES = [
  { title: "Hosted checkout", body: "Drop in a checkout link or embed — no PCI scope, no card forms, no chargebacks." },
  { title: "Settle to fiat", body: "Keep balances in USDC or auto-settle to a local USD/EUR account via integrated banking rails." },
  { title: "Refunds & receipts", body: "Issue full or partial refunds through the API; every payment returns a signed, on-chain-verifiable receipt." },
  { title: "No chargebacks", body: "On-chain payments are final. No friendly fraud, no dispute fees, no reserve held against your balance." },
  { title: "Compliance built in", body: "Sanctions screening and Travel Rule support run on every payment — you stay compliant without extra vendors." },
  { title: "Open-source SDKs", body: "TypeScript, Python, and Rust SDKs plus a CLI and MCP server, all MIT-licensed on GitHub." },
];

const FAQ = [
  {
    q: "How do I accept stablecoin payments as a merchant?",
    a: "Create a checkout session via Furlpay's API or hosted link, share it with the customer, and they pay in USDC from a passkey wallet. You receive a signed receipt and the funds settle on Arbitrum in about a second for 0.5%.",
  },
  {
    q: "Can I settle stablecoin payments to my bank account?",
    a: "Yes. You can hold USDC or auto-convert and settle to a local USD or EUR account through Furlpay's integrated banking rails, so accepting crypto does not require you to manage crypto.",
  },
  {
    q: "What about chargebacks and fraud?",
    a: "On-chain USDC payments are final once confirmed, so there are no card-style chargebacks, dispute fees, or rolling reserves. Refunds are issued deliberately by you through the API.",
  },
  {
    q: "Do my customers need crypto experience?",
    a: "No. Customers pay from a passkey-secured wallet with no seed phrase, and the checkout guides them through funding if needed. It feels closer to a card checkout than a typical crypto flow.",
  },
];

export default function MerchantPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={[
          financialProduct({
            name: "Furlpay Merchant Acceptance",
            description: "Accept USDC stablecoin payments with hosted checkout, refunds, and fiat settlement.",
            url: URL,
            fees: "0.5% per transaction",
            serviceUrl: `${SITE}/docs`,
            category: "Merchant services",
          }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Products", path: "/products" },
            { name: "Merchant", path: "/products/merchant" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Merchant"
          title="Accept stablecoin payments — keep more of every sale."
          subtitle="Take USDC online with hosted checkout, signed receipts, refunds, and settlement to a local bank account. No chargebacks, no PCI scope, no rolling reserve."
          secondary={{ href: "/resources/tools/fee-calculator", label: "Calculate savings" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          To accept stablecoin payments, create a Furlpay checkout session, share the link, and the
          customer pays in <strong className="text-white">USDC on Arbitrum</strong>. You receive a
          signed receipt and settle for a flat <strong className="text-white">0.5%</strong> — with
          no chargebacks and no multi-day hold.
        </p>

        <Section title="Everything a merchant needs">
          <FeatureGrid items={FEATURES} />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Start accepting USDC"
          subtitle="Free sandbox and a hosted checkout you can share in minutes."
          secondary={{ href: "/solutions/ecommerce", label: "For e-commerce" }}
        />

        <p className="mt-10 text-center text-[11px] text-textMuted">Furlpay is not a bank.</p>
      </main>
    </div>
  );
}
