import type { Metadata } from "next";
import Link from "next/link";
import MarketingBar from "@/components/marketing/MarketingBar";
import { Hero } from "@/components/marketing/blocks";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Free Tools — Fee Calculator & More | Furlpay",
  description:
    "Free interactive tools from Furlpay: calculate your savings from switching card fees to USDC stablecoin payments on Arbitrum, and more coming soon.",
  alternates: { canonical: "/resources/tools" },
};

const TOOLS = [
  { title: "Fee savings calculator", body: "Compare card processing fees against USDC on Arbitrum and see your annual savings.", href: "/resources/tools/fee-calculator", live: true },
  { title: "Gas cost estimator", body: "Estimate Arbitrum gas costs versus Ethereum and Base for a payment.", href: "#", live: false },
  { title: "Stablecoin comparison", body: "Compare USDC, USDT, EURC, and DAI across chains.", href: "#", live: false },
];

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Resources", path: "/resources" },
          { name: "Tools", path: "/resources/tools" },
        ])}
      />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Free tools"
          title="Interactive tools."
          subtitle="Free calculators and comparisons to help you evaluate stablecoin payments — no signup required."
          primary={{ href: "/resources/tools/fee-calculator", label: "Fee calculator" }}
        />
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) =>
            t.live ? (
              <Link key={t.title} href={t.href} className="glass-card p-6 transition-colors hover:border-neon/30">
                <h2 className="text-[16px] font-bold">{t.title}</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{t.body}</p>
                <span className="mt-3 inline-block text-[13px] text-neon">Open →</span>
              </Link>
            ) : (
              <div key={t.title} className="glass-card p-6 opacity-60">
                <div className="flex items-center justify-between">
                  <h2 className="text-[16px] font-bold">{t.title}</h2>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-textMuted">Soon</span>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{t.body}</p>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}
