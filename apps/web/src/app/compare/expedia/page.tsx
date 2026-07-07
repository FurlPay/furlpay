import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Expedia — Book Travel with USDC (2026)",
  description:
    "Furlpay vs Expedia: Expedia bills in fiat, Furlpay lets you book 2.2M+ stays and flights and pay in USDC on Arbitrum with on-chain receipts, a single-use Visa card for any merchant, agentic x402 booking, and a creator program paying up to 10% weekly.",
  alternates: { canonical: "/compare/expedia" },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Expedia"
      slug="expedia"
      title="Furlpay vs Expedia"
      subtitle="Expedia is a fiat OTA with deep inventory and a rewards program. Furlpay lets you book 2.2M+ stays and flights and pay in USDC on Arbitrum — with on-chain receipts, a single-use Visa card for card-only merchants, AI-agent booking over x402, and a creator program paying up to 10% in USDC weekly."
      atomicAnswer={
        <>
          <strong className="text-white">Expedia</strong> is a fiat online travel agency and does not settle
          bookings in crypto. <strong className="text-white">Furlpay</strong> lets you book 2.2M+ stays and
          flights and pay in USDC on Arbitrum, returns an on-chain receipt on every booking, and issues a
          single-use Visa virtual card for merchants that only take cards — so you can spend stablecoins across
          effectively all inventory, with creators earning up to 10% in USDC weekly.
        </>
      }
      rows={[
        { feature: "Pay in stablecoins", furlpay: "USDC on Arbitrum", other: "Fiat only (card/bank)", furlpayWins: true },
        { feature: "On-chain receipt", furlpay: "Yes (Arbiscan)", other: "No", furlpayWins: true },
        { feature: "Inventory", furlpay: "2.2M+ stays + flights", other: "Hotels, flights, packages, cars", furlpayWins: false },
        { feature: "Pay any card-only merchant", furlpay: "Single-use Visa VCN", other: "Card / bank", furlpayWins: true },
        { feature: "AI-agent booking", furlpay: "Yes (x402 / MCP)", other: "No", furlpayWins: true },
        { feature: "Creator / affiliate", furlpay: "Up to 10% USDC, weekly", other: "Affiliate in fiat, delayed", furlpayWins: true },
        { feature: "Beyond travel", furlpay: "Payments + investing", other: "Travel only", furlpayWins: true },
      ]}
      analysis={[
        { title: "Stablecoins across all inventory", body: "Expedia bills in fiat. Furlpay settles in USDC, and for anything outside crypto-native inventory it issues a single-use, MCC-locked Visa virtual card funded by your USDC — so your stablecoins reach hotels, airlines and packages that have no crypto integration." },
        { title: "On-chain receipts", body: "Every Furlpay booking returns an Arbiscan-verifiable receipt. That makes expense reconciliation and reimbursement straightforward, without waiting on a card statement." },
        { title: "Agentic, not just a checkout", body: "Furlpay exposes travel to AI agents via MCP and x402, so an agent can book and pay per resource within a user-signed budget. Expedia is a human-checkout OTA." },
        { title: "A real creator program", body: "Expedia's affiliate commissions are a slice of its cut, paid in fiat after a wait. Furlpay pays travel creators up to 10% in USDC weekly with no minimum, plus 2% USDC cashback for followers." },
      ]}
      faq={[
        { q: "Can I pay for Expedia with crypto?", a: "Expedia bills in fiat and does not settle in crypto. Furlpay is an alternative that lets you book 2.2M+ stays and flights in USDC on Arbitrum, and for card-only merchants it issues a single-use Visa virtual card funded by your stablecoins." },
        { q: "What is the best crypto alternative to Expedia?", a: "Furlpay is a strong Expedia alternative if you want USDC settlement with on-chain receipts, a single-use Visa card for any merchant, AI-agent booking, and a creator program paying up to 10% in USDC weekly." },
        { q: "Does Furlpay cover flights and hotels like Expedia?", a: "Yes. Furlpay covers 2.2M+ stays plus live flight inventory, and settles bookings in USDC with an on-chain receipt." },
      ]}
    />
  );
}
