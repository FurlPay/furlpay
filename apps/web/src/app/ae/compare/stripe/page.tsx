import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Stripe UAE — Card Fees vs 0.5% USDC (2026)",
  description:
    "Furlpay vs Stripe for UAE business: card processing plus FX versus 0.5% USDC on Arbitrum, with no chargebacks and instant settlement. When each one fits a Dubai business.",
  alternates: {
    canonical: "/ae/compare/stripe",
    languages: { "en-US": "/compare/stripe", "en-GB": "/uk/compare/stripe", "en-AE": "/ae/compare/stripe", "x-default": "/compare/stripe" },
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Stripe"
      slug="stripe"
      crumbBase="/ae/compare"
      title="Furlpay vs Stripe (UAE)"
      subtitle="Stripe is a standard for card payments. Furlpay is stablecoin-native: 0.5% USDC on Arbitrum, no chargebacks, instant settlement. Here's when each one fits a Dubai business."
      atomicAnswer={
        <>
          For UAE businesses, card processing typically runs{" "}
          <strong className="text-white">2.9% + fees plus FX</strong> on international customers;
          Furlpay charges <strong className="text-white">0.5%</strong> for USDC on Arbitrum with no
          chargebacks and instant settlement. Stripe wins on card ubiquity; Furlpay wins on cost,
          finality, and Dubai&apos;s heavy cross-border mix.
        </>
      }
      rows={[
        { feature: "Headline fee", furlpay: "0.5% flat (USDC)", other: "~2.9% + fees (cards)", furlpayWins: true },
        { feature: "FX on overseas customers", furlpay: "None (dollar-stable)", other: "Conversion + markup", furlpayWins: true },
        { feature: "Settlement speed", furlpay: "~1 second", other: "2–3 working days", furlpayWins: true },
        { feature: "Chargebacks", furlpay: "None (on-chain final)", other: "Yes + dispute fees", furlpayWins: true },
        { feature: "Payment methods", furlpay: "USDC stablecoin", other: "Cards, wallets", furlpayWins: false },
        { feature: "UAE ubiquity", furlpay: "Growing", other: "Widely used", furlpayWins: false },
        { feature: "AI / x402 payments", furlpay: "Yes", other: "No", furlpayWins: true },
        { feature: "Rolling reserve", furlpay: "None", other: "Sometimes", furlpayWins: true },
      ]}
      analysis={[
        { title: "Cross-border is Dubai's default", body: "Dubai's customers are overwhelmingly international, where cards add FX and higher interchange. USDC is dollar-stable and borderless, so cross-border — Dubai's norm — is exactly where a flat 0.5% saves the most." },
        { title: "Different rails for different jobs", body: "Stripe is excellent for accepting cards and wallets, with mature tooling. Furlpay isn't trying to replace that everywhere — it's the better rail when your customer can pay in USDC and you want 0.5% instead of card interchange plus FX." },
        { title: "Finality and cash flow", body: "Card payments settle in days and can be charged back. USDC on Arbitrum settles in about a second, is final, and has no rolling reserve — better cash flow and no dispute fees." },
        { title: "Use both", body: "Most UAE businesses keep cards and add Furlpay for USDC — offering a cheaper option and capturing crypto-native demand without changing their existing checkout." },
      ]}
      faq={[
        { q: "Is Furlpay cheaper than Stripe in the UAE?", a: "For payments a customer can make in USDC, usually yes: Furlpay is 0.5% versus roughly 2.9% plus fees and FX on cards, with instant settlement and no chargebacks. Stripe remains better for broad card acceptance." },
        { q: "Should a Dubai business replace Stripe with Furlpay?", a: "Usually not entirely. Many UAE businesses keep cards and add Furlpay for cheaper USDC payments, especially given Dubai's cross-border customer base. Use each rail where it is strongest." },
        { q: "Is Furlpay VARA-licensed?", a: "No. Offering virtual asset services in or from Dubai requires a VARA licence; Furlpay is not currently VARA-licensed and is evaluating licensing. Virtual assets carry risk and can lose value." },
      ]}
      disclaimer="Comparison based on publicly available information as of July 2026 and may change. Stripe is a trademark of Stripe, Inc. Card fees vary by method and region. Furlpay is not currently VARA-licensed; virtual assets are high risk and are not legal tender."
    />
  );
}
