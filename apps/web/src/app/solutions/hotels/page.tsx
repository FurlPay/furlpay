import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";

export const metadata: Metadata = {
  title: "Crypto Payment Gateway for Hotels — Accept USDC at 0.5%",
  description:
    "Let your hotel accept USDC stablecoin payments at 0.5% instead of 2.9–3.5% card fees. No FX on international guests, ~1-second settlement, and no chargebacks. API alongside your PMS.",
  alternates: {
    canonical: "/solutions/hotels",
    languages: { "en-US": "/solutions/hotels", "en-GB": "/uk/solutions/hotels", "x-default": "/solutions/hotels" },
  },
};

export default function HotelsPage() {
  return (
    <LandingPage
      eyebrow="Solutions · Hotels"
      title="Accept USDC at your hotel — 0.5% fees, no chargebacks."
      subtitle="International guests pay in dollar-stable USDC on Arbitrum. You settle in about a second for a flat 0.5%, skip FX conversion on foreign cards, and eliminate no-show chargebacks — via an API that runs alongside your existing PMS."
      atomicAnswer={
        <>
          Hotels can accept <strong className="text-white">USDC stablecoin payments</strong> through
          Furlpay for a flat <strong className="text-white">0.5%</strong> — versus 2.9–3.5% on cards —
          with no foreign-exchange conversion on international guests, ~1-second settlement instead of
          2–4 days, and no chargebacks. Stablecoin travel payments are going mainstream: Trip.com,
          Emirates, and major chains are already moving this way.
        </>
      }
      featuresTitle="Built for the way hotels take payment"
      features={[
        { title: "0.5%, not 3.5%", body: "Replace card interchange with a flat 0.5%. On $2M/year of bookings that is roughly $60,000 kept instead of paid to card networks." },
        { title: "No FX on foreign guests", body: "USDC is dollar-stable and borderless — no dynamic-currency-conversion markups or declined international cards at checkout." },
        { title: "~1-second settlement", body: "Funds finalize on Arbitrum in about a second, not 2–4 business days, improving cash flow with no rolling reserve." },
        { title: "No chargebacks", body: "On-chain payments are final, so no-show and friendly-fraud chargebacks — and their dispute fees — disappear. You issue refunds deliberately." },
        { title: "Runs beside your PMS", body: "Furlpay is an API and hosted checkout you add alongside your property-management system — no rip-and-replace." },
        { title: "Clean reconciliation", body: "A single USDC ledger with signed, Arbiscan-verifiable receipts per booking makes month-end reconciliation straightforward." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Solutions", path: "/solutions/hotels" },
        { name: "Hotels", path: "/solutions/hotels" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/resources/tools/fee-calculator", label: "Calculate savings" }}
      faq={[
        { q: "How do hotels accept crypto payments?", a: "A hotel adds Furlpay's hosted checkout or API alongside its property-management system. The guest pays in USDC on Arbitrum, the hotel receives a signed receipt, and funds settle in about a second for 0.5% — with no PCI card form and no chargebacks." },
        { q: "Is accepting USDC cheaper than cards for a hotel?", a: "Typically yes. Card interchange runs 2.9–3.5%, plus FX on international guests; Furlpay is a flat 0.5% with no FX markup. A property doing $2M a year in card volume keeps roughly $60,000 by moving eligible payments to USDC." },
        { q: "Do guests need crypto experience to pay?", a: "No. Guests pay from a passkey-secured wallet with no seed phrase, and the checkout guides funding if needed. It behaves more like a card checkout than a typical crypto flow." },
        { q: "Are hotels really adopting stablecoin payments?", a: "The trend is clear in 2026: Trip.com integrated USDT/USDC payments, Emirates announced stablecoin options for premium travelers, and chains including Marriott, Hilton, and Accor are exploring blockchain payments for international guests." },
      ]}
      cta={{ title: "See what your property would save", subtitle: "Request a demo or model your volume in the calculator.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/products/merchant", label: "Merchant features" } }}
      disclaimer="Furlpay is not a bank. Card and savings figures are illustrative estimates and vary by issuer, category, and geography."
    >
      <Section title="Model your property's savings">
        <FeeCalculator />
      </Section>
    </LandingPage>
  );
}
