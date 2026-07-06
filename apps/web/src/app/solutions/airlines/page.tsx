import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";

export const metadata: Metadata = {
  title: "Crypto Payment Gateway for Airlines — USDC Ticket Settlement",
  description:
    "Airlines and booking platforms can accept USDC on Arbitrum at 0.5% — no FX loss on cross-border fares, instant confirmation, and no chargebacks on high-value tickets. API-first.",
  alternates: {
    canonical: "/solutions/airlines",
    languages: { "en-US": "/solutions/airlines", "en-GB": "/uk/solutions/airlines", "x-default": "/solutions/airlines" },
  },
};

export default function AirlinesPage() {
  return (
    <LandingPage
      eyebrow="Solutions · Airlines"
      title="Settle airline tickets in USDC — instant, 0.5%, no FX loss."
      subtitle="High-value, cross-border fares are where card fees and FX losses hurt most. Accept USDC on Arbitrum for a flat 0.5%, confirm in about a second, and remove chargebacks on the tickets that matter."
      atomicAnswer={
        <>
          Airlines and flight-booking platforms can accept <strong className="text-white">USDC on
          Arbitrum</strong> through Furlpay for a flat <strong className="text-white">0.5%</strong>,
          with no foreign-exchange loss on cross-border fares, near-instant confirmation, and no
          chargebacks. Stablecoin travel payments are scaling fast — Emirates, Trip.com, and USDC
          flight platforms like Alternative Airlines already support them.
        </>
      }
      featuresTitle="Where stablecoins beat cards for air travel"
      features={[
        { title: "No FX on cross-border fares", body: "International ticket sales lose margin to currency conversion. USDC is dollar-stable, so the fare you quote is the amount you settle." },
        { title: "0.5% flat", body: "Replace 2.9–3.5% card processing on high-value tickets with a flat 0.5% — meaningful on a $2,000 international fare." },
        { title: "Instant confirmation", body: "Payment finalizes on Arbitrum in about a second, so tickets confirm immediately without a multi-day settlement window." },
        { title: "No chargebacks", body: "On-chain payments are final, removing chargeback fraud and dispute fees on expensive, easily-disputed purchases." },
        { title: "API-first", body: "Integrate USDC settlement into your booking flow or OTA via REST API, SDK, and webhooks — no card gateway rip-out required." },
        { title: "Global reach", body: "Accept from travelers in 230+ countries in a single borderless asset, without local card acquiring in each market." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Solutions", path: "/solutions/airlines" },
        { name: "Airlines", path: "/solutions/airlines" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/resources/tools/fee-calculator", label: "Calculate savings" }}
      faq={[
        { q: "Can airlines accept crypto payments for tickets?", a: "Yes. An airline or flight-booking platform integrates Furlpay's API into its checkout, and travelers pay in USDC on Arbitrum. The payment settles in about a second for 0.5%, tickets confirm immediately, and there are no chargebacks." },
        { q: "Why are stablecoins good for airline tickets specifically?", a: "Air tickets are high-value and often cross-border, so card interchange and FX conversion take a large absolute cut, and chargebacks are costly. USDC removes FX, settles at 0.5%, and is final — which matters most exactly on expensive international fares." },
        { q: "Which airlines already accept stablecoins?", a: "Adoption is accelerating in 2026: Emirates announced stablecoin payment options for premium travelers, Trip.com integrated USDT/USDC, and USDC-native flight platforms such as Alternative Airlines and Fly Fairly support hundreds of carriers." },
      ]}
      cta={{ title: "Settle fares in USDC", subtitle: "Request a demo or model your ticket volume.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/products/travel", label: "Travel product" } }}
      disclaimer="Furlpay is not a bank. Figures are illustrative estimates and vary by carrier, route, and payment mix."
    >
      <Section title="Model your ticket volume">
        <FeeCalculator />
      </Section>
    </LandingPage>
  );
}
