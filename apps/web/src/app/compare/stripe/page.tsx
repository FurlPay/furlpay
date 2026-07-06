import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Stripe — Card Fees vs 0.5% USDC Payments (2026)",
  description:
    "Furlpay vs Stripe: 2.9% + 30¢ card fees versus 0.5% USDC on Arbitrum, with no chargebacks, instant settlement, and x402 agentic payments. When each one is the right tool.",
  alternates: {
    canonical: "/compare/stripe",
    languages: { "en-US": "/compare/stripe", "en-GB": "/uk/compare/stripe", "en-AE": "/ae/compare/stripe", "x-default": "/compare/stripe" },
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Stripe"
      slug="stripe"
      title="Furlpay vs Stripe"
      subtitle="Stripe is the standard for card payments. Furlpay is stablecoin-native: 0.5% USDC on Arbitrum, no chargebacks, instant settlement, and agentic x402 payments. Here's when each fits."
      atomicAnswer={
        <>
          Stripe charges about <strong className="text-white">2.9% + 30¢</strong> for card payments;
          Furlpay charges <strong className="text-white">0.5%</strong> for USDC on Arbitrum with no
          chargebacks and instant settlement. Stripe wins on card ubiquity and fiat tooling; Furlpay
          wins on cost, finality, and AI-agent payments.
        </>
      }
      rows={[
        { feature: "Headline fee", furlpay: "0.5% flat", other: "2.9% + 30¢ (cards)", furlpayWins: true },
        { feature: "Settlement speed", furlpay: "~1 second", other: "2–3 business days", furlpayWins: true },
        { feature: "Chargebacks", furlpay: "None (on-chain final)", other: "Yes + dispute fees", furlpayWins: true },
        { feature: "Payment method", furlpay: "USDC stablecoin", other: "Cards, wallets, ACH, more", furlpayWins: false },
        { feature: "Global reach", furlpay: "Borderless USDC", other: "Extensive fiat coverage", furlpayWins: false },
        { feature: "AI / x402 payments", furlpay: "Yes", other: "No", furlpayWins: true },
        { feature: "Rolling reserve", furlpay: "None", other: "Sometimes", furlpayWins: true },
        { feature: "Open source", furlpay: "Yes (MIT)", other: "SDKs only", furlpayWins: true },
      ]}
      analysis={[
        { title: "Different rails for different jobs", body: "Stripe is unmatched for accepting cards, wallets, and local fiat methods worldwide, with mature dashboards and tooling. Furlpay isn't trying to replace that everywhere — it's the better rail when your customer can pay in USDC and you want to keep 0.5% instead of ~3%." },
        { title: "Cost and finality", body: "Card payments cost about 2.9% + 30¢, settle in days, and can be charged back. USDC on Arbitrum settles in about a second, is final, and costs 0.5% — meaningful for high-volume, low-margin, or cross-border businesses." },
        { title: "Agentic payments", body: "Furlpay's x402 facilitator lets AI agents pay per request in USDC. Stripe has no equivalent machine-to-machine, pay-per-call protocol." },
        { title: "Use both", body: "Many businesses keep Stripe for cards and add Furlpay for USDC and agent payments — offering customers a cheaper option and capturing crypto-native demand without ripping out existing checkout." },
      ]}
      faq={[
        { q: "Is Furlpay cheaper than Stripe?", a: "For payments a customer can make in USDC, yes: Furlpay is 0.5% versus Stripe's ~2.9% + 30¢ for cards, with instant settlement and no chargebacks. Stripe remains better when you need to accept cards and local fiat methods broadly." },
        { q: "Should I replace Stripe with Furlpay?", a: "Usually not entirely. Many businesses keep Stripe for card acceptance and add Furlpay for cheaper USDC payments and AI-agent (x402) payments. Use each rail where it's strongest." },
        { q: "Does Furlpay accept credit cards like Stripe?", a: "Furlpay is stablecoin-native and settles USDC on Arbitrum rather than being a card processor. If you need broad card and fiat acceptance, pair Furlpay with a card processor like Stripe." },
      ]}
      disclaimer="Comparison based on publicly available information as of July 2026 and may change. Stripe is a trademark of Stripe, Inc. Card fees shown are Stripe's standard US online rate; actual pricing varies by plan, method, and region."
    />
  );
}
