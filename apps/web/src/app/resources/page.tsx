import type { Metadata } from "next";
import Link from "next/link";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero } from "@/components/marketing/blocks";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Resources — Guides, Tools & Insights for Stablecoin Payments",
  description:
    "Furlpay resources: interactive tools like the fee savings calculator, the blog on stablecoin payments and Arbitrum, developer docs, and market insights.",
  alternates: { canonical: "/resources" },
};

const CARDS = [
  { title: "Fee savings calculator", body: "See how much your business saves switching from card fees to USDC on Arbitrum.", href: "/resources/tools/fee-calculator" },
  { title: "Blog", body: "Stablecoin payments, Arbitrum, AI payments, and crypto travel — explained.", href: "/blog" },
  { title: "Developer docs", body: "API reference, quickstart, SDKs, and integration guides.", href: "/docs" },
  { title: "Market insights", body: "In-house research and explainers across markets and crypto.", href: "/investing/insights" },
  { title: "Changelog", body: "What's new across the API and product.", href: "/changelog" },
  { title: "Compare", body: "How Furlpay stacks up against BitPay, Coinbase Commerce, Travala, and Stripe.", href: "/compare/bitpay" },
];

export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Resources", path: "/resources" },
        ])}
      />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Resources"
          title="Tools, guides, and insights."
          subtitle="Everything to help you evaluate, integrate, and get more from stablecoin payments — from an interactive fee calculator to deep-dive guides."
          primary={{ href: "/resources/tools/fee-calculator", label: "Try the calculator" }}
          secondary={{ href: "/blog", label: "Read the blog" }}
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <Link key={c.href} href={c.href} className="glass-card p-6 transition-colors hover:border-neon/30">
              <h2 className="text-[16px] font-bold">{c.title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{c.body}</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
