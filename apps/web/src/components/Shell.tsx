"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import BottomNav from "@/components/BottomNav";
import CommandPalette from "@/components/CommandPalette";
import OfflineBanner from "@/components/OfflineBanner";
import CacheWarmer from "@/components/CacheWarmer";

// Layout switch. Marketing (/), the docs portal (/docs*), the blog (/blog*) and
// the legal section (/legal*) render full-bleed so they can use the whole
// viewport; every other route keeps the phone-frame app chrome (centered 440px
// column, live status bar + home indicator, bottom tab bar).
const FULL_BLEED = (pathname: string) =>
  pathname === "/" ||
  pathname === "/~offline" ||
  pathname === "/pricing" ||
  pathname === "/about" ||
  pathname === "/talk-to-us" ||
  pathname === "/changelog" ||
  pathname === "/community" ||
  pathname === "/partners" ||
  pathname === "/use-cases" ||
  pathname === "/careers" ||
  pathname === "/status" ||
  pathname === "/press" ||
  pathname === "/waitlist" ||
  pathname === "/grants" ||
  pathname === "/marketplace" ||
  pathname === "/ambassadors" || // Creator Program — full desktop marketing landing
  pathname.startsWith("/products") || // Product landing pages — full desktop marketing layout
  pathname.startsWith("/hackathon") || // Build Challenge — full desktop landing
  pathname.startsWith("/early-access") || // Early-access waitlist — full desktop landing
  pathname.startsWith("/swag") || // Swag Center store — full desktop layout
  pathname.startsWith("/compare") ||
  pathname.startsWith("/newsletter") ||
  pathname.startsWith("/developer") ||
  pathname.startsWith("/ops") ||
  pathname.startsWith("/docs") ||
  pathname.startsWith("/blog") ||
  pathname.startsWith("/travel") || // FurlPay Travels portal — full desktop layout (own header/footer)

  pathname.startsWith("/investing/insights") || // FurlPay Research portal (blog-style)
  pathname.startsWith("/legal");

// Auth screens keep the frame but hide the status bar / tab bar chrome.
const BARE = (pathname: string) => pathname === "/login" || pathname === "/signup";

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (FULL_BLEED(pathname)) {
    return (
      <div className="min-h-screen bg-oled">
        <OfflineBanner />
        <CacheWarmer authed={false} />
        {children}
      </div>
    );
  }

  const bare = BARE(pathname);

  return (
    <div className="app-ambient mx-auto min-h-screen w-full max-w-[440px]">
      <OfflineBanner />
      {/* Any non-bare app page sits behind the session middleware — safe to
          warm the protected app-shell routes for offline. */}
      <CacheWarmer authed={!bare} />
      {!bare && <StatusBar />}
      <main className={bare ? "" : "pb-32"}>{children}</main>
      {!bare && (
        <>
          <BottomNav />
          <div className="app-home-indicator fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[440px]" />
          <CommandPalette />
        </>
      )}
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
