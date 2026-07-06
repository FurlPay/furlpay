import type { Metadata } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import FeeCalculator from "@/components/marketing/FeeCalculator";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { webApplication, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/resources/tools/fee-calculator`;

export const metadata: Metadata = {
  title: "Crypto Payment Fee Savings Calculator — Card vs USDC",
  description:
    "Calculate how much your business saves by accepting USDC on Arbitrum (0.5%) instead of credit cards (2.9–3.5%). Free interactive calculator — enter your monthly volume.",
  alternates: { canonical: "/resources/tools/fee-calculator" },
  openGraph: {
    type: "website",
    url: URL,
    title: "Crypto Payment Fee Savings Calculator",
    description:
      "See your annual savings switching from card fees to USDC stablecoin payments on Arbitrum.",
  },
};

const FAQ = [
  {
    q: "How much cheaper are stablecoin payments than credit cards?",
    a: "Stablecoin payments on Furlpay cost 0.5% per transaction versus 2.9–3.5% for credit cards — roughly 80–85% cheaper. A business processing $1,000,000 a year pays about $5,000 with Furlpay versus $29,000–$35,000 on card rails, saving $24,000–$30,000 annually.",
  },
  {
    q: "What fees does Furlpay charge?",
    a: "Furlpay charges a flat 0.5% per transaction with no monthly fee, setup fee, or per-transaction surcharge. The only additional cost is Arbitrum network gas, typically $0.001–$0.005 per payment.",
  },
  {
    q: "Are the calculator's figures accurate?",
    a: "The card figures use typical published rates (Stripe 2.9% + 30¢, or a 3.5% blended card rate) and are estimates — real card pricing varies by issuer, card type, and merchant category. Furlpay's 0.5% is live; you can verify a quote at /api/payments/fees/estimate.",
  },
  {
    q: "Do I need to hold crypto to accept USDC payments?",
    a: "No. Customers pay in USDC, and you can settle the balance to a local bank account or hold it as a dollar-pegged stablecoin. Furlpay uses passkey-secured wallets, so there is no seed phrase to manage.",
  },
];

export default function FeeCalculatorPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <JsonLd
        data={[
          webApplication({
            name: "Furlpay Fee Savings Calculator",
            description:
              "Compare credit-card processing fees against USDC stablecoin payments on Arbitrum.",
            url: URL,
          }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Resources", path: "/resources" },
            { name: "Tools", path: "/resources/tools/fee-calculator" },
            { name: "Fee Calculator", path: "/resources/tools/fee-calculator" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Free tool
        </p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Crypto payment fee savings calculator
        </h1>

        {/* Atomic answer — the 50-word block AI Overviews extract. */}
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Stablecoin payments on Furlpay cost <strong className="text-white">0.5%</strong> per
          transaction versus <strong className="text-white">2.9–3.5%</strong> for credit cards. A
          business processing $1M a year saves roughly{" "}
          <strong className="text-neon">$24,000–$30,000</strong> by accepting USDC on Arbitrum.
          Enter your volume below to see your number.
        </p>

        <div className="mt-10">
          <FeeCalculator />
        </div>

        <section className="mt-16">
          <h2 className="text-[24px] font-bold tracking-tighter">How the math works</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-textSecondary">
            Card networks charge a percentage (interchange + assessments + processor margin) plus a
            fixed per-transaction fee. Furlpay replaces that stack with a direct on-chain USDC
            transfer on Arbitrum One (Chain ID 42161), settling in under a second for a flat 0.5%.
            There is no interchange, no chargeback reserve, and no monthly minimum.
          </p>
        </section>

        <FaqSection items={FAQ} />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Figures are illustrative estimates and not a guarantee of savings.
        </p>
      </main>
    </div>
  );
}
