import type { Metadata } from "next";
import PricingCards from "@/components/marketing/PricingCards";
import MarketingBar from "@/components/marketing/MarketingBar";

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

        <section className="mx-auto mt-20 max-w-2xl">
          <h2 className="mb-6 text-center text-[24px] font-bold tracking-tighter">Questions</h2>
          <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/10">
            {FAQ.map((f) => (
              <div key={f.q} className="p-5">
                <p className="font-semibold">{f.q}</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Crypto assets are not covered by FDIC/FSCS deposit insurance and can
          lose value. Cashback and APY figures are illustrative in this preview.
        </p>
      </main>
    </div>
  );
}

