import type { Metadata } from "next";
import Link from "next/link";
import PricingCards from "@/components/marketing/PricingCards";
import MarketingBar from "@/components/marketing/MarketingBar";
import FaqSection from "@/components/marketing/FaqSection";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for Furlpay — stablecoin cards, cashback up to 3%, yield up to 8% APY, fractional investing, and a full developer API.",
  alternates: { canonical: "/pricing" },
};

const FAQ = [
  {
    q: "Is there really a free tier?",
    a: "Yes. Standard is $0/mo with a virtual stablecoin card, 1% cashback, up to 4% APY on idle balances, a local USD/EUR account, and fractional investing.",
  },
  {
    q: "How does cashback work?",
    a: "Cashback is paid in USDC on eligible card spend — 1% on Standard, 2% on Pro (up to $10k/mo), and 3% on Ultra. It settles to your balance, withdrawable to fiat or crypto.",
  },
  {
    q: "Where does the yield come from?",
    a: "We route reserves into low-risk tokenized T-bills and audited lending vaults and pass the yield through to you. No lock-up — withdraw anytime.",
  },
  {
    q: "What's the portfolio-backed credit line?",
    a: "On Ultra, borrow against your stocks and crypto without selling — interest only on what you draw. Keep your upside and avoid a taxable event.",
  },
  {
    q: "Do developers pay for the API?",
    a: "The SDKs, CLI, MCP server, and x402 middleware are open-source and free. The hosted API is metered — a free sandbox, then usage-based pricing on Ultra.",
  },
  {
    q: "Is there volume pricing for businesses?",
    a: "Yes. Merchant payments are a flat 0.5% per transaction, and at higher volume the Enterprise plan offers custom rates below 0.5%, a settlement and uptime SLA, a dedicated account manager, and per-transaction audit trails with reconciliation exports. Contact sales for a quote.",
  },
  {
    q: "Do you offer an SLA and compliance controls for enterprise?",
    a: "Enterprise contracts include a defined uptime and settlement SLA, sanctions screening and Travel Rule support on every payment, jurisdiction and KYC-tier controls, and reconciliation files. Formal certifications such as SOC 2 are on our compliance roadmap — see the trust center for current status.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar active="pricing" />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <div className="text-center">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Pricing</p>
          <h1 className="mx-auto max-w-2xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
            Earn more than you pay.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-textSecondary">
            No hidden FX games, no locked cashback. Cards, yield, investing, and a full developer
            platform — priced so the free tier is genuinely useful.
          </p>
        </div>

        <div className="mt-12">
          <PricingCards />
        </div>

        {/* Enterprise band — custom volume pricing + SLA for high-volume merchants. */}
        <section className="mx-auto mt-16 max-w-5xl">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 sm:p-10">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-xl">
                <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Enterprise</p>
                <h2 className="mt-2 text-[28px] font-bold tracking-tighter">Custom pricing for high volume.</h2>
                <p className="mt-3 text-[15px] leading-relaxed text-textSecondary">
                  For hotels, airlines, marketplaces, and platforms settling stablecoins at scale.
                  Rates below 0.5%, a defined SLA, and the controls procurement and security teams
                  ask for.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/talk-to-us" className="btn-green px-6 py-3 text-[15px]">Contact sales</Link>
                  <Link href="/resources/tools/fee-calculator" className="btn-outline px-6 py-3 text-[15px]">
                    Calculate savings
                  </Link>
                </div>
              </div>
              <ul className="grid gap-3 text-[14px] text-textSecondary sm:grid-cols-2 lg:w-[46%]">
                {[
                  "Volume rates below 0.5% per transaction",
                  "Uptime & settlement SLA (defined per contract)",
                  "Dedicated account manager · priority support",
                  "Per-transaction audit trail & signed receipts",
                  "Reconciliation exports (CSV / ISO 20022)",
                  "Sanctions screening, Travel Rule & jurisdiction controls",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-neon">✓</span> {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <FaqSection items={FAQ} title="Questions" />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Crypto assets are not covered by FDIC/FSCS deposit insurance and can
          lose value. Cashback and APY figures are illustrative in this preview.
        </p>
      </main>
    </div>
  );
}

