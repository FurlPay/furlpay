import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";
import { altLanguages } from "@/lib/seo/hreflang";

export const metadata: Metadata = {
  title: "Furlpay vs Stripe Japan — Card Fees vs 0.5% USDC (2026)",
  description:
    "Furlpay vs Stripe for Japanese business: ~3.6% card fees plus FX on international cards versus 0.5% USDC on Arbitrum, with no chargebacks and instant settlement. When each fits.",
  alternates: {
    canonical: "/jp/compare/stripe",
    languages: altLanguages({ us: "/compare/stripe", uk: "/uk/compare/stripe", ae: "/ae/compare/stripe", jp: "/jp/compare/stripe" }),
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Stripe"
      slug="stripe"
      crumbBase="/jp/compare"
      title="Furlpay vs Stripe (Japan)"
      subtitle="Stripe is the standard for card payments in Japan. Furlpay is stablecoin-native: 0.5% USDC on Arbitrum, no chargebacks, instant settlement. Here's when each one fits a Japanese business."
      atomicAnswer={
        <>
          For Japanese businesses, Stripe charges around <strong className="text-white">3.6%</strong>{" "}
          on cards, plus FX on international cards; Furlpay charges{" "}
          <strong className="text-white">0.5%</strong> for USDC on Arbitrum with no chargebacks and
          instant settlement. Stripe wins on card ubiquity; Furlpay wins on cost, finality, and
          inbound cross-border fares.
        </>
      }
      rows={[
        { feature: "Japan card fee", furlpay: "0.5% flat (USDC)", other: "~3.6% (cards)", furlpayWins: true },
        { feature: "International card fee", furlpay: "0.5% flat", other: "~3.6% + FX", furlpayWins: true },
        { feature: "Settlement speed", furlpay: "~1 second", other: "Multi-day payout", furlpayWins: true },
        { feature: "Chargebacks", furlpay: "None (on-chain final)", other: "Yes + dispute fees", furlpayWins: true },
        { feature: "FX on inbound guests", furlpay: "None (dollar-stable)", other: "Conversion + markup", furlpayWins: true },
        { feature: "Payment methods", furlpay: "USDC stablecoin", other: "Cards, wallets, konbini, bank", furlpayWins: false },
        { feature: "Japan ubiquity", furlpay: "Growing", other: "Universal", furlpayWins: false },
        { feature: "AI / x402 payments", furlpay: "Yes", other: "No", furlpayWins: true },
      ]}
      analysis={[
        { title: "Different rails for different jobs", body: "Stripe is unmatched for accepting Japanese cards, wallets, konbini and bank payments, with mature tooling. Furlpay isn't trying to replace that everywhere — it's the better rail when your customer can pay in USDC and you want to keep 0.5% instead of card interchange plus FX, especially on inbound international bookings." },
        { title: "Inbound is where it counts", body: "Japanese hotels, ryokans and airlines take a large share of the country's 40M+ inbound visitors, where cards add FX and higher interchange. USDC is dollar-stable and borderless, so inbound cross-border is exactly where the 0.5% flat rate saves the most." },
        { title: "Finality and cash flow", body: "Card payments settle over days and can be charged back. USDC on Arbitrum settles in about a second, is final, and has no rolling reserve — better cash flow and no dispute fees." },
        { title: "Use both", body: "Most Japanese businesses keep Stripe for cards and add Furlpay for USDC — offering customers a cheaper option and capturing crypto-native inbound demand without changing their existing checkout." },
      ]}
      faq={[
        { q: "Is Furlpay cheaper than Stripe in Japan?", a: "For payments a customer can make in USDC, usually yes: Furlpay is 0.5% versus Stripe's roughly 3.6% on Japanese cards plus FX on international cards, with instant settlement and no chargebacks. Stripe remains better for broad card, konbini and bank acceptance." },
        { q: "Should a Japanese business replace Stripe with Furlpay?", a: "Usually not entirely. Many businesses keep Stripe for cards and add Furlpay for cheaper USDC payments, especially on inbound bookings. Use each rail where it is strongest." },
        { q: "Is Furlpay registered with the JFSA?", a: "Not yet. Furlpay is not registered with Japan's Financial Services Agency as a Crypto-Asset Exchange or EPIESP. USDC is a legal Electronic Payment Instrument distributed via registered intermediaries such as SBI VC Trade; Furlpay is evaluating a licensed-intermediary pathway. Crypto assets can lose value." },
      ]}
      disclaimer="Comparison based on publicly available information as of July 2026 and may change. Stripe is a trademark of Stripe, Inc. Stripe Japan card fees shown are standard published rates and vary by method and region. Furlpay is not registered with the JFSA; crypto assets are high risk and are not legal tender."
    />
  );
}
