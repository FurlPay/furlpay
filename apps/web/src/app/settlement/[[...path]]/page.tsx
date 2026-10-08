import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import SettlementWorkspace from "@/components/settlement/SettlementWorkspace";
import { SETTLEMENT_SECTIONS } from "@/lib/settlement/routes";

export const metadata: Metadata = {
  title: "Settlement OS · FurlPay",
  description: "Treasury, payments, payouts, settlement and reconciliation for your FurlPay account.",
  robots: { index: false, follow: false },
};

const KNOWN = new Set<string>(SETTLEMENT_SECTIONS);

export default async function SettlementPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  if (path.length > 2 || (path[0] && !KNOWN.has(path[0]))) notFound();
  return (
    <Suspense>
      <SettlementWorkspace path={path} />
    </Suspense>
  );
}
