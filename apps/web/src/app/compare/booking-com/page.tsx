import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Booking.com — Book Hotels with USDC (2026)",
  description:
    "Furlpay vs Booking.com for hotels: Booking.com bills in fiat, Furlpay lets you book stays and pay in USDC on Arbitrum with on-chain receipts, a single-use Visa card for any property, and a creator program paying up to 10% weekly.",
  alternates: { canonical: "/compare/booking-com" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/compare/booking-com",
    siteName: "Furlpay",
    title: "Furlpay vs Booking.com — Book Hotels with USDC (2026)",
    description: "Furlpay vs Booking.com for hotels: Booking.com bills in fiat, Furlpay lets you book stays and pay in USDC on Arbitrum with on-chain receipts, a single-use Visa card for any property, and a creator program paying up to 10% weekly.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay vs Booking.com — Book Hotels with USDC (2026)",
    description: "Furlpay vs Booking.com for hotels: Booking.com bills in fiat, Furlpay lets you book stays and pay in USDC on Arbitrum with on-chain receipts, a single-use Visa card for any property, and a creator program paying up to 10% weekly.",
    images: ["/og.png"],
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Booking.com"
      slug="booking-com"
      title="Furlpay vs Booking.com"
      subtitle="Booking.com is the world's largest fiat OTA. Furlpay lets you book stays and pay in USDC on Arbitrum — with on-chain receipts, a single-use Visa card for merchants that only take cards, and a creator program that pays up to 10% in USDC weekly."
      developmentNotice={
        <>
          <strong className="text-amber-300">Travel booking on Furlpay is in development.</strong>{" "}
          Hotel discovery is live — the map shows real properties worldwide — but you cannot book or
          pay for a stay through Furlpay today, and the card program and creator payouts have not
          launched. The rows below marked &quot;in development&quot; describe what we are building,
          against a competitor that books today.
        </>
      }
      atomicAnswer={
        <>
          <strong className="text-white">Booking.com</strong> is a fiat online travel agency — it does not
          settle bookings in crypto. <strong className="text-white">Furlpay</strong> lets you book stays
          and flights and pay in USDC on Arbitrum, returns an on-chain receipt for every booking, and issues a
          single-use Visa virtual card for any property that only accepts cards — so you can spend stablecoins
          on effectively any stay while creators earn up to 10% in USDC, paid weekly.
        </>
      }
      rows={[
        { feature: "Pay in stablecoins", furlpay: "USDC on Arbitrum — in development", other: "Fiat only (card/bank)", furlpayWins: false },
        { feature: "On-chain receipt", furlpay: "Arbiscan receipt — in development", other: "No", furlpayWins: false },
        { feature: "Inventory", furlpay: "Live hotel discovery map; bookable inventory in development", other: "28M+ listings", furlpayWins: false },
        { feature: "Pay any card-only property", furlpay: "Single-use Visa VCN — in development", other: "Card / bank", furlpayWins: false },
        { feature: "AI-agent booking", furlpay: "MCP live; x402 settlement in development", other: "No", furlpayWins: false },
        { feature: "Creator / affiliate", furlpay: "Up to 10% USDC weekly — in development", other: "Affiliate in fiat, delayed", furlpayWins: false },
        { feature: "Loyalty", furlpay: "USDC cashback — in development", other: "Genius (fiat perks)", furlpayWins: false },
      ]}
      analysis={[
        { title: "Spend stablecoins on almost any stay", body: "Booking.com bills in local fiat. Furlpay settles bookings in USDC, and for any property that only takes cards it issues a single-use, MCC-locked Visa virtual card funded by your USDC — so your stablecoins reach merchants that have no crypto integration at all." },
        { title: "On-chain receipts for expenses", body: "Every Furlpay booking produces an Arbiscan-verifiable receipt. For business travelers and finance teams that means reconciliation and reimbursement without waiting on a statement or disputing black-box attribution." },
        { title: "A creator program, not just an affiliate link", body: "Booking.com's affiliate commissions are a slice of its own cut, paid in fiat after a wait. Furlpay pays travel creators up to 10% in USDC weekly with no minimum payout, plus 2% USDC cashback for their followers." },
        { title: "Agentic booking", body: "An AI agent can search Furlpay inventory and pay per resource over x402 within a user-signed budget — an early, working example of agentic commerce that a traditional OTA checkout does not offer." },
      ]}
      faq={[
        { q: "Can I pay for Booking.com with crypto?", a: "Booking.com itself bills in fiat and does not settle in crypto. Furlpay is an alternative that lets you book stays and pay in USDC on Arbitrum, and for card-only properties it issues a single-use Visa virtual card funded by your stablecoins." },
        { q: "What is the best crypto alternative to Booking.com?", a: "Furlpay is a strong Booking.com alternative if you want to pay in USDC with on-chain receipts, a single-use Visa card for any property, AI-agent booking, and a creator program that pays up to 10% in USDC weekly." },
        { q: "Do I get a receipt I can use for expenses?", a: "Yes. Each Furlpay booking settles on Arbitrum and returns an Arbiscan-verifiable receipt, which is useful for expense reports and reimbursements." },
      ]}
    />
  );
}
