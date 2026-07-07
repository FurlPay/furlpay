import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Trip.com — Pay for Travel with USDC (2026)",
  description:
    "Furlpay vs Trip.com for booking travel with stablecoins. Trip.com added USDT/USDC in 2026; Furlpay settles in USDC on Arbitrum with on-chain receipts, agentic x402 booking, single-use Visa cards, and a creator program that pays up to 10% weekly.",
  alternates: { canonical: "/compare/trip-com" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/compare/trip-com",
    siteName: "Furlpay",
    title: "Furlpay vs Trip.com — Pay for Travel with USDC (2026)",
    description: "Furlpay vs Trip.com for booking travel with stablecoins. Trip.com added USDT/USDC in 2026; Furlpay settles in USDC on Arbitrum with on-chain receipts, agentic x402 booking, single-use Visa cards, and a creator program that pays up to 10% weekly.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay vs Trip.com — Pay for Travel with USDC (2026)",
    description: "Furlpay vs Trip.com for booking travel with stablecoins. Trip.com added USDT/USDC in 2026; Furlpay settles in USDC on Arbitrum with on-chain receipts, agentic x402 booking, single-use Visa cards, and a creator program that pays up to 10% weekly.",
    images: ["/og.png"],
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Trip.com"
      slug="trip-com"
      title="Furlpay vs Trip.com"
      subtitle="Trip.com added stablecoin checkout in 2026. Furlpay is built stablecoin-first: USDC settlement on Arbitrum with on-chain receipts, AI-agent booking over x402, single-use Visa cards for any merchant, and a creator program that pays up to 10% in USDC weekly."
      atomicAnswer={
        <>
          Both let you pay for travel with stablecoins. <strong className="text-white">Trip.com</strong> added
          USDT/USDC checkout in 2026 on top of a large fiat OTA. <strong className="text-white">Furlpay</strong>{" "}
          is stablecoin-native: every booking settles in USDC on Arbitrum with an on-chain receipt, an AI agent
          can search and pay per resource over x402, a single-use MCC-locked Visa card covers merchants that do
          not take crypto, and creators earn up to 10% in USDC paid weekly.
        </>
      }
      rows={[
        { feature: "Stablecoin checkout", furlpay: "USDC — native settlement", other: "USDT/USDC (added 2026)", furlpayWins: true },
        { feature: "Settlement", furlpay: "On-chain, Arbitrum receipt", other: "Off-chain processor", furlpayWins: true },
        { feature: "Inventory", furlpay: "2.2M+ stays + flights", other: "1.4M+ hotels, flights, trains", furlpayWins: false },
        { feature: "AI-agent booking", furlpay: "Yes (x402 / MCP)", other: "No", furlpayWins: true },
        { feature: "Pay non-crypto merchants", furlpay: "Single-use Visa VCN", other: "Not applicable", furlpayWins: true },
        { feature: "Creator / affiliate", furlpay: "Up to 10% USDC, weekly", other: "Standard affiliate (fiat)", furlpayWins: true },
        { feature: "Beyond travel", furlpay: "Payments + investing", other: "Travel only", furlpayWins: true },
      ]}
      analysis={[
        { title: "Stablecoin-native vs stablecoin-added", body: "Trip.com integrated USDT/USDC checkout in 2026 as a payment option on a traditional OTA. Furlpay is built the other way around: USDC is the settlement currency, so every booking produces an Arbiscan-verifiable receipt that is useful for expenses, reimbursements, and reconciliation." },
        { title: "Agentic booking over x402", body: "Furlpay exposes travel search and payment to AI agents through the Model Context Protocol and the x402 pay-per-request standard, so an agent can assemble an itinerary and pay for each resource autonomously within a user-signed budget. Trip.com is a human-checkout experience." },
        { title: "A card for merchants that don't take crypto", body: "For anything outside crypto-native inventory, Furlpay issues a single-use, MCC-locked Visa virtual card funded by your USDC — so you can pay a merchant that has never heard of stablecoins while still spending on-chain." },
        { title: "Creators earn in USDC, weekly", body: "Furlpay's creator program pays up to 10% commission in USDC on a weekly cycle with no minimum payout, plus 2% cashback for followers. It is designed for travel creators, not bolted onto a booking site." },
      ]}
      faq={[
        { q: "Does Trip.com accept stablecoins?", a: "Yes. Trip.com integrated stablecoin payments (USDT and USDC) for global flight and hotel bookings in 2026. Furlpay differs by settling bookings natively in USDC on Arbitrum with an on-chain receipt, rather than accepting stablecoins on top of a fiat processor." },
        { q: "What is the best Trip.com alternative for crypto travel?", a: "Furlpay is a strong Trip.com alternative if you want USDC-native settlement with on-chain receipts, AI-agent booking over x402, a single-use Visa card for non-crypto merchants, and a creator program paying up to 10% in USDC weekly." },
        { q: "Can an AI agent book travel on Furlpay?", a: "Yes. Furlpay exposes travel search and payment to AI agents via MCP and the x402 protocol, so an agent can book and pay per resource within a user-signed spending mandate." },
      ]}
    />
  );
}
