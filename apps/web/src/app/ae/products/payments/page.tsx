import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import { Section } from "@/components/marketing/blocks";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import { VaraRiskNote, VaraStatusNote } from "@/components/marketing/AeCompliance";

export const metadata: Metadata = {
  title: "Crypto Payment Gateway Dubai — Accept USDC on Arbitrum (0.5%)",
  description:
    "Accept USDC stablecoin payments in Dubai and the UAE at 0.5% instead of 2.9–3.5% card fees. Sub-second settlement on Arbitrum, no chargebacks, and no FX on international customers.",
  alternates: {
    canonical: "/ae/products/payments",
    languages: { "en-US": "/products/payments", "en-GB": "/uk/products/payments", "en-AE": "/ae/products/payments", "en-JP": "/jp/products/payments", "x-default": "/products/payments" },
  },
};

export default function AePaymentsPage() {
  return (
    <LandingPage
      merchantOffer
      eyebrow="UAE · Payments"
      title="A crypto payment gateway for Dubai business — 0.5%."
      subtitle="Let customers pay in dollar-stable USDC on Arbitrum and settle for a flat 0.5%. An alternative to card interchange, with sub-second settlement, no chargebacks, and no FX on international customers — aligned with Dubai's cashless 2026 vision."
      banner={<VaraRiskNote />}
      atomicAnswer={
        <>
          Furlpay lets UAE businesses accept <strong className="text-white">USDC stablecoin
          payments</strong> on Arbitrum for a flat <strong className="text-white">0.5%</strong> —
          versus the 2.9–3.5% typical of cards — with sub-second settlement and no chargebacks. It is
          an alternative payment rail you can add alongside your existing card processing.
        </>
      }
      featuresTitle="Why Dubai merchants add USDC"
      features={[
        { title: "0.5%, not 3.5%", body: "Replace card interchange with a flat 0.5%. On AED 3.6m of annual volume that is roughly AED 108,000 kept rather than paid to card networks." },
        { title: "No FX on overseas customers", body: "USDC is dollar-stable and borderless, so you avoid currency-conversion costs and declined foreign cards for Dubai's international customer base." },
        { title: "Sub-second settlement", body: "Payments finalise on Arbitrum in about a second, not two to four working days, with no rolling reserve held against your balance." },
        { title: "No chargebacks", body: "On-chain payments are final, so you avoid chargeback fraud and dispute fees. You issue refunds deliberately through the API." },
        { title: "Cashless 2026 aligned", body: "As Dubai targets a cashless economy, USDC acceptance adds a modern digital rail your international guests already use." },
        { title: "Open-source SDKs", body: "TypeScript, Python and Rust SDKs, plus webhooks, so your team can integrate and reconcile programmatically." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "UAE", path: "/ae" },
        { name: "Payments", path: "/ae/products/payments" },
      ]}
      primary={{ href: "/talk-to-us", label: "Request a demo" }}
      secondary={{ href: "/ae/pricing", label: "AED pricing" }}
      faq={[
        { q: "How do Dubai businesses accept crypto payments?", a: "A UAE business adds Furlpay's hosted checkout or API alongside its existing processor. Customers pay in USDC on Arbitrum, the business receives a signed receipt, and funds settle in about a second for 0.5% — with no card form and no chargebacks." },
        { q: "Is Furlpay licensed by VARA?", a: "No. Offering virtual asset services in or from Dubai requires a licence from the Virtual Assets Regulatory Authority (VARA); Furlpay is not currently VARA-licensed and is evaluating licensing. Virtual assets carry risk and can lose value." },
        { q: "Is crypto payment adoption real in Dubai?", a: "Yes. Emirates and Dubai Duty Free are enabling crypto payments via Crypto.com, luxury hotels such as Palazzo Versace Dubai already accept crypto, and the UAE has launched a regulated dirham stablecoin (DDSC). Dubai is targeting a largely cashless economy in 2026." },
      ]}
      cta={{ title: "Add USDC payments to your Dubai business", subtitle: "Request a demo or model your savings.", primary: { href: "/talk-to-us", label: "Request a demo" }, secondary: { href: "/ae/pricing", label: "See pricing" } }}
    >
      <Section title="Model your savings (AED)">
        <FeeCalculator />
      </Section>
      <VaraStatusNote />
    </LandingPage>
  );
}
