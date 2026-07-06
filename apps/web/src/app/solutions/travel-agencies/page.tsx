import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";

export const metadata: Metadata = {
  title: "White-Label Travel Booking — Crypto Travel for Agencies",
  description:
    "Offer crypto travel booking under your own brand. Access 2.2M+ properties, settle bookings in USDC on Arbitrum, and run team policies, reports, and virtual cards via the Furlpay API.",
  alternates: { canonical: "/solutions/travel-agencies" },
};

export default function TravelAgenciesSolutionPage() {
  return (
    <LandingPage
      eyebrow="Solutions · Travel agencies"
      title="White-label crypto travel booking."
      subtitle="Sell 2.2M+ hotels and flights under your own brand and settle in USDC on Arbitrum. Team policies, spend reports, virtual cards, and on-chain receipts — exposed as a clean API."
      atomicAnswer={
        <>
          Travel agencies can offer <strong className="text-white">crypto travel booking</strong>{" "}
          under their own brand with Furlpay: access to 2.2M+ properties, USDC settlement on Arbitrum,
          on-chain receipts, and back-office tools for policies, reporting, and virtual cards — via a
          single API.
        </>
      }
      featuresTitle="A travel back office on stablecoin rails"
      features={[
        { title: "2.2M+ inventory", body: "Hotels, apartments, and flights available to resell under your own brand." },
        { title: "USDC settlement", body: "Bookings settle on Arbitrum in about a second with signed, verifiable receipts." },
        { title: "Team policies", body: "Set booking policies and approval rules for corporate and group travel." },
        { title: "Spend reports", body: "Per-trip and per-team reporting for reconciliation and client billing." },
        { title: "Virtual cards", body: "Issue virtual cards for suppliers that still require card payment." },
        { title: "Referrals & rewards", body: "Built-in referral tracking and USDC rewards to grow repeat bookings." },
      ]}
      faq={[
        { q: "Can I offer crypto travel booking under my own brand?", a: "Yes. Furlpay Travels exposes 2.2M+ properties and flights through an API you can wrap in your own brand, with USDC settlement on Arbitrum and on-chain receipts on every booking." },
        { q: "How do agencies handle suppliers that only take cards?", a: "You can issue virtual cards to pay those suppliers while still collecting from your customer in USDC, so crypto acceptance does not limit which inventory you can fulfil." },
        { q: "What back-office tools are included?", a: "Team booking policies, approval rules, per-trip and per-team spend reports, referral tracking, and USDC rewards — the pieces agencies need beyond raw inventory and payments." },
      ]}
      crumbs={[
        { name: "Home", path: "/" },
        { name: "Solutions", path: "/solutions/travel-agencies" },
        { name: "Travel agencies", path: "/solutions/travel-agencies" },
      ]}
      primary={{ href: "/talk-to-us", label: "Talk to us" }}
      secondary={{ href: "/products/travel", label: "Travel product" }}
      cta={{ title: "Launch crypto travel under your brand", primary: { href: "/talk-to-us", label: "Talk to us" }, secondary: { href: "/travel/business", label: "Business travel" } }}
    />
  );
}
