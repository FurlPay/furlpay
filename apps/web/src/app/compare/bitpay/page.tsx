import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs BitPay — Best BitPay Alternative for USDC (2026)",
  description:
    "Furlpay vs BitPay: 0.5% USDC on Arbitrum vs BitPay's ~1% settlement, plus AI-native x402 payments, a passkey wallet, travel, and investing. See the full comparison.",
  alternates: { canonical: "/compare/bitpay" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/compare/bitpay",
    siteName: "Furlpay",
    title: "Furlpay vs BitPay — Best BitPay Alternative for USDC (2026)",
    description: "Furlpay vs BitPay: 0.5% USDC on Arbitrum vs BitPay's ~1% settlement, plus AI-native x402 payments, a passkey wallet, travel, and investing. See the full comparison.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay vs BitPay — Best BitPay Alternative for USDC (2026)",
    description: "Furlpay vs BitPay: 0.5% USDC on Arbitrum vs BitPay's ~1% settlement, plus AI-native x402 payments, a passkey wallet, travel, and investing. See the full comparison.",
    images: ["/og.png"],
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="BitPay"
      slug="bitpay"
      title="Furlpay vs BitPay"
      subtitle="Both let businesses accept crypto. Furlpay focuses on USDC stablecoin payments on Arbitrum at 0.5%, is open-source and AI-native, and bundles a passkey wallet, travel, and investing."
      atomicAnswer={
        <>
          Furlpay is a BitPay alternative that settles <strong className="text-white">USDC on
          Arbitrum for 0.5%</strong>, versus BitPay&apos;s roughly 1% merchant settlement fee. Furlpay is
          open-source and AI-native (x402), uses passkey wallets with no seed phrase, and adds travel
          and investing in one account.
        </>
      }
      rows={[
        { feature: "Merchant fee", furlpay: "0.5% flat", other: "~1% settlement", furlpayWins: true },
        { feature: "Primary asset", furlpay: "USDC (dollar-stable)", other: "BTC + many coins", furlpayWins: true },
        { feature: "Settlement chain", furlpay: "Arbitrum (L2, sub-cent gas)", other: "Multi-chain", furlpayWins: false },
        { feature: "AI / x402 payments", furlpay: "Yes (facilitator + MCP)", other: "No", furlpayWins: true },
        { feature: "Wallet", furlpay: "Passkey MPC, no seed", other: "External wallet required", furlpayWins: true },
        { feature: "Open source", furlpay: "Yes (MIT)", other: "No", furlpayWins: true },
        { feature: "Beyond payments", furlpay: "Travel + investing", other: "Payments only", furlpayWins: true },
        { feature: "Chargebacks", furlpay: "None (on-chain final)", other: "None (on-chain final)", furlpayWins: false },
      ]}
      analysis={[
        { title: "Stablecoin-first, not coin-agnostic", body: "BitPay grew up around Bitcoin and supports many volatile coins. Furlpay is built around USDC — a dollar-pegged stablecoin — so pricing, accounting, and settlement are predictable, and merchants aren't exposed to intraday crypto swings between quote and payout." },
        { title: "Lower, simpler fees", body: "Furlpay is a flat 0.5% on Arbitrum, where gas is a fraction of a cent. BitPay's merchant settlement is typically around 1%. On steady volume, the difference compounds." },
        { title: "Built for AI agents", body: "Furlpay ships an x402 facilitator and MCP server so autonomous agents can pay per request. BitPay has no agentic payment protocol." },
        { title: "More than a payment button", body: "Beyond acceptance, Furlpay includes a passkey wallet, USDC travel booking, and fractional investing in one account — BitPay is focused on crypto payment processing." },
      ]}
      faq={[
        { q: "What is the best BitPay alternative for stablecoin payments?", a: "Furlpay is a strong BitPay alternative if you want USDC specifically: it settles USDC on Arbitrum for a flat 0.5% (versus BitPay's ~1%), is open-source, and adds AI-agent payments via x402, a passkey wallet, travel, and investing." },
        { q: "Is Furlpay cheaper than BitPay?", a: "On a per-transaction basis, typically yes: Furlpay is 0.5% flat while BitPay's merchant settlement is generally around 1%. Actual costs depend on your volume and assets; use the fee calculator to model your case." },
        { q: "Does Furlpay support Bitcoin like BitPay?", a: "Furlpay is stablecoin-first and settles USDC on Arbitrum rather than emphasizing Bitcoin and many volatile coins. That keeps pricing and accounting dollar-stable, which is the main design difference from BitPay." },
      ]}
    />
  );
}
