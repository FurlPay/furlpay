import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";
import CreatorDashboard from "./CreatorDashboard";

export const metadata: Metadata = {
  title: "Creator Dashboard",
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
      <LandingChrome />
      <CreatorDashboard initialEmail={email ?? ""} />
    </div>
  );
}
