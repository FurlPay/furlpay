"use client";

import { Suspense } from "react";
import MarketsWorkspace from "@/components/markets/MarketsWorkspace";

// Markets — the discovery terminal.
//
// The page itself is only a Suspense boundary. Every piece of this surface's
// state lives in the query string (tab, sort, direction, page, collection,
// view, panel) so it survives a reload and a back button, and reading those
// with useSearchParams forces the consumer under a boundary. Keeping the
// boundary here rather than inside the workspace means one fallback for the
// whole screen instead of a component that renders half of itself first.
//
// Metadata comes from markets/layout.tsx, which a client component cannot
// export for itself.

export default function MarketsPage() {
  return (
    <Suspense fallback={<MarketsSkeleton />}>
      <MarketsWorkspace />
    </Suspense>
  );
}

/** The workspace's silhouette, not a spinner — a centred spinner on a dense
 *  page makes the layout appear to jump into place when it resolves. */
function MarketsSkeleton() {
  return (
    <div className="bg-oled flex min-h-screen" aria-busy="true" aria-label="Loading markets">
      <div className="hidden w-[188px] shrink-0 border-r border-white/[0.06] bg-black/40 xl:block" />
      <div className="min-w-0 flex-1">
        <div className="h-[57px] border-b border-white/[0.06]" />
        <div className="mx-auto w-full max-w-[1560px] px-4 pt-4 sm:px-5 lg:px-6">
          <div className="h-9 w-40 animate-pulse rounded bg-white/[0.05]" />
          <div className="mt-4 h-8 w-72 animate-pulse rounded-full bg-white/[0.04]" />
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[124px] animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
