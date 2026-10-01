"use client";

import { FeedPanel, KpiStrip, PageHeader, ProductUsagePanel, RangeCaption, VolumePanel } from "@/components/analytics/panels";

export default function TransactionsPage() {
  return (
    <>
      <PageHeader title="Transactions" subtitle="Settled volume and counts from the ops ledger, every rail." />
      <RangeCaption />
      <KpiStrip only={["transactions", "volume"]} />
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <VolumePanel tall />
        <ProductUsagePanel />
      </div>
      <div className="mt-3">
        <FeedPanel limit={20} />
      </div>
    </>
  );
}
