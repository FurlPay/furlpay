import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero } from "@/components/marketing/blocks";
import JsonLd from "@/components/JsonLd";
import { breadcrumb, ORG_ID, SITE } from "@/lib/seo/schema";
import TicketPanel from "./TicketPanel";

export const metadata: Metadata = {
  title: "FurlPay Support Center — Help with Stablecoins, Cards & KYC",
  description:
    "Get help with stablecoin deposits, virtual cards, KYC verification, travel bookings and developer integrations. Open a support ticket or ask the AI co-pilot.",
  alternates: { canonical: "/support" },
};

// Category cards mirror the routing queues in lib/support.ts; each links to
// its help-center article cluster.
const CATEGORIES = [
  {
    title: "Stablecoins & deposits",
    body: "USDC/USDT deposits, transaction statuses, gasless transfers, withdrawals.",
    href: "/docs/help/deposits-withdrawals",
  },
  {
    title: "Virtual cards",
    body: "Card limits and channels, freezing, 3-D Secure approvals, declines.",
    href: "/docs/help/managing-cards",
  },
  {
    title: "KYC verification",
    body: "Tier onboarding, accepted documents, fixing failed verification.",
    href: "/docs/help/kyc-verification",
  },
  {
    title: "Travel bookings",
    body: "Booking with stablecoins, cancellations, refunds and disputes.",
    href: "/docs/help/travel-booking",
  },
  {
    title: "Developers & x402",
    body: "SDKs, webhook verification, and x402 monetization basics.",
    href: "/docs/help/sdk-integration",
  },
  {
    title: "All help articles",
    body: "The full help center: onboarding, security, privacy, and more.",
    href: "/docs/help",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "ContactPage",
  url: `${SITE}/support`,
  about: { "@id": ORG_ID },
  mainEntity: {
    "@type": "Organization",
    "@id": ORG_ID,
    contactPoint: [
      { "@type": "ContactPoint", contactType: "customer support", email: "support@furlpay.com" },
    ],
  },
};

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={[
          faqSchema,
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Support", path: "/support" },
          ]),
        ]}
      />
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow="Support Center"
          title="How can we help?"
          subtitle="Answers for stablecoin deposits, cards, KYC and integrations — or open a ticket and a human follows up by email. The AI co-pilot can also check balances, transactions and card status directly."
          primary={{ href: "/chat", label: "Ask the co-pilot" }}
          secondary={{ href: "/docs", label: "Browse the docs" }}
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <div key={c.title} className="glass-card flex flex-col p-6">
              <h2 className="text-[16px] font-bold">{c.title}</h2>
              <p className="mt-2 flex-1 text-[14px] leading-relaxed text-textSecondary">{c.body}</p>
              <Link href={c.href} className="mt-4 text-[14px] font-semibold text-neon">
                Open →
              </Link>
            </div>
          ))}
        </div>

        <TicketPanel />
      </main>
    </div>
  );
}
