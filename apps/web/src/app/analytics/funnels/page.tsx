"use client";

import { FunnelPanel, KpiStrip, PageHeader, RangeCaption } from "@/components/analytics/panels";

export default function FunnelsPage() {
  return (
    <>
      <PageHeader title="Funnels" subtitle="How far each period's signup cohort has got: verification, then first transaction." />
      <RangeCaption />
      <KpiStrip only={["newSignups", "kycCompleted", "transactions"]} />
      <div className="mt-3 max-w-[900px]">
        <FunnelPanel />
      </div>
    </>
  );
}
