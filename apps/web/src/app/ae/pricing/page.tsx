import type { Metadata } from "next";
import Link from "next/link";
import MarketingBar from "@/components/marketing/MarketingBar";
import FaqSection from "@/components/marketing/FaqSection";
import { VaraRiskNote, VaraStatusNote } from "@/components/marketing/AeCompliance";

export const metadata: Metadata = {
  title: "Furlpay Pricing UAE (AED) — 0.5% per Transaction",
  description:
    "Transparent UAE pricing in AED. Merchant payments at a flat 0.5% per transaction, a free consumer tier, and a custom enterprise plan with volume rates and an SLA.",
  alternates: {
    canonical: "/ae/pricing",
    languages: { "en-US": "/pricing", "en-GB": "/uk/pricing", "en-AE": "/ae/pricing", "en-JP": "/jp/pricing", "x-default": "/pricing" },
  },
};

const TIERS = [
  { name: "Standard", price: "AED 0", tagline: "For everyday spending", feats: ["1% stablecoin cashback", "Yield on idle USDC/EURC", "Virtual stablecoin card", "Local multi-currency account", "Fractional investing"] },
  { name: "Pro", price: "AED 35", tagline: "For power users", feats: ["2% cashback (fair-use cap)", "Higher yield on balances", "Metal physical card", "Higher limits & priority FX"], highlight: true },
  { name: "Ultra", price: "AED 109", tagline: "For builders & teams", feats: ["3% cashback + top yield", "Portfolio-backed credit line", "Full API + webhooks", "Dedicated MPC policy · 24/7 support"] },
];

const FAQ = [
  { q: "What does Furlpay charge UAE merchants?", a: "Merchant payments are a flat 0.5% per transaction settled in USDC on Arbitrum, with no monthly or setup fee. That is roughly 80–85% cheaper than the 2.9–3.5% typical of card processing." },
  { q: "Is the pricing really in AED?", a: "Consumer plans are shown in dirhams. Merchant settlement is in USDC, which you can convert to AED or hold as a dollar-stable balance. The UAE also has a regulated dirham stablecoin (DDSC)." },
  { q: "Is there volume pricing for businesses?", a: "Yes. At higher volume the Enterprise plan offers custom rates below 0.5%, a settlement and uptime SLA, a dedicated account manager, per-transaction audit trails, and reconciliation exports. Contact sales for a quote." },
  { q: "Is Furlpay licensed by VARA?", a: "No. Offering virtual asset services in or from Dubai requires a VARA licence; Furlpay is not currently VARA-licensed and is evaluating licensing. Virtual assets carry risk and can lose value." },
];

export default function AePricingPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar active="pricing" />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <div className="text-center">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">UAE Pricing</p>
          <h1 className="mx-auto max-w-2xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
            Priced in dirhams. 0.5% to accept.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-textSecondary">
            A flat 0.5% per transaction for merchants, a genuinely useful free consumer tier, and a
            custom enterprise plan — shown in AED.
          </p>
        </div>

        <div className="mx-auto mt-6 max-w-2xl">
          <VaraRiskNote />
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <div key={t.name} className={`glass-card p-7 ${t.highlight ? "border-neon/30 shadow-glow" : ""}`}>
              <div className="flex items-center justify-between">
                <p className="text-[17px] font-bold">{t.name}</p>
                {t.highlight && <span className="rounded-full bg-neon px-2.5 py-0.5 text-[10px] font-bold text-black">POPULAR</span>}
              </div>
              <p className="mt-3 text-[32px] font-extrabold tracking-tighter">
                {t.price}
                <span className="text-[14px] font-medium text-textSecondary">/mo</span>
              </p>
              <p className="mb-5 text-[13px] text-textSecondary">{t.tagline}</p>
              <ul className="space-y-2 text-[13px] text-textSecondary">
                {t.feats.map((f) => (
                  <li key={f} className="flex items-start gap-2"><span className="mt-0.5 text-neon">✓</span> {f}</li>
                ))}
              </ul>
              <Link href="/signup" className={`mt-6 block rounded-pill py-2.5 text-center text-sm font-semibold ${t.highlight ? "btn-green" : "btn-outline"}`}>
                Get started
              </Link>
            </div>
          ))}
        </div>

        {/* Enterprise band */}
        <section className="mx-auto mt-16 max-w-5xl">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 sm:p-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-xl">
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Enterprise</p>
                <h2 className="mt-2 text-[28px] font-bold tracking-tighter">Custom pricing for UAE volume.</h2>
                <p className="mt-3 text-[15px] leading-relaxed text-textSecondary">
                  For Dubai hotels, airlines, marketplaces and platforms settling stablecoins at
                  scale. Rates below 0.5%, a defined SLA, and the controls procurement and security
                  teams ask for.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/talk-to-us" className="btn-green px-6 py-3 text-[15px]">Contact sales</Link>
                  <Link href="/resources/tools/fee-calculator" className="btn-outline px-6 py-3 text-[15px]">Calculate savings</Link>
                </div>
              </div>
              <ul className="grid gap-3 text-[14px] text-textSecondary sm:grid-cols-2 lg:w-[46%]">
                {["Volume rates below 0.5% per transaction", "Uptime & settlement SLA (defined per contract)", "Dedicated account manager · priority support", "Per-transaction audit trail & signed receipts", "Reconciliation exports (CSV / ISO 20022)", "Sanctions screening, Travel Rule & jurisdiction controls"].map((f) => (
                  <li key={f} className="flex items-start gap-2"><span className="mt-0.5 text-neon">✓</span> {f}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <FaqSection items={FAQ} title="Questions" />

        <VaraStatusNote />
      </main>
    </div>
  );
}
