"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import BottomNav from "@/components/BottomNav";
import CommandPalette from "@/components/CommandPalette";
import OfflineBanner from "@/components/OfflineBanner";
import CacheWarmer from "@/components/CacheWarmer";

// Layout switch. The app-frame vs full-bleed classification lives in
// lib/shellRoutes.ts (with the reasoning for its inverted polarity), where the
// layout regression test can import it without dragging in this client
// component's dependency chain.
import { isAppFrame, isBare } from "@/lib/shellRoutes";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (!isAppFrame(pathname) && !isBare(pathname)) {
    return (
      <div className="min-h-screen bg-oled">
        <OfflineBanner />
        <CacheWarmer authed={false} />
        {children}
      </div>
    );
  }

  // Auth screens (/login, /signup) are full-bleed and centre their own card.
  //
  // They used to share the phone frame with its chrome switched off, which on a
  // desktop monitor rendered a 440px strip of form fields floating in black — a
  // layout that reads as an unfinished mobile page rather than as the entry
  // point to the product. Full-bleed with the ambient wash behind it lets the
  // same markup be a proper full-screen surface on a monitor and identical on a
  // phone, where 440px is the whole viewport anyway.
  //
  // No StatusBar, no BottomNav, no CommandPalette: there is no session yet, so
  // every one of those would be chrome pointing at places the visitor cannot go.
  if (isBare(pathname)) {
    return (
      <div className="app-ambient flex min-h-screen w-full flex-col">
        <OfflineBanner />
        <CacheWarmer authed={false} />
        <main className="flex flex-1 items-center justify-center px-5 py-10">
          {/* The card keeps the phone measure — a sign-in form wider than this
              has line lengths no one wants — but it is now CENTRED in the
              viewport rather than pinned to a column at the left edge. */}
          <div className="w-full max-w-[440px]">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-ambient mx-auto min-h-screen w-full max-w-[440px]">
      <OfflineBanner />
      {/* Any app page sits behind the session middleware — safe to warm the
          protected app-shell routes for offline. */}
      <CacheWarmer authed />
      <StatusBar />
      <main className="pb-32">{children}</main>
      <BottomNav />
      <div className="app-home-indicator fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[440px]" />
      <CommandPalette />
    </div>
  );
}

function StatusBar() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app-statusbar sticky top-0 z-30">
      <span>{time || " "}</span>
      <div className="flex items-center gap-1.5">
        {/* signal */}
        <div className="flex items-end gap-0.5">
          {[3, 5, 7, 9].map((h, i) => (
            <span
              key={h}
              className="w-0.5 rounded-full bg-white"
              style={{ height: h, opacity: i === 3 ? 0.4 : 1 }}
            />
          ))}
        </div>
        {/* wifi */}
        <svg viewBox="0 0 16 12" className="h-3 w-4" fill="none">
          <path d="M8 10.5l2-2.4a3 3 0 00-4 0l2 2.4z" fill="#fff" />
          <path d="M4 6a6 6 0 018 0M2 3.5a10 10 0 0112 0" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {/* battery */}
        <div className="flex items-center gap-0.5">
          <div className="relative h-3 w-6 rounded-[3px] border border-white/60 p-[1.5px]">
            <div className="h-full w-3/4 rounded-[1px] bg-white" />
          </div>
          <div className="h-1.5 w-0.5 rounded-r-sm bg-white/60" />
        </div>
      </div>
    </div>
  );
}
