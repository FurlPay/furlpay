"use client";

import type { ReactNode } from "react";
import BottomNav from "@/components/BottomNav";
import ProfileMenu from "@/components/auth/ProfileMenu";
import AppSidebar from "@/components/AppSidebar";

// ---------------------------------------------------------------------------
// The full-bleed chrome for app pages that outgrew the 440px phone column.
//
// Three pieces, shared with every other app surface so that moving between
// Portfolio, Bills and Markets does not change the furniture underfoot:
//
//   AppSidebar    the one desktop sidebar, `lg:flex` only
//   header        an `app-ambient` band over a hairline border, at the same
//                 1440px measure as every other surface
//   BottomNav     the phone tab bar, rendered below `lg`
//
// That last one is the part that is easy to forget and expensive to get wrong:
// a page carved out of the app frame loses the frame's tab bar, so without this
// a phone user has no navigation at all. Any page added to the carve-out list
// in lib/shellRoutes.ts should render through here rather than hand-rolling it.
//
// Deliberately NO horizontal padding on the content wrapper. These pages were
// written for the phone column and their sections carry their own `px-5`;
// adding more here would double it. A page that wants a narrower measure
// constrains its own children.
// ---------------------------------------------------------------------------

export default function AppPageShell({
  title,
  headerRight,
  children,
}: {
  title: string;
  /** Sits beside the title — a status pill, a filter, a live indicator. */
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-oled">
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <header className="app-ambient sticky top-0 z-40 border-b border-white/[0.06]">
          <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-5 py-4 sm:gap-4 lg:px-8 2xl:px-12">
            <h1 className="text-[19px] font-bold tracking-tight text-white sm:text-[21px]">
              {title}
            </h1>
            {headerRight}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <ProfileMenu />
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1440px] pb-28 pt-4 lg:pb-12 lg:pt-5">
          {children}
        </div>

        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
