import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import { JfsaRiskNote, JfsaStatusNote } from "@/components/marketing/JpCompliance";
import { altLanguages } from "@/lib/seo/hreflang";

export const metadata: Metadata = {
  title: "Crypto Payments for Japanese Hotels & Ryokans — Accept USDC at 0.5%",
  description:
    "Let your Tokyo or Kyoto hotel or ryokan accept USDC stablecoin payments at 0.5% instead of 3–4% card fees plus FX. No FX on inbound guests, ~1-second settlement, no chargebacks. API beside your PMS.",
  alternates: {
    canonical: "/jp/solutions/hotels",
    languages: altLanguages({ us: "/solutions/hotels", uk: "/uk/solutions/hotels", ae: "/ae/solutions/hotels", jp: "/jp/solutions/hotels" }),
  },
};

export default function JpHotelsPage() {
  return (
    <LandingPage
      eyebrow="Japan · Hotels & ryokans"
      title="Crypto payments for Japanese hotels — 0.5%, no chargebacks."
      subtitle="Japan's 40M+ inbound visitors bring high-value, cross-border bookings — exactly where card and FX costs bite hardest, and where premium ryokans and city hotels charge ¥50,000–¥200,000 a night. Let guests pay in dollar-stable USDC on Arbitrum, settle for a flat 0.5%, and remove FX and chargebacks — via an API that runs beside your PMS."
      banner={<JfsaRiskNote />}
      atomicAnswer={
        <>
          Japanese hotels and ryokans can accept <strong className="text-white">USDC stablecoin
          payments</strong> through Furlpay for a flat <strong className="text-white">0.5%</strong> —
          versus 3–4% on cards plus FX — with no foreign-exchange cost on inbound guests, ~1-second
          settlement, and no chargebacks. It runs alongside your existing property-management system.
        </>
      }
      featuresTitle="Built for how Japanese hotels take payment"
      features={[
        { title: "0.5%, not 3–4%", body: "Replace card interchange plus FX with a flat 0.5%. On ¥200M/year of bookings that is roughly ¥6M kept rather than paid to card networks." },
        { title: "No FX on inbound guests", body: "USDC is dollar-stable and borderless — no currency-conversion markups or declined foreign cards for Japan's international travellers." },
        { title: "~1-second settlement", body: "Funds finalise on Arbitrum in about a second, not two to four working days, improving cash flow with no rolling reserve." },
        { title: "No chargebacks", body: "On-chain payments are final, so no-show and friendly-fraud chargebacks — and their dispute fees — disappear on high-value ryokan stays." },
        { title: "Enhances omotenashi", body: "A seamless, frictionless checkout complements Japanese hospitality rather than replacing it — one less point of friction for the guest." },
        { title: "Runs beside your PMS", body: "Add Furlpay's API and hosted checkout alongside your property-management system — no rip-and-replace required." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Japan", path: "/jp" },
        { name: "Hotels", path: "/jp/solutions/hotels" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/resources/tools/fee-calculator", label: "Calculate savings" }}
      faq={[
        { q: "How can a Japanese hotel accept crypto payments?", a: "The hotel adds Furlpay's hosted checkout or API alongside its property-management system. The guest pays in USDC on Arbitrum, the hotel receives a signed receipt, and funds settle in about a second for 0.5% — with no card form and no chargebacks." },
        { q: "Is this cheaper than cards for inbound guests?", a: "Typically yes. Card interchange runs 3–4% plus FX on overseas guests, whereas Furlpay is a flat 0.5% with no FX markup. A hotel with ¥200M of annual card volume keeps roughly ¥6M." },
        { q: "Is accepting USDC legal for a hotel in Japan?", a: "Yes. Since 1 June 2026 USDC is a recognised Electronic Payment Instrument under Japanese law, distributed by JFSA-registered intermediaries such as SBI VC Trade. Retailers like Bic Camera already accept crypto, so acceptance precedent exists." },
      ]}
      cta={{ title: "See what your property would save", subtitle: "Request a demo or model your volume.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/products/merchant", label: "Merchant features" } }}
    >
      <Section title="Model your property's savings (JPY)">
        <FeeCalculator />
      </Section>
      <JfsaStatusNote />
    </LandingPage>
  );
}
