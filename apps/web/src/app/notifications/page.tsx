import { Suspense } from "react";
import type { Metadata } from "next";
import NotificationList from "@/components/notifications/NotificationList";

// The notification centre.
//
// Authenticated: the page renders a client list that fetches through
// /api/notifications, which resolves the user from the session. There is no
// user id anywhere in this route — nothing here is addressable by another
// account's identifier because nothing here takes one.
//
// noindex is belt-and-braces alongside the robots.ts disallow: a crawler that
// ignores robots.txt still gets an explicit directive, and this page has
// nothing indexable on it in any case.
export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

export default function NotificationsPage() {
  return (
    <Suspense fallback={<NotificationSkeleton />}>
      <NotificationList />
    </Suspense>
  );
}

/** The list's silhouette rather than a spinner, matching MarketsSkeleton:
 *  a centred spinner makes a dense list appear to jump into place. */
function NotificationSkeleton() {
  return (
    <div className="px-5 pt-6" aria-busy="true" aria-label="Loading notifications">
      <div className="h-8 w-44 animate-pulse rounded bg-white/[0.05]" />
      <div className="mt-6 space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
