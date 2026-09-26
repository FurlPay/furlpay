import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { seoMetadata } from "@/lib/seo/meta";

export const metadata: Metadata = seoMetadata({
  title: "Compare Furlpay — vs OTAs, Hotels & Payment Processors (2026)",
  description:
    "How Furlpay compares to Trip.com, Booking.com, Expedia, Airbnb, GetYourGuide, Travala, Stripe, Coinbase Commerce, BitPay and RedotPay — pay for travel in USDC, on-chain, with a single-use Visa card and up to 10% creator payouts.",
  path: "/compare",
});

const GROUPS: { label: string; items: { slug: string; name: string; blurb: string }[] }[] = [
  {
    label: "Travel & OTAs",
    items: [
      { slug: "trip-com", name: "Trip.com", blurb: "Both take stablecoins — Furlpay adds on-chain settlement, agentic booking and creator payouts." },
      { slug: "booking-com", name: "Booking.com", blurb: "Book comparable stays and pay in USDC, with a single-use Visa card for card-only properties." },
      { slug: "expedia", name: "Expedia", blurb: "Pay for flights, hotels and packages in USDC with on-chain receipts." },
      { slug: "airbnb", name: "Airbnb", blurb: "Pay for an Airbnb with USDC via a single-use, MCC-locked Visa virtual card." },
      { slug: "getyourguide", name: "GetYourGuide", blurb: "Creator payouts up to 10% in USDC weekly vs a fiat affiliate baseline." },
      { slug: "travala", name: "Travala", blurb: "Dollar-stable USDC settlement with on-chain receipts and AI trip planning." },
    ],
  },
  {
    label: "Payment processors",
    items: [
      { slug: "stripe", name: "Stripe", blurb: "Accept USDC at 0.5% with on-chain settlement and no chargebacks." },
      { slug: "coinbase-commerce", name: "Coinbase Commerce", blurb: "Lower fees, agentic x402 APIs, and payments plus travel in one platform." },
      { slug: "bitpay", name: "BitPay", blurb: "Stablecoin-native settlement without invoice expiry friction." },
      { slug: "redotpay", name: "RedotPay", blurb: "Open source, AI-native, on-device mobile keys — with investing still in development." },
      { slug: "gnosis-pay", name: "Gnosis Pay", blurb: "Same self-custody, multi-chain liquidity plus travel escrows and AI payments." },
    ],
  },
];

export default function CompareIndexPage() {
  const ALL = GROUPS.flatMap((g) => g.items);
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Compare", path: "/compare" },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: ALL.map((it, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `Furlpay vs ${it.name}`,
            url: `https://furlpay.com/compare/${it.slug}`,
          })),
        }}
      />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-neon">Compare</p>
        <h1 className="mt-3 text-[34px] font-extrabold leading-tight tracking-tighter sm:text-[44px]">
          How Furlpay compares
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-textSecondary">
          Honest, sourced comparisons against the travel platforms and payment processors people ask about —
          how Furlpay pays for travel in USDC on-chain, bridges card-only merchants with a single-use Visa
          card, and pays creators up to 10% weekly.
        </p>

        {GROUPS.map((g) => (
          <section key={g.label} className="mt-12">
            <h2 className="text-[20px] font-bold tracking-tight">{g.label}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {g.items.map((it) => (
                <Link
                  key={it.slug}
                  href={`/compare/${it.slug}`}
                  className="group glass-card flex flex-col p-6 transition-colors hover:border-neon/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[17px] font-bold">Furlpay vs {it.name}</span>
                    <ArrowRight className="h-4 w-4 text-textMuted transition-colors group-hover:text-neon" />
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">{it.blurb}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <p className="mt-12 text-center text-[13px] text-textSecondary">
          Looking for your industry instead? See{" "}
          <Link href="/solutions/hotels" className="text-neon underline underline-offset-2">solutions</Link> or{" "}
          <Link href="/products" className="text-neon underline underline-offset-2">products</Link>.
        </p>
      </main>
    </div>
  );
}
