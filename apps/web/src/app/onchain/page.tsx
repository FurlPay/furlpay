import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { adminPageAccess } from "@/lib/analytics/pageGate";
import OnchainDashboard from "@/components/onchain/OnchainDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Onchain Intelligence · FurlPay",
  robots: { index: false, follow: false },
};

// Same SERVER-SIDE gate as /analytics: the admin check runs before any markup
// is produced. The data API (/api/ops/onchain) enforces it again per request.
export default async function OnchainPage() {
  const access = await adminPageAccess("/onchain");
  if (access === "unauthenticated") redirect("/login?next=%2Fonchain");
  if (access === "forbidden") forbidden();
  return <OnchainDashboard />;
}
