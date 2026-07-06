import type { Metadata } from "next";
import Link from "next/link";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero, CtaBand } from "@/components/marketing/blocks";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import { CITIES } from "@/lib/cities";

export const metadata: Metadata = {
  title: "Pay for Hotels with Crypto — City Guides | Furlpay",
  description:
    "City-by-city guides to paying for and accepting hotel payments in crypto (USDC on Arbitrum) — Miami, New York, London, Dubai and more. 0.5% fees, no chargebacks.",
  alternates: { canonical: "/hotels" },
};

export default function HotelsIndexPage() {
  const byCountry = CITIES.reduce<Record<string, typeof CITIES>>((acc, c) => {
    (acc[c.country] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Hotels", path: "/hotels" },
        ])}
      />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Crypto hotels"
          title="Pay for hotels with crypto, city by city."
          subtitle="Guides to accepting and paying for hotels in USDC on Arbitrum — a flat 0.5%, no FX on international guests, and no chargebacks. Pick your city."
          primary={{ href: "/solutions/hotels", label: "For hotels" }}
          secondary={{ href: "/resources/tools/fee-calculator", label: "Fee calculator" }}
        />

        {Object.entries(byCountry).map(([country, cities]) => (
          <div key={country} className="mt-12">
            <h2 className="mb-4 text-[14px] font-semibold uppercase tracking-wider text-textMuted">{country}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cities.map((c) => (
                <Link key={c.slug} href={`/hotels/${c.slug}`} className="glass-card p-5 transition-colors hover:border-neon/30">
                  <h3 className="text-[16px] font-bold">{c.name}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">{c.angle}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <CtaBand title="Accept USDC at your hotel" secondary={{ href: "/solutions/hotels", label: "Hotel features" }} />
      </main>
    </div>
  );
}
