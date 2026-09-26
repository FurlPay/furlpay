import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { financialProduct, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/products/travel`;

export const metadata: Metadata = {
  // Retitled 22 Sep 2026. POST /api/travel/search returns
  // source:"unavailable", reason:"no_live_provider" in production — the
  // inventory credential is a test token and the code correctly refuses to
  // serve sandbox offers as real ones. So the page may advertise hotel
  // DISCOVERY, which works, and must not advertise BOOKING, which does not.
  title: "Travel — Live Hotel Discovery, USDC Booking In Development",
  description:
    "Explore hotels worldwide on a live map in Furlpay. Booking and paying in USDC on Arbitrum, with on-chain receipts and cashback, is in development.",
  alternates: { canonical: "/products/travel" },
  openGraph: { type: "website", url: URL, title: "Travel on Furlpay — Live Hotel Discovery" },
};

const FEATURES = [
  { title: "Live hotel map", body: "Explore hotels and apartments worldwide on a live map with real positions, ratings and photos. Available now." },
  { title: "No seed phrase", body: "A passkey-secured wallet — the same account you use everywhere else on Furlpay. Available now." },
  { title: "USDC booking — in development", body: "Paying for a stay or a flight in USDC with no card FX markup or dynamic-currency-conversion games. The live inventory provider is not yet connected in production." },
  { title: "On-chain receipts — in development", body: "A booking settling on Arbitrum and returning an Arbiscan-linked receipt for expense reports and reimbursements." },
  { title: "Crypto cashback — in development", body: "USDC rewards on eligible bookings, paid to your balance." },
  { title: "AI trip planning — in development", body: "Describing a trip in plain language and letting an agent assemble and book the itinerary, paying over x402." },
];

const FAQ = [
  {
    q: "Can I book hotels and flights with crypto?",
    a: "Not yet. You can explore hotels worldwide on the live map today, but booking is in development — the production inventory provider is not connected, and Furlpay refuses to show sandbox offers as if they were real availability. Paying in USDC on Arbitrum with an on-chain receipt is how it will work when it opens.",
  },
  {
    q: "How is paying with USDC cheaper than a card abroad?",
    a: "Card payments abroad add foreign-transaction fees (often 1–3%) and unfavorable FX conversion. USDC is dollar-pegged and settles directly, so there is no FX markup or per-transaction travel surcharge.",
  },
  {
    q: "Do I get a receipt for expenses?",
    a: "That is the design: a booking will return a signed receipt linked to Arbiscan so the payment is independently verifiable, which is useful for reimbursements, accounting and tax records. It ships with booking, which is still in development.",
  },
  {
    q: "What is AI trip planning?",
    a: "The planned flow where you describe a trip in plain language and an AI agent assembles an itinerary and books it, paying for each resource over x402. It depends on two things still in development — travel booking and x402 settlement — so it is not available today.",
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
            description: "Live hotel discovery worldwide. USDC booking with on-chain receipts is in development.",
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
          title="Explore the world's hotels on a live map."
          subtitle="Real positions, ratings and photos for hotels worldwide — available today. Booking and paying in USDC on Arbitrum, with on-chain receipts and cashback, is in development."
          primary={{ href: "/hotels/map", label: "Open the hotel map" }}
          secondary={{ href: "/travel/crypto-travel", label: "Crypto travel guide" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-5 text-[15px] leading-relaxed text-textSecondary">
          <strong className="text-amber-300">Booking is in development.</strong> Hotel discovery is
          live — open the map and every property you see is real. Paying for a stay or flight in{" "}
          <strong className="text-white">USDC on Arbitrum</strong>, with an on-chain receipt and
          cashback, is being built and is not yet available to book.
        </p>

        <Section title="Why book with Furlpay">
          <FeatureGrid items={FEATURES} />
        </Section>

        <FaqSection items={FAQ} />

        <CtaBand
          title="Start with the map"
          subtitle="Live hotel discovery worldwide. Booking opens when the inventory provider goes live."
          primary={{ href: "/hotels/map", label: "Open the hotel map" }}
          secondary={{ href: "/solutions/travel-agencies", label: "For agencies" }}
        />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Cashback figures are illustrative in this preview.
        </p>
      </main>
    </div>
  );
}
