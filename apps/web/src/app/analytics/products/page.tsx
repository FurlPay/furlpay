"use client";

import { KpiStrip, PageHeader, ProductUsagePanel, RangeCaption, VolumePanel } from "@/components/analytics/panels";

export default function ProductsPage() {
  return (
    <>
      <PageHeader title="Products" subtitle="Which products people transact with: distinct users per rail." />
      <RangeCaption />
      <KpiStrip only={["transactions", "volume"]} />
      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1.4fr]">
        <ProductUsagePanel />
        <VolumePanel />
      </div>
    </>
  );
}
