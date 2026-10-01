import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { adminPageAccess } from "@/lib/analytics/pageGate";
import AnalyticsFrame from "@/components/analytics/AnalyticsFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Analytics & Observability · FurlPay",
  robots: { index: false, follow: false },
};

// SERVER-SIDE GATE for every /analytics page. The admin check runs here, before
// any markup is produced: a signed-out visitor is sent to sign in, a signed-in
// non-admin gets "Admin access required" and none of the dashboard's code or
// data. The data APIs (/api/ops/analytics/*) enforce the same check on every
// request independently, so this is not the only line.
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const access = await adminPageAccess("/analytics");
  if (access === "unauthenticated") redirect("/login?next=%2Fanalytics");
  // A real 403 (app/forbidden.tsx), not a 200 that says no. Nothing of the
  // dashboard is rendered or shipped for a non-admin.
  if (access === "forbidden") forbidden();
  return <AnalyticsFrame>{children}</AnalyticsFrame>;
}
