import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/investing`;

export const metadata: Metadata = {
  title: "Invest in US Stocks, ETFs & Crypto — Fractional Investing",
  description:
    "Hold fractional US stocks, ETFs, and crypto next to your spending balance. Fractional shares, real-time markets, and portfolio-backed credit — all in one Furlpay account.",
  alternates: { canonical: "/products/investing" },
  openGraph: { type: "website", url: URL, title: "Fractional Investing — Stocks, ETFs & Crypto" },
};

const FEATURES = [
  { title: "Fractional shares", body: "Buy a slice of any US stock or ETF from a few dollars — no need to afford a whole share." },
  { title: "Real-time markets", body: "Live quotes, movers, indices, and charts, with research insights published alongside the product." },
  { title: "One balance", body: "Your investing sits next to spending and USDC — move between them without leaving the app." },
  { title: "Portfolio-backed credit", body: "Borrow against your stocks and crypto without selling, so you keep your upside and avoid a taxable event." },
  { title: "Passkey-secured", body: "The same phishing-resistant, seed-phrase-free account that powers payments protects your portfolio." },
  { title: "Research insights", body: "In-house market insights and explainers, indexed and citable, to inform decisions — not financial advice." },
];

const FAQ = [
  {
    q: "Can I invest in US stocks and ETFs with Furlpay?",
    a: "Yes. Furlpay offers fractional investing in US stocks and ETFs alongside crypto, so you can build a portfolio from a few dollars and manage it in the same account as your spending and USDC balance.",
  },
  {
    q: "What is a portfolio-backed credit line?",
    a: "It lets you borrow against your stocks and crypto without selling them. You pay interest only on what you draw, keep your market upside, and avoid triggering a taxable sale.",
  },
  {
    q: "Is investing with Furlpay financial advice?",
    a: "No. Furlpay provides tools and market data, not personalized financial advice. Investing carries risk and you can lose money; research insights are educational, not recommendations.",
  },
];

export default function InvestingPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={[
          financialProduct({
            name: "Furlpay Investing",
            description: "Fractional investing in US stocks, ETFs, and crypto with portfolio-backed credit.",
            url: URL,
            serviceUrl: `${SITE}/investing/insights`,
            category: "Investment platform",
          }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Products", path: "/products" },
            { name: "Investing", path: "/products/investing" },
          ]),
        ]}
      />
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow="Investing"
          title="Invest in US stocks, ETFs, and crypto."
          subtitle="Fractional shares from a few dollars, live markets, and portfolio-backed credit — held in the same passkey-secured account as your payments and USDC."
          primary={{ href: "/investing/insights", label: "Read market insights" }}
          secondary={{ href: "/signup", label: "Get started" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Furlpay lets you hold <strong className="text-white">fractional US stocks, ETFs, and
          crypto</strong> next to your spending balance, and borrow against that portfolio without
          selling — one account, secured by passkeys.
        </p>

        <Section title="Built for one balance">
          <FeatureGrid items={FEATURES} />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Put idle balances to work"
          subtitle="Fractional investing, live markets, and research insights."
          primary={{ href: "/investing/insights", label: "Market insights" }}
        />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank or a registered investment adviser. Investing involves risk,
          including possible loss of principal. Nothing here is financial advice.
        </p>
      </main>
    </div>
  );
}
