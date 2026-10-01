"use client";

import { FunnelPanel, KpiStrip, PageHeader, PlatformsPanel, RangeCaption, TrafficPanel, UserGrowthPanel } from "@/components/analytics/panels";

export default function UsersPage() {
  return (
    <>
      <PageHeader title="Users" subtitle="Accounts, verification, activity and website traffic. Requests are not users; visitors are not accounts." />
      <RangeCaption />
      <KpiStrip only={["totalUsers", "newSignups", "kycCompleted", "activeUsers"]} />
      <div className="mt-3 grid gap-3 xl:grid-cols-[1.6fr_1fr]">
        <UserGrowthPanel tall />
        <FunnelPanel />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <TrafficPanel />
        <PlatformsPanel />
      </div>
    </>
  );
}
