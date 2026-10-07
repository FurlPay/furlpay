import type { Metadata } from "next";
import OnchainDashboard from "@/components/onchain/OnchainDashboard";
import RwaIndex from "@/components/rwa/RwaIndex";
import { operatorOnPublicPage } from "@/lib/analytics/pageGate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Onchain Intelligence · FurlPay",
  description: "FurlPay payment volume, chains, rails and risk events from the FurlPay ledger, with live global stablecoin supply.",
};

// PUBLIC page (middleware PUBLIC_PAGE_PREFIXES). Data comes from the public
// /api/onchain aggregate, which never returns user ids or full addresses.
//
// The admin additionally gets the Tokenized Assets section (licensed Allium
// data). That decision is made HERE, on the server, before any markup: for
// everyone else the section is not rendered, not referenced in the payload,
// and its data API (/api/ops/rwa, ADMIN_ONLY) refuses them anyway.
export default async function OnchainPage() {
  const operator = await operatorOnPublicPage("/onchain");
  return <OnchainDashboard operatorSection={operator ? <RwaIndex variant="section" /> : null} />;
}
