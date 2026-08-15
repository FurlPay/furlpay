import Link from "next/link";
import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Furlpay vs Gnosis Pay — Self-Custodial Card Comparison",
  description:
    "Gnosis Pay pioneered self-custodial cards on Safe. Furlpay keeps the self-custody and adds multi-chain liquidity, travel booking escrows, x402 AI-agent payments, and EIP-6963 wallet discovery. Full breakdown.",
  alternates: { canonical: "/compare/gnosis-pay" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/compare/gnosis-pay",
    siteName: "Furlpay",
    title: "Furlpay vs Gnosis Pay — Self-Custodial Card Comparison",
    description:
      "Gnosis Pay pioneered self-custodial cards on Safe. Furlpay keeps the self-custody and adds multi-chain liquidity, travel escrows, and AI-agent payments.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay vs Gnosis Pay — Self-Custodial Card Comparison",
    description:
      "Gnosis Pay pioneered self-custodial cards on Safe. Furlpay keeps the self-custody and adds multi-chain liquidity, travel escrows, and AI-agent payments.",
    images: ["/og.png"],
  },
};

const ROWS: { feature: string; furlpay: string; gnosispay: string; furlpayWins: boolean }[] = [
  { feature: "Custody Model", furlpay: "Safe + 2-of-2 MPC", gnosispay: "Safe smart account", furlpayWins: false },
  { feature: "Chains", furlpay: "Arbitrum, Base, Solana, Polygon, Ethereum", gnosispay: "Gnosis Chain", furlpayWins: true },
  { feature: "Checkout Fee", furlpay: "0.5% flat", gnosispay: "0% on EURe (FX applies off-peg)", furlpayWins: false },
  { feature: "Stablecoin Coverage", furlpay: "USDC, USDT, EURC, PYUSD, DAI", gnosispay: "EURe, GBPe", furlpayWins: true },
  { feature: "Travel Booking Escrows", furlpay: "Yes (Duffel + cNFT tickets)", gnosispay: "No", furlpayWins: true },
  { feature: "AI Agent Payments (x402)", furlpay: "Yes — native HTTP 402", gnosispay: "No", furlpayWins: true },
  { feature: "Multi-Wallet Discovery", furlpay: "EIP-6963 + CAIP-294", gnosispay: "No", furlpayWins: true },
  { feature: "Cross-Chain Swaps", furlpay: "Li.Fi routing incl. Solana", gnosispay: "No", furlpayWins: true },
  { feature: "Fractional Stocks", furlpay: "Yes (Alpaca)", gnosispay: "No", furlpayWins: true },
  { feature: "Gas Model", furlpay: "Sponsored paymaster (USDC)", gnosispay: "User pays Gnosis gas", furlpayWins: true },
  { feature: "Physical Card", furlpay: "Virtual Visa", gnosispay: "Virtual + Physical Visa", furlpayWins: false },
];

export default function CompareGnosisPayPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Compare
        </p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Furlpay vs Gnosis Pay
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Gnosis Pay proved that self-custodial spending works: your funds live in a Safe smart
          account you control, not a company ledger. Furlpay keeps that custody model and extends
          it — multi-chain liquidity, integrated travel booking, AI-agent payments, and wallet
          discovery standards. Here&apos;s the honest side-by-side.
        </p>

        {/* Comparison table */}
        <div className="mt-14 overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="px-5 py-4 font-semibold text-textSecondary">Feature</th>
                <th className="px-5 py-4 font-bold text-neon">Furlpay</th>
                <th className="px-5 py-4 font-semibold text-textSecondary">Gnosis Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {ROWS.map((row) => (
                <tr key={row.feature} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-5 py-4 font-medium">{row.feature}</td>
                  <td className={`px-5 py-4 ${row.furlpayWins ? "text-neon font-semibold" : ""}`}>
                    {row.furlpay}
                  </td>
                  <td className="px-5 py-4 text-textSecondary">{row.gnosispay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Analysis sections */}
        <div className="mt-16 space-y-8">
          <div className="glass-card p-6">
            <h2 className="text-[18px] font-bold">Same self-custody, more chains</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
              Both products are genuinely self-custodial — your keys, your Safe. The difference is
              reach: Gnosis Pay is bound to Gnosis Chain, where on-chain stablecoin liquidity is
              thin. Furlpay routes across Arbitrum, Base, and Solana, where USDC depth actually
              lives, and bridges between them with Li.Fi in one tap.
            </p>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-[18px] font-bold">An honest word on fees</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
              Gnosis Pay&apos;s 0% on EURe spending is a real advantage for euro-denominated
              purchases — we won&apos;t pretend otherwise. Furlpay charges a flat 0.5% at checkout,
              and in exchange covers gas via a USDC paymaster, runs pre-flight balance checks so
              you never pay a decline fee, and pays 2% travel cashback. For dollar-denominated,
              multi-chain spending, the total cost usually favors Furlpay; for pure EUR card
              spending, Gnosis Pay is hard to beat.
            </p>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-[18px] font-bold">Beyond card issuance</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
              Gnosis Pay is card infrastructure — issuance, KYC, and Visa processing on top of
              Safe. Furlpay is a payments super-app: flights and stays booked into on-chain
              escrows with cNFT ticket receipts, x402 payments that let AI agents settle HTTP 402
              paywalls without CAPTCHAs, and an extension that announces itself to every dapp via
              EIP-6963 and CAIP-294.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 flex flex-col items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[20px] font-bold">Self-custody without the single-chain limit</h2>
            <p className="mt-1 text-[14px] text-textSecondary">
              Keep your keys. Spend on every chain that matters.
            </p>
          </div>
          <Link
            href="/signup"
            className="rounded-pill bg-neon px-6 py-3 text-[14px] font-bold text-black transition-transform hover:scale-105"
          >
            Get started free
          </Link>
        </div>
      </main>
    </div>
  );
}
