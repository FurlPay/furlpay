import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import { FcaRiskWarning, FcaStatusNote } from "@/components/marketing/UkCompliance";

export const metadata: Metadata = {
  title: "Crypto Payment Gateway UK — Accept USDC on Arbitrum (0.5%)",
  description:
    "Accept USDC stablecoin payments in the UK at 0.5% instead of 2.9–3.5% card fees. Sub-second settlement on Arbitrum, no chargebacks, and no FX on international customers.",
  alternates: {
    canonical: "/uk/products/payments",
    languages: { "en-GB": "/uk/products/payments", "en-US": "/products/payments", "en-AE": "/ae/products/payments", "en-JP": "/jp/products/payments", "x-default": "/products/payments" },
  },
};

export default function UkPaymentsPage() {
  return (
    <LandingPage
      merchantOffer
      eyebrow="UK · Payments"
      title="A crypto payment gateway for UK business — 0.5%."
      subtitle="Let customers pay in dollar-stable USDC on Arbitrum and settle for a flat 0.5%. An alternative to UK card interchange, with sub-second settlement, no chargebacks, and no foreign-exchange cost on international customers."
      banner={<FcaRiskWarning />}
      atomicAnswer={
        <>
          Furlpay lets UK businesses accept <strong className="text-white">USDC stablecoin
          payments</strong> on Arbitrum for a flat <strong className="text-white">0.5%</strong> —
          versus the 2.9–3.5% typical of cards — with sub-second settlement and no chargebacks. It is
          an alternative payment rail you can add alongside your existing card processing.
        </>
      }
      featuresTitle="Why UK merchants add USDC"
      features={[
        { title: "0.5%, not 3.5%", body: "Replace card interchange with a flat 0.5%. On £1m of annual volume that is roughly £30,000 kept rather than paid to card networks." },
        { title: "No FX on overseas customers", body: "USDC is dollar-stable and borderless, so you avoid currency-conversion costs and declined foreign cards at the checkout." },
        { title: "Sub-second settlement", body: "Payments finalise on Arbitrum in about a second, not two to four working days, with no rolling reserve held against your balance." },
        { title: "No chargebacks", body: "On-chain payments are final, so you avoid chargeback fraud and dispute fees. You issue refunds deliberately through the API." },
        { title: "Runs beside your stack", body: "Add a hosted checkout or the API alongside your existing processor — no rip-and-replace, no card form." },
        { title: "Open-source SDKs", body: "TypeScript, Python and Rust SDKs, plus webhooks, so your team can integrate and reconcile programmatically." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "UK", path: "/uk" },
        { name: "Payments", path: "/uk/products/payments" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/uk/pricing", label: "GBP pricing" }}
      faq={[
        { q: "How do UK businesses accept crypto payments?", a: "A UK business adds Furlpay's hosted checkout or API alongside its existing processor. Customers pay in USDC on Arbitrum, the business receives a signed receipt, and funds settle in about a second for 0.5% — with no card form and no chargebacks." },
        { q: "Is Furlpay authorised by the FCA?", a: "Not yet. The FCA cryptoasset authorisation gateway opened on 30 September 2026 and the regime becomes mandatory on 25 October 2027; Furlpay is preparing for it. Cryptoassets are not covered by the Financial Services Compensation Scheme and can lose value." },
        { q: "How much can a UK merchant save versus cards?", a: "Moving eligible payments from 2.9–3.5% card fees to a flat 0.5% saves roughly 80–85% on processing. A business with £1m of annual card volume keeps about £30,000. Use the calculator on this page to model your figure." },
      ]}
      cta={{ title: "Add USDC payments to your UK business", subtitle: "Request a demo or model your savings.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/uk/pricing", label: "See pricing" } }}
    >
      <Section title="Model your savings (GBP)">
        <FeeCalculator />
      </Section>
      <FcaStatusNote />
    </LandingPage>
  );
}
