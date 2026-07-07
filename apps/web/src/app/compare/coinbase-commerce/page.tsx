import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Coinbase Commerce — Alternative for USDC (2026)",
  description:
    "Furlpay vs Coinbase Commerce: 0.5% on Arbitrum vs 1%, with AI-native x402 payments, a passkey wallet, fiat settlement, travel, and investing. Full side-by-side comparison.",
  alternates: { canonical: "/compare/coinbase-commerce" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/compare/coinbase-commerce",
    siteName: "Furlpay",
    title: "Furlpay vs Coinbase Commerce — Alternative for USDC (2026)",
    description: "Furlpay vs Coinbase Commerce: 0.5% on Arbitrum vs 1%, with AI-native x402 payments, a passkey wallet, fiat settlement, travel, and investing. Full side-by-side comparison.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay vs Coinbase Commerce — Alternative for USDC (2026)",
    description: "Furlpay vs Coinbase Commerce: 0.5% on Arbitrum vs 1%, with AI-native x402 payments, a passkey wallet, fiat settlement, travel, and investing. Full side-by-side comparison.",
    images: ["/og.png"],
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Coinbase Commerce"
      slug="coinbase-commerce"
      title="Furlpay vs Coinbase Commerce"
      subtitle="Both accept stablecoin payments. Furlpay is 0.5% instead of 1%, open-source and AI-native, and comes with a passkey wallet, fiat settlement, travel, and investing."
      atomicAnswer={
        <>
          Furlpay is a Coinbase Commerce alternative that charges{" "}
          <strong className="text-white">0.5% versus 1%</strong> for USDC payments on Arbitrum. It
          adds x402 agentic payments, a passkey wallet with no seed phrase, fiat settlement, and
          travel and investing in one account.
        </>
      }
      rows={[
        { feature: "Fee", furlpay: "0.5% flat", other: "1%", furlpayWins: true },
        { feature: "Focus asset", furlpay: "USDC on Arbitrum", other: "USDC + several coins", furlpayWins: false },
        { feature: "AI / x402 payments", furlpay: "Yes", other: "x402 protocol origin, limited product", furlpayWins: true },
        { feature: "Wallet", furlpay: "Passkey MPC, no seed", other: "Coinbase account / external", furlpayWins: false },
        { feature: "Fiat settlement", furlpay: "Local USD/EUR account", other: "Via Coinbase account", furlpayWins: false },
        { feature: "Open source", furlpay: "Yes (MIT)", other: "Partly (SDKs)", furlpayWins: true },
        { feature: "Beyond payments", furlpay: "Travel + investing", other: "Payments only", furlpayWins: true },
        { feature: "Recurring billing", furlpay: "Yes (EIP-712)", other: "Limited", furlpayWins: true },
      ]}
      analysis={[
        { title: "Half the fee", body: "Coinbase Commerce charges 1% on transactions. Furlpay is 0.5% flat on Arbitrum, so on the same volume your processing cost is roughly halved." },
        { title: "A product, not just a protocol", body: "Coinbase created the x402 protocol, which is excellent. Furlpay builds a full product around it — a hosted facilitator, MCP server, recurring authorizations, and merchant tooling — so you can ship agentic and subscription payments without assembling the pieces yourself." },
        { title: "One account for money", body: "Furlpay bundles a passkey wallet, USDC travel booking, and fractional investing alongside acceptance. Coinbase Commerce is a focused payment product." },
        { title: "Open and self-hostable", body: "Furlpay's SDKs, CLI, MCP server, and x402 facilitator are MIT-licensed, so you can audit and self-host the payment path end to end." },
      ]}
      faq={[
        { q: "Is Furlpay cheaper than Coinbase Commerce?", a: "Yes on fees: Furlpay charges 0.5% per transaction versus Coinbase Commerce's 1%, so processing cost is roughly halved on the same volume. Both settle on-chain with no chargebacks." },
        { q: "What is the best Coinbase Commerce alternative?", a: "If you want lower fees and more around the payment — recurring USDC billing, agentic x402 payments, a passkey wallet, and fiat settlement — Furlpay is a strong Coinbase Commerce alternative at 0.5% on Arbitrum." },
        { q: "Does Furlpay use the x402 protocol?", a: "Yes. x402 was created by Coinbase, and Furlpay implements it with a hosted facilitator and MCP server so AI agents can pay per request, plus middleware you can self-host." },
      ]}
    />
  );
}
