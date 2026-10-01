"use client";

import { GeoPanel, PageHeader, RangeCaption } from "@/components/analytics/panels";

export default function GeographyPage() {
  return (
    <>
      <PageHeader title="Geography" subtitle="Distinct signed-in users by country, aggregated. No individual location is stored." />
      <RangeCaption />
      <GeoPanel rows={25} />
    </>
  );
}
