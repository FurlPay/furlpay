"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AlertsPanel, FeedPanel, PageHeader } from "@/components/analytics/panels";

function Realtime() {
  // The header search lands here (?q=): it filters the loaded feed and alerts,
  // which are already pseudonymous; it queries no user records.
  const q = useSearchParams().get("q") ?? "";
  return (
    <>
      <PageHeader title="Realtime" subtitle={q ? `Events and alerts matching “${q}”.` : "The live activity feed and alerts, refreshed every 15 seconds."} />
      <div className="grid gap-3">
        <FeedPanel limit={60} search={q} />
        <AlertsPanel limit={50} search={q} />
      </div>
    </>
  );
}

export default function RealtimePage() {
  return (
    <Suspense fallback={null}>
      <Realtime />
    </Suspense>
  );
}
