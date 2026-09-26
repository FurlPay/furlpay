import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/investing`;

export const metadata: Metadata = {
  // Titled and described as what a visitor can actually do here today: read
  // live markets. The previous copy sold fractional share dealing in the
  // present tense, and there is no live brokerage behind it — BROKERAGE_LIVE
  // is off in production, so an order would reach an internal simulator.
  title: "Investing — Live Markets Today, Stock & ETF Orders In Development",
  description:
    "Follow live US stock, ETF and crypto markets in your Furlpay account. Fractional share dealing and portfolio-backed credit are in development and not yet available.",
  alternates: { canonical: "/products/investing" },
  openGraph: { type: "website", url: URL, title: "Investing — Live Markets on Furlpay" },
};

// Live-today features first, in-development features named as such. Mixing
// them in one uniform grid is what let "fractional shares" read as a shipped
// product sitting beside live charts that genuinely work.
const FEATURES = [
  { title: "Real-time markets", body: "Live quotes, movers, indices, and charts, with research insights published alongside the product. Available now." },
  { title: "Research insights", body: "In-house market insights and explainers, indexed and citable, to inform decisions — not financial advice. Available now." },
  { title: "Passkey-secured", body: "The same phishing-resistant, seed-phrase-free account that powers payments will protect your portfolio. Available now for your account." },
  { title: "Fractional shares — in development", body: "Buying a slice of a US stock or ETF from a few dollars. Not yet available: order routing to a live brokerage is pending." },
  { title: "One balance — in development", body: "Investing sitting next to spending and USDC, with transfers between them inside the app." },
  { title: "Portfolio-backed credit — in development", body: "Borrowing against stocks and crypto without selling. The collateral risk engine is not built, so this cannot be offered yet." },
];

const FAQ = [
  {
    q: "Can I invest in US stocks and ETFs with Furlpay?",
    a: "Not yet. Live market data, charts and research are available in your account today, but placing a stock or ETF order is still in development — order routing to a live brokerage is not enabled in production. We will announce it when it opens rather than accept orders that do not reach a market.",
  },
  {
    q: "What is a portfolio-backed credit line?",
    a: "A planned feature that would let you borrow against stocks and crypto without selling them — paying interest only on what you draw and avoiding a taxable sale. It is not available: the risk engine that prices liquidation is not built, and offering collateral lending without one would be unsafe.",
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
            description: "Live US stock, ETF and crypto market data and research. Fractional share dealing is in development.",
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
          title="Follow the markets in your Furlpay account."
          subtitle="Live US stock, ETF and crypto quotes, charts and research — available today. Fractional share dealing and portfolio-backed credit are in development."
          primary={{ href: "/investing/insights", label: "Read market insights" }}
          secondary={{ href: "/signup", label: "Get started" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-5 text-[15px] leading-relaxed text-textSecondary">
          <strong className="text-amber-300">In development.</strong> You can follow live markets and
          read research in Furlpay today. Holding{" "}
          <strong className="text-white">fractional US stocks and ETFs</strong>, and borrowing against
          that portfolio, are being built — neither is available to open yet, and no order placed here
          would reach a market.
        </p>

        <Section title="Built for one balance">
          <FeatureGrid items={FEATURES} />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Follow the markets"
          subtitle="Live markets and research insights, available today."
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
