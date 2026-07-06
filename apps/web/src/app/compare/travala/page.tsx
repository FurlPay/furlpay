import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Travala — Crypto Travel Alternative (2026)",
  description:
    "Furlpay vs Travala for booking travel with crypto: USDC on Arbitrum with on-chain receipts, a passkey wallet, AI trip planning, and one account for payments and investing.",
  alternates: { canonical: "/compare/travala" },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Travala"
      slug="travala"
      title="Furlpay vs Travala"
      subtitle="Both let you book travel with crypto. Furlpay settles bookings in USDC on Arbitrum with on-chain receipts, a passkey wallet, AI trip planning, and payments plus investing in one account."
      atomicAnswer={
        <>
          Furlpay is a Travala alternative for <strong className="text-white">booking travel with
          crypto</strong>: it offers 2.2M+ properties, settles in USDC on Arbitrum with on-chain
          receipts, uses a passkey wallet with no seed phrase, and combines travel with payments and
          investing in a single account.
        </>
      }
      rows={[
        { feature: "Inventory", furlpay: "2.2M+ hotels + flights", other: "3M+ properties", furlpayWins: false },
        { feature: "Pay in", furlpay: "USDC (dollar-stable)", other: "AVA + many coins", furlpayWins: true },
        { feature: "Settlement", furlpay: "On-chain, Arbitrum receipts", other: "Off-chain processing", furlpayWins: true },
        { feature: "Wallet", furlpay: "Passkey MPC, no seed", other: "External wallet", furlpayWins: true },
        { feature: "AI trip planning", furlpay: "Yes (agentic, x402)", other: "No", furlpayWins: true },
        { feature: "Loyalty token", furlpay: "USDC cashback (no token)", other: "AVA token (Smart Program)", furlpayWins: false },
        { feature: "Beyond travel", furlpay: "Payments + investing", other: "Travel only", furlpayWins: true },
        { feature: "Open source", furlpay: "Yes (MIT)", other: "No", furlpayWins: true },
      ]}
      analysis={[
        { title: "Dollar-stable, on-chain receipts", body: "Travala accepts many coins including its AVA token. Furlpay settles in USDC — dollar-stable — and returns an Arbiscan-verifiable receipt on every booking, which is useful for expenses and reimbursements." },
        { title: "No loyalty token to hold", body: "Travala's best rewards route through its AVA token via the Smart Program. Furlpay pays cashback in USDC, so you don't need to buy, hold, or manage a volatile loyalty token to benefit." },
        { title: "Agentic trip planning", body: "Furlpay lets an AI agent assemble and book an itinerary, paying per resource over x402. It's an early, working example of agentic commerce applied to travel." },
        { title: "One account for everything", body: "Furlpay is travel plus payments, a passkey wallet, and fractional investing in a single client. Travala is a dedicated crypto travel marketplace." },
      ]}
      faq={[
        { q: "What is the best Travala alternative for crypto travel?", a: "Furlpay is a strong Travala alternative if you prefer paying in dollar-stable USDC with on-chain receipts, a passkey wallet with no seed phrase, and AI trip planning — plus payments and investing in the same account." },
        { q: "Do I need a special token to get rewards on Furlpay?", a: "No. Furlpay pays cashback in USDC, so you don't need to buy or hold a loyalty token. Travala's top rewards generally route through its AVA token." },
        { q: "Are Furlpay travel bookings verifiable on-chain?", a: "Yes. Each booking settles on Arbitrum and returns a receipt you can verify on Arbiscan, which helps with expense reports and reimbursements." },
      ]}
    />
  );
}
