import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";

export const metadata: Metadata = {
  title: "Get Paid in USDC Globally — Furlpay for Freelancers",
  description:
    "Invoice clients anywhere and get paid in USDC on Arbitrum — no 3–5 day wire delays, no 5–7% remittance fees, and no waiting on PayPal holds. Settle to a local account or hold USD-stable.",
  alternates: { canonical: "/solutions/freelancers" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/solutions/freelancers",
    siteName: "Furlpay",
    title: "Get Paid in USDC Globally — Furlpay for Freelancers",
    description: "Invoice clients anywhere and get paid in USDC on Arbitrum — no 3–5 day wire delays, no 5–7% remittance fees, and no waiting on PayPal holds. Settle to a local account or hold USD-stable.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Get Paid in USDC Globally — Furlpay for Freelancers",
    description: "Invoice clients anywhere and get paid in USDC on Arbitrum — no 3–5 day wire delays, no 5–7% remittance fees, and no waiting on PayPal holds. Settle to a local account or hold USD-stable.",
    images: ["/og.png"],
  },
};

export default function FreelancersSolutionPage() {
  return (
    <LandingPage
      merchantOffer
      eyebrow="Solutions · Freelancers"
      title="Get paid in USDC, anywhere in the world."
      subtitle="Invoice clients and receive USDC on Arbitrum in seconds — skip the 3–5 day wire, the 5–7% remittance cut, and the platform holds. Keep it dollar-stable or settle to a local account."
      atomicAnswer={
        <>
          Freelancers can invoice clients and get paid in <strong className="text-white">USDC on
          Arbitrum</strong> in seconds, avoiding 3–5 day international wires and 5–7% remittance fees.
          Furlpay settles to a local USD/EUR account or lets you hold a dollar-stable balance — for a
          flat <strong className="text-white">0.5%</strong>.
        </>
      }
      featuresTitle="Cross-border pay that respects your margin"
      features={[
        { title: "Paid in seconds", body: "USDC settles on Arbitrum in about a second — no multi-day wire or ACH wait." },
        { title: "Keep more", body: "0.5% instead of the 5–7% common on international remittance and some payout platforms." },
        { title: "No holds", body: "Funds are yours on settlement — no rolling reserve or account freeze at an intermediary's discretion." },
        { title: "Dollar-stable", body: "Hold USDC to avoid local-currency volatility, or settle to a local bank account when you want fiat." },
        { title: "Simple invoices", body: "Share a payment link; the client pays in USDC and you get a signed receipt for your records." },
        { title: "Global clients", body: "Accept from clients in any country without them needing a specific card network or bank." },
      ]}
      faq={[
        { q: "How do freelancers get paid in USDC?", a: "The design is: share a Furlpay payment link, your client pays in USDC on Arbitrum, and the payment lands in about a second for a flat 0.5%. Payment links and the fee quote work today; Furlpay-operated settlement and payout to a local bank account are in development, so this is not yet a way to get paid." },
        { q: "Is this cheaper than PayPal or a wire?", a: "Usually. International wires and remittance often cost 5–7% plus FX spread and take days; some payout platforms add currency-conversion fees and holds. USDC settles in seconds for a flat 0.5% with no FX markup." },
        { q: "Can I convert USDC to my local currency?", a: "That is the plan — settle to a local USD or EUR account through Furlpay's banking rails, or hold USDC and convert when the rate suits you. Local accounts are in development and cannot be opened yet." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Solutions", path: "/solutions/freelancers" },
        { name: "Freelancers", path: "/solutions/freelancers" },
      ]}
      secondary={{ href: "/products/payments", label: "How payments work" }}
      cta={{ title: "Invoice in USDC", subtitle: "Get paid in seconds, keep more of it.", secondary: { href: "/signup", label: "Get started" } }}
      disclaimer="Furlpay is not a bank. Crypto assets can lose value and are not deposit-insured."
    />
  );
}
