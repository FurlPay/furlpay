import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import { VaraRiskNote, VaraStatusNote } from "@/components/marketing/AeCompliance";

export const metadata: Metadata = {
  title: "Crypto Payments for UAE Airlines — USDC Ticket Settlement",
  description:
    "UAE airlines and booking platforms can accept USDC on Arbitrum at 0.5% — no FX loss on cross-border fares, instant confirmation, and no chargebacks on high-value tickets.",
  alternates: {
    canonical: "/ae/solutions/airlines",
    languages: { "en-US": "/solutions/airlines", "en-GB": "/uk/solutions/airlines", "en-AE": "/ae/solutions/airlines", "x-default": "/solutions/airlines" },
  },
};

export default function AeAirlinesPage() {
  return (
    <LandingPage
      eyebrow="UAE · Airlines"
      title="Settle airline tickets in USDC — instant, 0.5%, no FX loss."
      subtitle="Emirates and Dubai Duty Free are already enabling crypto payments via Crypto.com. UAE airlines and booking platforms can accept USDC on Arbitrum for a flat 0.5%, confirm in about a second, and remove chargebacks on high-value, cross-border fares."
      banner={<VaraRiskNote />}
      atomicAnswer={
        <>
          UAE airlines and flight-booking platforms can accept <strong className="text-white">USDC on
          Arbitrum</strong> through Furlpay for a flat <strong className="text-white">0.5%</strong>,
          with no FX loss on cross-border fares, near-instant confirmation, and no chargebacks.
          Emirates already accepts crypto via Crypto.com; Furlpay offers a lower-fee USDC rail.
        </>
      }
      featuresTitle="Where stablecoins beat cards for air travel"
      features={[
        { title: "No FX on cross-border fares", body: "International ticket sales lose margin to currency conversion. USDC is dollar-stable, so the fare you quote is the amount you settle." },
        { title: "0.5% flat", body: "Replace 2.9–3.5% card processing on high-value tickets with a flat 0.5% — meaningful on a AED 7,000 international fare." },
        { title: "Instant confirmation", body: "Payment finalises on Arbitrum in about a second, so tickets confirm immediately without a multi-day settlement window." },
        { title: "No chargebacks", body: "On-chain payments are final, removing chargeback fraud and dispute fees on expensive, easily-disputed purchases." },
        { title: "API-first", body: "Integrate USDC settlement into your booking flow via REST API, SDK and webhooks — no card gateway rip-out required." },
        { title: "Global reach", body: "Accept from travellers in 230+ countries in a single borderless asset, without local card acquiring in each market." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "UAE", path: "/ae" },
        { name: "Airlines", path: "/ae/solutions/airlines" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/resources/tools/fee-calculator", label: "Calculate savings" }}
      faq={[
        { q: "Can UAE airlines accept crypto payments for tickets?", a: "Yes. A UAE airline or flight-booking platform integrates Furlpay's API into its checkout, and travellers pay in USDC on Arbitrum. The payment settles in about a second for 0.5%, tickets confirm immediately, and there are no chargebacks." },
        { q: "Does Emirates accept crypto?", a: "Emirates and Dubai Duty Free have signed agreements with Crypto.com to accept crypto payments, with support planned for a wide range of assets including stablecoins. Furlpay offers an alternative USDC rail at a flat 0.5%." },
        { q: "Why are stablecoins good for airline tickets specifically?", a: "Air tickets are high-value and often cross-border, so card interchange and FX conversion take a large absolute cut and chargebacks are costly. USDC removes FX, settles at 0.5%, and is final." },
      ]}
      cta={{ title: "Settle fares in USDC", subtitle: "Request a demo or model your ticket volume.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/products/travel", label: "Travel product" } }}
    >
      <Section title="Model your ticket volume (AED)">
        <FeeCalculator />
      </Section>
      <VaraStatusNote />
    </LandingPage>
  );
}
