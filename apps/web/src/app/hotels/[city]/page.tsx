import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import JsonLd from "@/components/JsonLd";
import { breadcrumb, SITE } from "@/lib/seo/schema";
import { CITIES, getCity } from "@/lib/cities";

// Only the known city slugs are valid pages — any other slug returns a real 404
// rather than rendering an empty/duplicate page (avoids thin doorway pages).
export const dynamicParams = false;

export function generateStaticParams() {
  return CITIES.map((c) => ({ city: c.slug }));
}

export async function generateMetadata(props: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const params = await props.params;
  const c = getCity(params.city);
  if (!c) return {};
  return {
    title: `Pay for Hotels with Crypto in ${c.name} — Accept USDC (0.5%)`,
    description: `How to accept and pay for hotels with crypto in ${c.name}. USDC on Arbitrum at 0.5% instead of 2.9–3.5% card fees — no FX on international guests, no chargebacks, instant settlement.`,
    alternates: { canonical: `/hotels/${c.slug}` },
    openGraph: { type: "website", url: `${SITE}/hotels/${c.slug}`, title: `Crypto Hotel Payments in ${c.name}` },
  };
}

export default async function CityHotelsPage(props: { params: Promise<{ city: string }> }) {
  const params = await props.params;
  const c = getCity(params.city);
  if (!c) notFound();

  const FAQ = [
    {
      q: `Can I pay for a hotel with crypto in ${c.name}?`,
      a: `Yes. Hotels in ${c.name} that use Furlpay let you pay in USDC on Arbitrum — dollar-stable digital currency — from a passkey wallet. The payment settles in about a second and the hotel receives a signed receipt. ${c.context}`,
    },
    {
      q: `How do ${c.name} hotels benefit from accepting USDC?`,
      a: `A ${c.name} hotel accepting USDC pays a flat 0.5% instead of 2.9–3.5% on cards, with no FX on international guests and no chargebacks. ${c.angle}`,
    },
    {
      q: `Is it cheaper than paying by card in ${c.name}?`,
      a: `For the hotel, yes — 0.5% versus 2.9–3.5% is roughly an 80–85% saving on processing, plus no chargeback or FX costs. Guests pay the quoted rate in dollar-stable USDC with no card foreign-transaction fee.`,
    },
  ];

  const FEATURES = [
    { title: "0.5%, not 3.5%", body: `Hotels in ${c.name} keep more of every booking — a flat 0.5% versus card interchange of 2.9–3.5%.` },
    { title: "No FX for guests", body: `USDC is dollar-stable, so international visitors to ${c.name} avoid card foreign-transaction and conversion fees.` },
    { title: "Instant settlement", body: "Funds finalise on Arbitrum in about a second, not two to four days, with no rolling reserve." },
    { title: "No chargebacks", body: "On-chain payments are final — no no-show or friendly-fraud chargebacks or dispute fees." },
    { title: "Runs beside the PMS", body: "An API and hosted checkout added alongside the property's existing system — no rip-and-replace." },
    { title: "On-chain receipts", body: "Every booking returns a verifiable receipt, useful for expenses and reconciliation." },
  ];

  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Hotels", path: "/hotels" },
          { name: c.name, path: `/hotels/${c.slug}` },
        ])}
      />
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow={`Crypto hotels · ${c.name}`}
          title={`Pay for hotels with crypto in ${c.name}.`}
          subtitle={`Book and pay in dollar-stable USDC on Arbitrum. For ${c.name} hotels, that means a flat 0.5% instead of 2.9–3.5% card fees, no FX on international guests, and no chargebacks — settled in about a second.`}
          primary={{ href: "/talk-to-us", label: "Request a demo" }}
          secondary={{ href: c.hotelsHref, label: "For hotels" }}
        />

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          {c.context} With Furlpay, {c.name} hotels accept <strong className="text-white">USDC on
          Arbitrum</strong> for a flat <strong className="text-white">0.5%</strong> — an alternative
          to card interchange, with no chargebacks and instant settlement.
        </p>

        <Section title={`Why it works for ${c.name} hotels`}>
          <FeatureGrid items={FEATURES} />
        </Section>

        <Section title="Model the savings">
          <FeeCalculator />
        </Section>

        <FaqSection items={FAQ} />

        <Section title="Explore more">
          <div className="flex flex-wrap gap-3 text-[14px]">
            <Link href={c.hotelsHref} className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Hotels solution</Link>
            <Link href="/products/payments" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">How payments work</Link>
            <Link href="/resources/tools/fee-calculator" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">Fee calculator</Link>
            <Link href="/hotels" className="rounded-full border border-white/10 px-4 py-2 hover:border-neon/30 hover:text-neon">All cities</Link>
          </div>
        </Section>

        <CtaBand
          title={`Bring USDC payments to your ${c.name} hotel`}
          subtitle="Request a demo or model your savings first."
          primary={{ href: "/talk-to-us", label: "Request a demo" }}
          secondary={{ href: c.hotelsHref, label: "Hotel features" }}
        />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Fee figures are typical published card rates and vary by issuer,
          category, and geography. Crypto assets can lose value.
        </p>
      </main>
    </div>
  );
}
