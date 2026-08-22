"use client";

import ProfileMenu from "@/components/auth/ProfileMenu";
import GlobalSearch from "./GlobalSearch";
import NotificationsBell from "./NotificationsBell";
import LiveStatus from "./LiveStatus";

// ---------------------------------------------------------------------------
// The sticky header: search on the left, live status, bell, avatar on the right.
//
// Sticky rather than fixed, so it participates in the layout and cannot cover
// the first row of the table on a short viewport.
//
// The responsive rule is about what SURVIVES, not what shrinks. Below `sm` the
// live-status chip drops (its information is repeated by the green/red colour
// of every figure on the page) and the search field takes the freed width; the
// bell and the avatar never drop, because they are the only entry points to
// notifications and the account.
// ---------------------------------------------------------------------------

export default function MarketsTopBar({
  universeSize,
  live,
  asOf,
}: {
  universeSize?: number;
  live: boolean;
  /** ISO timestamp the data was assembled, from the API. */
  asOf: string | null;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-mkt-bg/85 backdrop-blur-xl">
      <div className="flex items-center gap-2.5 px-4 py-2.5 sm:gap-4 sm:px-5 lg:px-6">
        <GlobalSearch universeSize={universeSize} className="min-w-0 flex-1 lg:max-w-[440px]" />

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5">
          <LiveStatus live={live} asOf={asOf} className="hidden sm:flex" />
          <NotificationsBell />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
