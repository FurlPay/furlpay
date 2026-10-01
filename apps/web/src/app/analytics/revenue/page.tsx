"use client";

import { PageHeader, RangeCaption, RevenuePanel } from "@/components/analytics/panels";

export default function RevenuePage() {
  return (
    <>
      <PageHeader title="Revenue" subtitle="Fees earned on settled transactions." />
      <RangeCaption />
      <RevenuePanel />
    </>
  );
}
