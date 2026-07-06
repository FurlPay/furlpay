import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Stripe UK — Card Fees vs 0.5% USDC (2026)",
  description:
    "Furlpay vs Stripe for UK business: 1.5% + 20p (UK cards) or 2.9% + 30p (international) versus 0.5% USDC on Arbitrum, with no chargebacks and instant settlement. When each fits.",
  alternates: {
    canonical: "/uk/compare/stripe",
    languages: { "en-GB": "/uk/compare/stripe", "en-US": "/compare/stripe", "x-default": "/compare/stripe" },
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Stripe"
      slug="stripe"
      crumbBase="/uk/compare"
      title="Furlpay vs Stripe (UK)"
      subtitle="Stripe is the standard for UK card payments. Furlpay is stablecoin-native: 0.5% USDC on Arbitrum, no chargebacks, instant settlement. Here's when each one fits a UK business."
      atomicAnswer={
        <>
          For UK businesses, Stripe charges about <strong className="text-white">1.5% + 20p</strong>{" "}
          on UK cards and <strong className="text-white">2.9% + 30p</strong> on international cards;
          Furlpay charges <strong className="text-white">0.5%</strong> for USDC on Arbitrum with no
          chargebacks and instant settlement. Stripe wins on card ubiquity; Furlpay wins on cost,
          finality, and cross-border fares.
        </>
      }
      rows={[
        { feature: "UK card fee", furlpay: "0.5% flat (USDC)", other: "1.5% + 20p (UK cards)", furlpayWins: true },
        { feature: "International card fee", furlpay: "0.5% flat", other: "2.9% + 30p + FX", furlpayWins: true },
        { feature: "Settlement speed", furlpay: "~1 second", other: "2–3 working days", furlpayWins: true },
        { feature: "Chargebacks", furlpay: "None (on-chain final)", other: "Yes + dispute fees", furlpayWins: true },
        { feature: "FX on overseas customers", furlpay: "None (dollar-stable)", other: "Conversion + markup", furlpayWins: true },
        { feature: "Payment methods", furlpay: "USDC stablecoin", other: "Cards, wallets, bank debits", furlpayWins: false },
        { feature: "UK ubiquity", furlpay: "Growing", other: "Universal", furlpayWins: false },
        { feature: "AI / x402 payments", furlpay: "Yes", other: "No", furlpayWins: true },
      ]}
      analysis={[
        { title: "Different rails for different jobs", body: "Stripe is unmatched for accepting UK cards, wallets and bank debits, with mature tooling. Furlpay isn't trying to replace that everywhere — it's the better rail when your customer can pay in USDC and you want to keep 0.5% instead of card interchange plus FX, especially on international bookings." },
        { title: "Cross-border is where it counts", body: "UK hotels and airlines take a large share of overseas customers, where cards add FX and higher interchange. USDC is dollar-stable and borderless, so cross-border is exactly where the 0.5% flat rate saves the most." },
        { title: "Finality and cash flow", body: "Card payments settle in days and can be charged back. USDC on Arbitrum settles in about a second, is final, and has no rolling reserve — better cash flow and no dispute fees." },
        { title: "Use both", body: "Most UK businesses keep Stripe for cards and add Furlpay for USDC — offering customers a cheaper option and capturing crypto-native demand without changing their existing checkout." },
      ]}
      faq={[
        { q: "Is Furlpay cheaper than Stripe in the UK?", a: "For payments a customer can make in USDC, usually yes: Furlpay is 0.5% versus Stripe's roughly 1.5% + 20p on UK cards and 2.9% + 30p plus FX on international cards, with instant settlement and no chargebacks. Stripe remains better for broad UK card and bank-debit acceptance." },
        { q: "Should a UK business replace Stripe with Furlpay?", a: "Usually not entirely. Many UK businesses keep Stripe for cards and add Furlpay for cheaper USDC payments, especially on international bookings. Use each rail where it is strongest." },
        { q: "Is Furlpay FCA authorised?", a: "Not yet. The FCA cryptoasset authorisation gateway opens on 30 September 2026 and the regime is mandatory from 25 October 2027; Furlpay is preparing for it. Cryptoassets are not covered by the FSCS and can lose value." },
      ]}
      disclaimer="Comparison based on publicly available information as of July 2026 and may change. Stripe is a trademark of Stripe, Inc. Stripe UK card fees shown are standard published rates and vary by method and region. Furlpay is not currently FCA authorised; cryptoassets are high risk and not FSCS-protected."
    />
  );
}
