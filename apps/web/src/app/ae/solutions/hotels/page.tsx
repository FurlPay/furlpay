import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import { VaraRiskNote, VaraStatusNote } from "@/components/marketing/AeCompliance";

export const metadata: Metadata = {
  title: "Crypto Payments for Dubai Hotels — Accept USDC at 0.5%",
  description:
    "Let your Dubai hotel accept USDC stablecoin payments at 0.5% instead of 2.9–3.5% card fees. No FX on international guests, ~1-second settlement, and no chargebacks. API beside your PMS.",
  alternates: {
    canonical: "/ae/solutions/hotels",
    languages: { "en-US": "/solutions/hotels", "en-GB": "/uk/solutions/hotels", "en-AE": "/ae/solutions/hotels", "en-JP": "/jp/solutions/hotels", "x-default": "/solutions/hotels" },
  },
};

export default function AeHotelsPage() {
  return (
    <LandingPage
      eyebrow="UAE · Hotels"
      title="Crypto payments for Dubai hotels — 0.5%, no chargebacks."
      subtitle="Dubai hotels have the highest international-guest share and average room rates in the world — exactly where card and FX costs bite. Let guests pay in dollar-stable USDC on Arbitrum, settle for a flat 0.5%, and remove FX and chargebacks, via an API beside your PMS."
      banner={<VaraRiskNote />}
      atomicAnswer={
        <>
          Dubai hotels can accept <strong className="text-white">USDC stablecoin payments</strong>{" "}
          through Furlpay for a flat <strong className="text-white">0.5%</strong> — versus 2.9–3.5% on
          cards — with no FX on international guests, ~1-second settlement, and no chargebacks. Luxury
          properties such as Palazzo Versace Dubai already accept crypto; Furlpay brings it to any
          hotel at a lower fee.
        </>
      }
      featuresTitle="Built for how Dubai hotels take payment"
      features={[
        { title: "0.5%, not 3.5%", body: "Replace card interchange with a flat 0.5%. On AED 7.3m/year of bookings that is roughly AED 220,000 kept rather than paid to card networks." },
        { title: "No FX on overseas guests", body: "USDC is dollar-stable and borderless — no currency-conversion markups or declined foreign cards for Dubai's global visitors." },
        { title: "~1-second settlement", body: "Funds finalise on Arbitrum in about a second, not two to four working days, improving cash flow with no rolling reserve." },
        { title: "No chargebacks", body: "On-chain payments are final, so no-show and friendly-fraud chargebacks — and their dispute fees — disappear." },
        { title: "Capture the crypto traveller", body: "With Emirates and duty free enabling crypto, guests increasingly arrive with wallets. Accepting USDC differentiates your property." },
        { title: "Runs beside your PMS", body: "Add Furlpay's API and hosted checkout alongside your property-management system — no rip-and-replace required." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "UAE", path: "/ae" },
        { name: "Hotels", path: "/ae/solutions/hotels" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/resources/tools/fee-calculator", label: "Calculate savings" }}
      faq={[
        { q: "How can a Dubai hotel accept crypto payments?", a: "The hotel adds Furlpay's hosted checkout or API alongside its property-management system. The guest pays in USDC on Arbitrum, the hotel receives a signed receipt, and funds settle in about a second for 0.5% — with no card form and no chargebacks." },
        { q: "Which Dubai hotels already accept crypto?", a: "Palazzo Versace Dubai accepts Bitcoin, Ethereum and BNB for rooms, dining and spa via a Binance partnership, and other luxury properties are following. Emirates and Dubai Duty Free are also enabling crypto via Crypto.com." },
        { q: "Is this cheaper than cards for international guests?", a: "Typically yes. Card interchange runs 2.9–3.5% plus FX on overseas guests, whereas Furlpay is a flat 0.5% with no FX markup. A hotel with AED 7.3m of annual card volume keeps roughly AED 220,000." },
      ]}
      cta={{ title: "See what your property would save", subtitle: "Request a demo or model your volume.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/products/merchant", label: "Merchant features" } }}
    >
      <Section title="Model your property's savings (AED)">
        <FeeCalculator />
      </Section>
      <VaraStatusNote />
    </LandingPage>
  );
}
