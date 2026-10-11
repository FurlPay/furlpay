import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import SettlementWorkspace from "@/components/settlement/SettlementWorkspace";
import { resolveSettlementPath } from "@/lib/settlement/routes";

export const metadata: Metadata = {
  title: "Settlement OS · FurlPay",
  description: "Treasury, payments, payouts, settlement and reconciliation for your FurlPay account.",
  robots: { index: false, follow: false },
};

export default async function SettlementPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  // Every URL is a real page, a redirect to one, or a 404 — never a silent fallback.
  const r = resolveSettlementPath(path);
  if (r.kind === "not_found") notFound();
  if (r.kind === "redirect") permanentRedirect(r.to);
  return (
    <Suspense>
      <SettlementWorkspace path={path} />
    </Suspense>
  );
}
