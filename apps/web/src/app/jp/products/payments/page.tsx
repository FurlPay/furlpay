import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import { JfsaRiskNote, JfsaStatusNote } from "@/components/marketing/JpCompliance";
import { altLanguages } from "@/lib/seo/hreflang";

export const metadata: Metadata = {
  title: "Crypto Payment Gateway Japan — Accept USDC on Arbitrum (0.5%)",
  description:
    "Accept USDC stablecoin payments in Japan at 0.5% instead of 3–4% card fees plus FX. Sub-second settlement on Arbitrum, no chargebacks, and no FX loss on inbound international customers.",
  alternates: {
    canonical: "/jp/products/payments",
    languages: altLanguages({ us: "/products/payments", uk: "/uk/products/payments", ae: "/ae/products/payments", jp: "/jp/products/payments" }),
  },
};

export default function JpPaymentsPage() {
  return (
    <LandingPage
      eyebrow="Japan · Payments"
      title="A crypto payment gateway for Japanese business — 0.5%."
      subtitle="Let customers pay in dollar-stable USDC on Arbitrum and settle for a flat 0.5%. An alternative to Japanese card interchange, with sub-second settlement, no chargebacks, and no foreign-exchange loss on inbound international customers."
      banner={<JfsaRiskNote />}
      atomicAnswer={
        <>
          Furlpay lets Japanese businesses accept <strong className="text-white">USDC stablecoin
          payments</strong> on Arbitrum for a flat <strong className="text-white">0.5%</strong> —
          versus the 3–4% typical of cards once FX is included — with sub-second settlement and no
          chargebacks. USDC is a legal Electronic Payment Instrument in Japan as of June 2026.
        </>
      }
      featuresTitle="Why Japanese merchants add USDC"
      features={[
        { title: "0.5%, not 3–4%", body: "Replace card interchange with a flat 0.5%. On ¥100M of annual volume that is roughly ¥3M kept rather than paid to card networks." },
        { title: "No FX on inbound guests", body: "USDC is dollar-stable and borderless, so you avoid currency-conversion costs and declined foreign cards from Japan's 40M+ annual inbound visitors." },
        { title: "Sub-second settlement", body: "Payments finalise on Arbitrum in about a second, not two to four working days, with no rolling reserve held against your balance." },
        { title: "No chargebacks", body: "On-chain payments are final, so you avoid chargeback fraud and dispute fees. You issue refunds deliberately through the API." },
        { title: "Legal clarity", body: "USDC is recognised as an Electronic Payment Instrument under Japanese law, distributed via JFSA-registered intermediaries such as SBI VC Trade — not a grey area." },
        { title: "Open-source SDKs", body: "TypeScript, Python and Rust SDKs, plus webhooks, so your team can integrate and reconcile programmatically." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Japan", path: "/jp" },
        { name: "Payments", path: "/jp/products/payments" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/jp/pricing", label: "JPY pricing" }}
      faq={[
        { q: "How do Japanese businesses accept crypto payments?", a: "A business adds Furlpay's hosted checkout or API alongside its existing processor. Customers pay in USDC on Arbitrum, the business receives a signed receipt, and funds settle in about a second for 0.5% — with no card form and no chargebacks." },
        { q: "Is Furlpay registered with the JFSA?", a: "Not yet. Furlpay is not registered with Japan's Financial Services Agency as a Crypto-Asset Exchange or EPIESP. USDC is a legal Electronic Payment Instrument distributed via registered intermediaries such as SBI VC Trade; Furlpay is evaluating a licensed-intermediary pathway. Crypto assets can lose value." },
        { q: "How much can a Japanese merchant save versus cards?", a: "Moving eligible payments from 3–4% card-plus-FX costs to a flat 0.5% saves roughly 85% on processing. A business with ¥100M of annual card volume keeps about ¥3M. Use the calculator on this page to model your figure." },
      ]}
      cta={{ title: "Add USDC payments to your Japanese business", subtitle: "Request a demo or model your savings.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/jp/pricing", label: "See pricing" } }}
    >
      <Section title="Model your savings (JPY)">
        <FeeCalculator />
      </Section>
      <JfsaStatusNote />
    </LandingPage>
  );
}
