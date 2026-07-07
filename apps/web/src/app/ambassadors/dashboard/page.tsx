import type { Metadata } from "next";
import MarketingBar from "@/components/marketing/MarketingBar";
import CreatorDashboard from "./CreatorDashboard";

export const metadata: Metadata = {
  title: "Creator Dashboard | Furlpay",
  description: "Track your clicks, bookings and weekly USDC payouts — live and on-chain.",
  robots: { index: false, follow: false }, // private, per-creator view
};

export default async function CreatorDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return (
    <div className="min-h-screen bg-black text-textPrimary">
      <MarketingBar active="ambassadors" />
      <CreatorDashboard initialEmail={email ?? ""} />
    </div>
  );
}
