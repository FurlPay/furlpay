import type { Metadata } from "next";
import OnchainDashboard from "@/components/onchain/OnchainDashboard";

export const metadata: Metadata = {
  title: "Onchain Intelligence · FurlPay",
  description: "FurlPay payment volume, chains, rails and risk events from the FurlPay ledger, with live global stablecoin supply.",
};

// PUBLIC page (middleware PUBLIC_PAGE_PREFIXES). Data comes from the public
// /api/onchain aggregate, which never returns user ids or full addresses.
export default function OnchainPage() {
  return <OnchainDashboard />;
}
