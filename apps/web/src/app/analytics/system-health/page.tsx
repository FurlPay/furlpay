"use client";

import { AlertsPanel, ObservabilityPanel, PageHeader, RangeCaption } from "@/components/analytics/panels";

export default function SystemHealthPage() {
  return (
    <>
      <PageHeader title="System Health" subtitle="API traffic, unhandled errors and security alerts. Rail health and controls live on the ops control plane." />
      <RangeCaption />
      <div className="grid gap-3 xl:grid-cols-[1fr_1.2fr]">
        <ObservabilityPanel />
        <AlertsPanel limit={30} />
      </div>
    </>
  );
}
