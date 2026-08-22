"use client";

import ProfileMenu from "@/components/auth/ProfileMenu";
import GlobalSearch from "./GlobalSearch";
import NotificationsBell from "./NotificationsBell";
import LiveStatus from "./LiveStatus";

// ---------------------------------------------------------------------------
// The sticky header: search on the left, live status, bell, avatar on the right.
//
// SAME BAND AS THE TICKER PAGE. /markets/[symbol] marks its identity block with
// `app-ambient` — the burgundy radial wash — over a hairline bottom border, and
// this header uses the same treatment at the same measure. Clicking a row
// should not change the material the page is made of.
//
// The wash sits behind the HEADER ONLY, exactly as it does there. Running it
// down the whole page would tint the sparklines, and their green and red are
// the two colours on this surface that must stay true.
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
    <header className="app-ambient sticky top-0 z-40 border-b border-white/[0.06]">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-5 py-4 sm:gap-4 lg:px-8 2xl:px-12">
        <GlobalSearch universeSize={universeSize} className="min-w-0 flex-1 lg:max-w-[460px]" />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <LiveStatus live={live} asOf={asOf} className="hidden sm:flex" />
          <NotificationsBell />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
