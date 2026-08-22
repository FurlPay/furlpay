"use client";

import BottomNav from "@/components/BottomNav";
import DesktopNav from "./DesktopNav";

// Responsive chrome for the Markets list surfaces.
//
// These pages left the global phone frame (see lib/shellRoutes.ts) so they can
// use a desktop viewport, and that opt-out is all-or-nothing — it takes the
// 440px column, the ambient wash and the tab bar with it. This puts all three
// back below `lg`, and swaps in the nav rail above it.
//
// Unlike the ticker page there is no media-query switch here: the list renders
// the same components at every width, only re-flowed, so Tailwind breakpoints
// do the whole job and nothing is mounted twice.
export default function MarketsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-oled">
      <DesktopNav />

      <div className="app-ambient min-w-0 flex-1">
        {/* 440px on a phone, exactly as the app frame gave it; the full column
            up to 1440px on a desktop, where a centred phone-width strip of
            content on a black field is the thing that reads as unfinished. */}
        <div className="mx-auto w-full max-w-[440px] pb-32 lg:max-w-[1440px] lg:px-6 lg:pb-16 2xl:px-10">
          {children}
        </div>

        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
