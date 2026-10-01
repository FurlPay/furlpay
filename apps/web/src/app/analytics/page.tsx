"use client";

import {
  AlertsPanel,
  FeedPanel,
  FunnelPanel,
  GeoPanel,
  KpiStrip,
  ObservabilityPanel,
  PageHeader,
  ProductUsagePanel,
  UserGrowthPanel,
  VolumePanel,
} from "@/components/analytics/panels";

export default function AnalyticsOverview() {
  return (
    <>
      <PageHeader hero title="Analytics &" highlight="Observability" subtitle="Real-time insights into users, payments, infrastructure, and system health." />
      <KpiStrip />
      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr_1.15fr]">
        <UserGrowthPanel />
        <FunnelPanel />
        <GeoPanel />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr_1.15fr]">
        <VolumePanel />
        <ProductUsagePanel />
        <ObservabilityPanel />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <FeedPanel limit={6} />
        <AlertsPanel limit={6} />
      </div>
    </>
  );
}
