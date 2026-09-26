import type { Metadata } from "next";
import Link from "next/link";
import PricingCards from "@/components/marketing/PricingCards";
import LandingChrome from "@/components/landing/LandingChrome";
import FaqSection from "@/components/marketing/FaqSection";
import SupportBitcoin from "@/components/marketing/SupportBitcoin";
import PlansInDevelopmentNotice from "@/components/marketing/PlansInDevelopmentNotice";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Furlpay pricing: the developer platform is free and open source, and merchant payments are priced at a flat 0.5%. Consumer plans with cards, cashback, yield and investing are in development.",
  keywords: [
    "Furlpay pricing",
    "stablecoin card pricing",
    "USDC payment fees",
    "0.5% merchant fees",
    "support open source with Bitcoin",
    "donate Bitcoin to open source",
    "Bitcoin donation address",
    "crypto payment platform pricing",
  ],
  alternates: {
    canonical: "/pricing",
    languages: { "en-US": "/pricing", "en-GB": "/uk/pricing", "en-AE": "/ae/pricing", "en-JP": "/jp/pricing", "x-default": "/pricing" },
  },
};

const FAQ = [
  {
    q: "Is there really a free tier?",
    a: "Yes — and today it is the only tier. The web app, passkey wallet, SDKs, CLI, MCP server and x402 middleware are free with no card required. The Standard consumer plan adds a virtual stablecoin card, 1% cashback, yield on idle balances, a local USD/EUR account and stock investing; all five are in development and none can be opened yet.",
  },
  {
    q: "How does cashback work?",
    a: "It will be paid in USDC on eligible card spend — 1% on Standard, 2% on Pro (up to $10k/mo) and 3% on Ultra, settling to your balance. Cashback depends on the card program, which has not launched, so no cashback is being earned today.",
  },
  {
    q: "Where does the yield come from?",
    a: "The design routes reserves into low-risk tokenized T-bills and audited lending vaults and passes the yield through, with no lock-up. Yield on idle balances is in development and is not being paid today.",
  },
  {
    q: "What's the portfolio-backed credit line?",
    a: "A planned Ultra feature: borrowing against stocks and crypto without selling, paying interest only on what you draw. It is not available — the risk engine that prices liquidation is not built, and lending against collateral without one would be unsafe.",
  },
  {
    q: "Do developers pay for the API?",
    a: "No. The SDKs, CLI, MCP server and x402 middleware are open source and free, and the hosted API is free to integrate against today. Usage-based metering is planned for when settlement volume goes live.",
  },
  {
    q: "Is there volume pricing for businesses?",
    a: "Merchant payments are priced at a flat 0.5% per transaction, and at higher volume the Enterprise plan offers custom rates below 0.5%, a settlement and uptime SLA, a dedicated account manager, and per-transaction audit trails with reconciliation exports. Merchant settlement is in development, so contact sales to plan an integration rather than to start taking volume today.",
  },
  {
    q: "Can I support FurlPay with Bitcoin?",
    a: "Yes. FurlPay is open source and free to start, and you can donate on-chain in Bitcoin from the pricing page — scan the QR code or copy the bech32 address. It is a donation rather than a subscription: it does not buy or upgrade a plan.",
  },
  {
    q: "Does FurlPay accept Bitcoin as payment for its plans?",
    a: "No. FurlPay's own plans and merchant settlement are priced and settled in USDC — Standard is free, and merchant payments are a flat 0.5% per transaction. The Bitcoin address on this page is for voluntary donations to support the project, not a way to pay for a plan.",
  },
  {
    q: "Do you offer an SLA and compliance controls for enterprise?",
    a: "Enterprise contracts include a defined uptime and settlement SLA, sanctions screening and Travel Rule support on every payment, jurisdiction and KYC-tier controls, and reconciliation files. Formal certifications such as SOC 2 are on our compliance roadmap — see the trust center for current status.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        <div className="text-center">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Pricing</p>
          <h1 className="mx-auto max-w-2xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
            Earn more than you pay.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-textSecondary">
            No hidden FX games, no locked cashback. The developer platform is free and open
            source today; the consumer tiers below are what we are building toward.
          </p>
        </div>

        <PlansInDevelopmentNotice className="mx-auto mt-10 max-w-3xl" />

        <div className="mt-8">
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

        <SupportBitcoin />

        <FaqSection items={FAQ} title="Questions" />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Crypto assets are not covered by FDIC/FSCS deposit insurance and can
          lose value. Cashback and APY figures are illustrative in this preview.
        </p>
      </main>
    </div>
  );
}

