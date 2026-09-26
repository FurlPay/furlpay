import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import { FcaRiskWarning, FcaStatusNote } from "@/components/marketing/UkCompliance";

export const metadata: Metadata = {
  title: "Crypto Payments for UK Hotels — Accept USDC at 0.5%",
  description:
    "Let your UK hotel accept USDC stablecoin payments at 0.5% instead of 2.9–3.5% card fees. No FX on international guests, ~1-second settlement, and no chargebacks. API beside your PMS.",
  alternates: {
    canonical: "/uk/solutions/hotels",
    languages: { "en-GB": "/uk/solutions/hotels", "en-US": "/solutions/hotels", "en-AE": "/ae/solutions/hotels", "en-JP": "/jp/solutions/hotels", "x-default": "/solutions/hotels" },
  },
};

export default function UkHotelsPage() {
  return (
    <LandingPage
      merchantOffer
      eyebrow="UK · Hotels"
      title="Crypto payments for UK hotels — 0.5%, no chargebacks."
      subtitle="London and UK hotels take a large share of international guests, and those bookings carry the highest card and FX costs. Let guests pay in dollar-stable USDC on Arbitrum, settle for a flat 0.5%, and remove FX and chargebacks — via an API that runs beside your PMS."
      banner={<FcaRiskWarning />}
      atomicAnswer={
        <>
          UK hotels can accept <strong className="text-white">USDC stablecoin payments</strong>{" "}
          through Furlpay for a flat <strong className="text-white">0.5%</strong> — versus 2.9–3.5% on
          cards — with no foreign-exchange cost on international guests, ~1-second settlement, and no
          chargebacks. It runs alongside your existing property-management system.
        </>
      }
      featuresTitle="Built for how UK hotels take payment"
      features={[
        { title: "0.5%, not 3.5%", body: "Replace card interchange with a flat 0.5%. On £2m/year of bookings that is roughly £60,000 kept rather than paid to card networks." },
        { title: "No FX on overseas guests", body: "USDC is dollar-stable and borderless — no currency-conversion markups or declined foreign cards for international travellers." },
        { title: "~1-second settlement", body: "Funds finalise on Arbitrum in about a second, not two to four working days, improving cash flow with no rolling reserve." },
        { title: "No chargebacks", body: "On-chain payments are final, so no-show and friendly-fraud chargebacks — and their dispute fees — disappear." },
        { title: "Runs beside your PMS", body: "Add Furlpay's API and hosted checkout alongside your property-management system — no rip-and-replace required." },
        { title: "Clean reconciliation", body: "A single USDC ledger with signed, verifiable receipts per booking makes month-end reconciliation straightforward." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "UK", path: "/uk" },
        { name: "Hotels", path: "/uk/solutions/hotels" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/resources/tools/fee-calculator", label: "Calculate savings" }}
      faq={[
        { q: "How can a UK hotel accept crypto payments?", a: "The hotel adds Furlpay's hosted checkout or API alongside its property-management system. The guest pays in USDC on Arbitrum, the hotel receives a signed receipt, and funds settle in about a second for 0.5% — with no card form and no chargebacks." },
        { q: "Is this cheaper than cards for international guests?", a: "Typically yes. Card interchange runs 2.9–3.5% plus FX on overseas guests, whereas Furlpay is a flat 0.5% with no FX markup. A hotel with £2m of annual card volume keeps roughly £60,000." },
        { q: "Are hotels really adopting stablecoin payments?", a: "The trend is clear in 2026: Trip.com integrated USDT/USDC payments, Emirates announced stablecoin options for premium travellers, and chains including Marriott, Hilton and Accor are exploring blockchain payments for international guests." },
      ]}
      cta={{ title: "See what your property would save", subtitle: "Request a demo or model your volume.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/products/merchant", label: "Merchant features" } }}
    >
      <Section title="Model your property's savings (GBP)">
        <FeeCalculator />
      </Section>
      <FcaStatusNote />
    </LandingPage>
  );
}
