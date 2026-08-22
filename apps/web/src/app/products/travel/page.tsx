import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/travel`;

export const metadata: Metadata = {
  title: "Book Travel with Crypto — Hotels & Flights in USDC",
  description:
    "Book from hotels and flights and pay in USDC. On-chain receipts, crypto cashback, AI trip planning, and no card FX fees. Powered by Furlpay Travels on Arbitrum.",
  alternates: { canonical: "/products/travel" },
  openGraph: { type: "website", url: URL, title: "Book Travel with Crypto — Pay in USDC" },
};

const FEATURES = [
  { title: "properties", body: "Hotels, apartments, and flights worldwide, priced in USDC with no card FX markup or dynamic-currency-conversion games." },
  { title: "On-chain receipts", body: "Every booking settles on Arbitrum and returns an Arbiscan-linked receipt — useful for expense reports and reimbursements." },
  { title: "Crypto cashback", body: "Earn USDC rewards on eligible bookings, paid to your balance and withdrawable to fiat or crypto." },
  { title: "AI trip planning", body: "Describe a trip in plain language and let an agent assemble and book the itinerary, paying over x402." },
  { title: "No seed phrase", body: "Pay from a passkey-secured wallet — the same account you use for payments and investing." },
  { title: "Business travel", body: "Team policies, spend reports, and virtual cards for agencies and companies booking on behalf of others." },
];

const FAQ = [
  {
    q: "Can I book hotels and flights with crypto?",
    a: "Yes. Furlpay Travels lets you book from hotels and flights and pay in USDC on Arbitrum. You get an on-chain receipt and can earn USDC cashback on eligible bookings.",
  },
  {
    q: "How is paying with USDC cheaper than a card abroad?",
    a: "Card payments abroad add foreign-transaction fees (often 1–3%) and unfavorable FX conversion. USDC is dollar-pegged and settles directly, so there is no FX markup or per-transaction travel surcharge.",
  },
  {
    q: "Do I get a receipt for expenses?",
    a: "Every booking returns a signed receipt linked to Arbiscan, so the payment is independently verifiable — handy for reimbursements, accounting, and tax records.",
  },
  {
    q: "What is AI trip planning?",
    a: "You can describe a trip in plain language and an AI agent assembles an itinerary and books it, paying for each resource over the x402 protocol — an early example of agentic commerce for travel.",
  },
];

export default function TravelPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={[
          financialProduct({
            name: "Furlpay Travels",
            description: "Book hotels and flights and pay in USDC on Arbitrum with on-chain receipts and cashback.",
            url: URL,
            serviceUrl: `${SITE}/travel`,
            category: "Travel booking",
          }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Products", path: "/products" },
            { name: "Travel", path: "/products/travel" },
          ]),
        ]}
      />
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow="Travel"
          title="Book hotels and flights. Pay in USDC."
          subtitle="Furlpay Travels settles bookings on Arbitrum with on-chain receipts, crypto cashback, and AI trip planning — no card FX fees, no seed phrase."
          primary={{ href: "/travel", label: "Search stays" }}
          secondary={{ href: "/travel/crypto-travel", label: "Crypto travel guide" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          Furlpay Travels lets you book hotels and
          flights and pay in <strong className="text-white">USDC on Arbitrum</strong> — with an
          on-chain receipt on every booking and USDC cashback on eligible stays, and no
          foreign-transaction fee.
        </p>

        <Section title="Why book with Furlpay">
          <FeatureGrid items={FEATURES} />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Plan your next trip"
          subtitle="Search stays, pay in USDC, and earn cashback."
          primary={{ href: "/travel", label: "Search stays" }}
          secondary={{ href: "/solutions/travel-agencies", label: "For agencies" }}
        />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Cashback figures are illustrative in this preview.
        </p>
      </main>
    </div>
  );
}
