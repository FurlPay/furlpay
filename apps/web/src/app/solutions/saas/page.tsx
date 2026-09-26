import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";

export const metadata: Metadata = {
  title: "Stablecoin Billing for SaaS — USDC Subscriptions & Usage",
  description:
    "Bill SaaS customers in USDC on Arbitrum for 0.5%. Recurring authorizations, usage-based metering, global payments without card declines, and webhooks for your billing system.",
  alternates: { canonical: "/solutions/saas" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/solutions/saas",
    siteName: "Furlpay",
    title: "Stablecoin Billing for SaaS — USDC Subscriptions & Usage",
    description: "Bill SaaS customers in USDC on Arbitrum for 0.5%. Recurring authorizations, usage-based metering, global payments without card declines, and webhooks for your billing system.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stablecoin Billing for SaaS — USDC Subscriptions & Usage",
    description: "Bill SaaS customers in USDC on Arbitrum for 0.5%. Recurring authorizations, usage-based metering, global payments without card declines, and webhooks for your billing system.",
    images: ["/og.png"],
  },
};

export default function SaasSolutionPage() {
  return (
    <LandingPage
      merchantOffer
      eyebrow="Solutions · SaaS"
      title="Stablecoin billing for SaaS."
      subtitle="Charge subscriptions and usage in USDC on Arbitrum for 0.5% — with recurring authorizations, webhooks, and none of the card declines that quietly churn international customers."
      atomicAnswer={
        <>
          Furlpay lets SaaS companies bill customers in <strong className="text-white">USDC on
          Arbitrum</strong> for a flat <strong className="text-white">0.5%</strong>, using recurring
          EIP-712 authorizations for subscriptions and webhooks for usage-based charges — with no
          failed-card churn on international accounts.
        </>
      }
      featuresTitle="Billing that fits SaaS"
      features={[
        { title: "Recurring authorizations", body: "Collect a signed authorization once and charge on your billing cycle without re-prompting the customer." },
        { title: "Usage-based metering", body: "Meter API calls or seats and settle micropayments — Arbitrum gas is a fraction of a cent." },
        { title: "No card declines", body: "USDC does not expire, get flagged for cross-border risk, or fail on foreign issuers." },
        { title: "Webhooks", body: "Payment, refund, and settlement webhooks drop straight into your existing billing pipeline." },
        { title: "Global from day one", body: "Bill customers anywhere in a dollar-stable asset without opening local card acquiring." },
        { title: "0.5% flat", body: "One rate across plans and geographies — no interchange tiers, no cross-border surcharge." },
      ]}
      faq={[
        { q: "Can I bill SaaS subscriptions in stablecoins?", a: "Yes. Furlpay collects a recurring EIP-712 authorization once and charges USDC on your billing cycle, so subscriptions renew without re-prompting the customer, and usage-based charges settle via the API." },
        { q: "What happens when a card would normally decline?", a: "USDC payments do not expire or get flagged for cross-border risk the way cards do, so you avoid a common source of involuntary churn on international customers. You still control retries and dunning via webhooks." },
        { q: "How does usage-based billing work on-chain?", a: "You meter usage in your app and charge USDC micropayments through the API. Because Arbitrum gas is sub-cent, per-request or per-seat settlement is economically viable." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Solutions", path: "/solutions/saas" },
        { name: "SaaS", path: "/solutions/saas" },
      ]}
      secondary={{ href: "/products/payments", label: "Payments API" }}
      cta={{ title: "Bill in USDC", subtitle: "Recurring authorizations and webhooks for your stack.", secondary: { href: "/docs", label: "Read the docs" } }}
    />
  );
}
