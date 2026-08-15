import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import RoiCalculator from "@/components/marketing/RoiCalculator";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { webApplication, breadcrumb, SITE } from "@/lib/seo/schema";

const URL = `${SITE}/resources/tools/roi-calculator`;

export const metadata: Metadata = {
  title: "Stablecoin Payments ROI Calculator — Card vs USDC Savings",
  description:
    "Calculate your annual ROI from switching to USDC payments: fee savings, chargeback elimination, and faster settlement. Factors in your international customer mix. Free tool.",
  alternates: { canonical: "/resources/tools/roi-calculator" },
};

const FAQ = [
  {
    q: "How much can a business save by switching to stablecoin payments?",
    a: "It depends on volume and international mix, but moving from ~2.9–3.5% cards to a flat 0.5% typically saves 80–85% on fees, plus eliminating chargebacks (often ~0.5–1% of volume). A business doing $500,000 a year with a large international share commonly saves $15,000–$25,000 annually.",
  },
  {
    q: "Why does the international customer mix matter?",
    a: "Cards charge extra cross-border and foreign-exchange fees on international customers — often another 1–1.5% on top of base rates. USDC is dollar-stable and borderless, so it removes that surcharge entirely, which is why savings rise with your international share.",
  },
  {
    q: "How does eliminating chargebacks add to ROI?",
    a: "On-chain USDC payments are final, so there are no chargebacks or dispute fees. For businesses with meaningful dispute rates, the avoided chargeback cost can rival the fee savings itself.",
  },
];

export default function RoiCalculatorPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={[
          webApplication({ name: "Furlpay Stablecoin ROI Calculator", description: "Calculate annual ROI from switching card payments to USDC on Arbitrum.", url: URL }),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Resources", path: "/resources" },
            { name: "Tools", path: "/resources/tools" },
            { name: "ROI Calculator", path: "/resources/tools/roi-calculator" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Free tool</p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Stablecoin payments ROI calculator
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          See your full annual return from switching to USDC — not just the fee saving, but the
          chargebacks you avoid and the settlement time you gain. Enter your volume, average ticket,
          and how much of your business is international.
        </p>
        <div className="mt-10">
          <RoiCalculator />
        </div>
        <FaqSection items={FAQ} />
        <p className="mt-10 text-center text-[11px] text-textMuted">
          Furlpay is not a bank. Figures are illustrative estimates and not a guarantee of savings.
        </p>
      </main>
    </div>
  );
}
