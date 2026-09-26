import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import JsonLd from "@/components/JsonLd";
import MerchantSettlementNotice from "@/components/marketing/MerchantSettlementNotice";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Crypto Payments for E-commerce — Accept USDC at Checkout",
  description:
    "Add USDC stablecoin payments to your online store for 0.5% instead of 2.9–3.5% card fees. Hosted checkout, no chargebacks, and signed on-chain receipts. Works with any stack.",
  alternates: { canonical: "/solutions/ecommerce" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/solutions/ecommerce",
    siteName: "Furlpay",
    title: "Crypto Payments for E-commerce — Accept USDC at Checkout",
    description: "Add USDC stablecoin payments to your online store for 0.5% instead of 2.9–3.5% card fees. Hosted checkout, no chargebacks, and signed on-chain receipts. Works with any stack.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crypto Payments for E-commerce — Accept USDC at Checkout",
    description: "Add USDC stablecoin payments to your online store for 0.5% instead of 2.9–3.5% card fees. Hosted checkout, no chargebacks, and signed on-chain receipts. Works with any stack.",
    images: ["/og.png"],
  },
};

const FEATURES = [
  { title: "Drop-in checkout", body: "Add a checkout link or embed to any store — Shopify, WooCommerce, or a custom cart — with no PCI scope." },
  { title: "0.5%, no chargebacks", body: "Replace 2.9–3.5% card fees with 0.5% flat, and eliminate chargeback fraud and dispute fees entirely." },
  { title: "Global by default", body: "USDC is borderless and dollar-stable, so you sell internationally without FX markups or declined foreign cards." },
  { title: "Instant settlement", body: "Funds arrive in about a second with no rolling reserve, improving cash flow versus card payouts." },
  { title: "Signed receipts", body: "Reconcile orders against Arbiscan-verifiable receipts returned by the API." },
  { title: "Open SDKs", body: "TypeScript, Python, and Rust SDKs plus webhooks for order fulfilment automation." },
];

const FAQ = [
  {
    q: "How do I add crypto payments to my e-commerce store?",
    a: "Add a Furlpay hosted checkout link or embed to your store and customers pay in USDC on Arbitrum. There is no PCI scope and no card form; you settle for 0.5% with signed receipts for each order.",
  },
  {
    q: "Can I accept USDC on Shopify or WooCommerce?",
    a: "Yes. Because Furlpay checkout is a hosted link plus a webhook, it works alongside Shopify, WooCommerce, or a custom cart. The webhook confirms payment so you can trigger fulfilment automatically.",
  },
  {
    q: "How much can an online store save?",
    a: "Switching from 2.9–3.5% card fees to 0.5% saves roughly 80–85% on processing. A store doing $500,000 a year saves about $12,000–$15,000 annually — use the calculator on this page for your number.",
  },
];

export default function EcommercePage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Solutions", path: "/solutions/ecommerce" },
          { name: "E-commerce", path: "/solutions/ecommerce" },
        ])}
      />
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow="Solutions · E-commerce"
          title="Crypto payments for your online store."
          subtitle="Accept USDC at checkout for 0.5% instead of 2.9–3.5% card fees — with no chargebacks, instant settlement, and a drop-in hosted checkout that works with any stack."
          secondary={{ href: "/products/merchant", label: "Merchant features" }}
        />

        {/* This page is hand-built rather than rendered by LandingPage, which
            is exactly why the notice has to be added explicitly: the template's
            merchantOffer flag cannot reach it. */}
        <MerchantSettlementNotice />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Add a Furlpay hosted checkout to your store and customers pay in{" "}
          <strong className="text-white">USDC on Arbitrum</strong>. You settle for{" "}
          <strong className="text-white">0.5%</strong> with no chargebacks and no PCI scope — a
          drop-in for Shopify, WooCommerce, or a custom cart.
        </p>

        <Section title="Built for online sellers">
          <FeatureGrid items={FEATURES} />
        </Section>

        <Section title="What you'd save">
          <FeeCalculator />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand title="Add USDC checkout to your store" secondary={{ href: "/products/merchant", label: "Merchant" }} />
      </main>
    </div>
  );
}
